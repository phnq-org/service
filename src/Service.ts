import { createLogger } from '@phnq/log';
import { Logger } from '@phnq/log/logger';
import { Anomaly, AnomalyMessage, ErrorMessage, MessageConnection, MessageTransport, MessageType } from '@phnq/message';
import { NATSTransport, NATSTransportConnectionOptions } from '@phnq/message/transports/NATSTransport';
import { ConnectionOptions } from 'nats';
import { v4 as uuid } from 'uuid';

import Context from './Context';
import ServiceClient, { DefaultClient } from './ServiceClient';
import ServiceError from './ServiceError';
import { ServiceMessage, ServiceRequestMessage, ServiceResponseMessage } from './ServiceMessage';
import ServiceStats, { HandlerStatsReport, Stats } from './ServiceStats';

const DEFAULT_NATS_URI = 'nats://localhost:4222';
const ENV_PHNQ_SERVICE_NATS = process.env.PHNQ_SERVICE_NATS;
const DEFAULT_NATS_MONITOR_URI = 'http://localhost:8222';
const ENV_PHNQ_SERVICE_NATS_MONITOR = process.env.PHNQ_SERVICE_NATS_MONITOR;
const ENV_PHNQ_SERVICE_SIGN_SALT = process.env.PHNQ_SERVICE_SIGN_SALT;

const defaultNatsOptions: NATSTransportConnectionOptions = {
  servers: [ENV_PHNQ_SERVICE_NATS || DEFAULT_NATS_URI],
  monitorUrl: ENV_PHNQ_SERVICE_NATS_MONITOR || DEFAULT_NATS_MONITOR_URI,
  maxReconnectAttempts: -1, // never give up
  maxConnectAttempts: -1, // never give up
};

export interface ServiceInstanceInfo {
  origin: string;
  domain: string | null;
}

export interface ServiceApi<D extends string> {
  domain: D;
  handlers: {
    [name: string]: (arg: never) => Promise<unknown | AsyncIterableIterator<unknown>>;
  };
}

export interface ServiceConfig<T extends ServiceApi<D>, D extends string = T['domain']> {
  nats?: ConnectionOptions & { monitorUrl?: string };
  signSalt?: string;
  responseTimeout?: number;
  handlers?: {
    [H in keyof T['handlers']]: Handler<T, H, D>;
  };
}

export type Handler<T extends ServiceApi<D>, H extends keyof T['handlers'], D extends string = T['domain']> = (
  arg: Parameters<T['handlers'][H]>[0],
  service: Service<T>,
) => ReturnType<T['handlers'][H]>;

class Service<T extends ServiceApi<D>, D extends string = T['domain']> {
  public readonly origin = uuid().replace(/[^\w]/g, '');
  private log: Logger;
  private readonly serviceStats = new ServiceStats({ filter: (_, m) => !['ping', 'getStats'].includes(m) });
  private readonly clientStats = new ServiceStats({ filter: (_, m) => m !== 'getStats' });
  private readonly domain: D;
  private readonly config: ServiceConfig<T>;
  private transport: MessageTransport<ServiceRequestMessage, ServiceResponseMessage>;
  private connection: Promise<MessageConnection<ServiceRequestMessage, ServiceResponseMessage>>;
  private readonly handlers: Record<
    string,
    (arg: unknown, service: Service<T>) => Promise<unknown | AsyncIterableIterator<unknown>>
  >;
  private connected = true;

  public constructor(domain: D, config: ServiceConfig<T> = {}) {
    this.log = createLogger(`${domain}${config.handlers === undefined ? '.client' : ''}`);
    this.domain = domain;
    this.config = config;
    this.transport = DEFAULT_TRANSPORT;
    this.handlers = Object.freeze({
      ...config.handlers,
      ping: async () => 'pong',
      getStats: async () => this.stats,
    });
    this.connection = this.getConnection();
  }

  public get isConnected(): boolean {
    return this.connected;
  }

  public get stats(): {
    origin: string;
    domain: string | null;
    service: Record<string, HandlerStatsReport>;
    client: Record<string, HandlerStatsReport>;
  } {
    return {
      origin: this.origin,
      domain: this.domain,
      service: this.serviceStats.stats,
      client: this.clientStats.stats,
    };
  }

  public async getPeers(): Promise<ServiceInstanceInfo[]> {
    if (this.transport instanceof NATSTransport) {
      const connectionNames = (await this.transport.getConnections()).map(c => c.name).filter(isDefined);
      return connectionNames.map(name => {
        const [origin, domain = null] = name.split('.').reverse();
        return { domain, origin };
      });
    }
    return [];
  }

  public async getPeerStats(): Promise<Stats[]> {
    const peers = await this.getPeers();
    return Promise.all(peers.map(peer => ServiceClient.create(peer.origin).getStats()));
  }

  private getConnection(): Promise<MessageConnection<ServiceRequestMessage, ServiceResponseMessage>> {
    const { nats = defaultNatsOptions, signSalt = ENV_PHNQ_SERVICE_SIGN_SALT, responseTimeout } = this.config;

    const domain = this.domain;

    return (
      this.connection ||
      new Promise<MessageConnection<ServiceRequestMessage, ServiceResponseMessage>>(async (resolve, reject) => {
        try {
          this.log('Starting service...');

          const subscriptions: Parameters<typeof NATSTransport.create>[1]['subscriptions'] = [this.origin];

          if (this.config.handlers) {
            /**
             * Load-balancing is achieved by setting the `queue` option to the domain name. This puts
             * all services of the same domain into a queue group. Messages are then distributed by
             * NATS to the grouped services randomly. NATS queueing is described here:
             *
             *   https://docs.nats.io/nats-concepts/core-nats/queue
             */
            subscriptions.push({ subject: domain, options: { queue: domain } });
          }

          /**
           * Create a NATS transport.
           * This configiration deterimines how messages are routed.
           */
          this.transport = await NATSTransport.create(
            { ...nats, name: [domain, this.origin].filter(Boolean).join('.') },
            {
              /**
               * This service listens for incoming messages on the following subjects:
               * - `origin` (uuid) messages sent directly to this service instance.
               * - `domain` (string) messages sent to this service's domain.
               * - `all-services` messages sent to all services.
               */
              subscriptions,
              /**
               * Outgoing messages are published to subjects as follows:
               * - A `request` message is published to the `domain` subject.
               * - Errors/Anomalies are published to the `origin` subject.
               * - A `response` message is published to the `origin` subject.
               *
               * Note: `origin` refers to the originator of the message conversation.
               */
              publishSubject: ({ t, p }) => {
                switch (t) {
                  case MessageType.Request:
                    return (p as ServiceRequestMessage).domain;
                  case MessageType.Anomaly:
                  case MessageType.Error:
                    return ((p as AnomalyMessage['p'] | ErrorMessage['p']).requestPayload as ServiceRequestMessage)
                      .origin;
                }
                return (p as ServiceResponseMessage).origin;
              },
            },
          );

          this.log('Connected to NATS.');

          const connection = new MessageConnection<ServiceRequestMessage, ServiceResponseMessage>(this.transport, {
            signSalt,
            marshalPayload: p => this.marshalPayload(p),
            unmarshalPayload: p => this.unmarshalPayload(p),
          });

          if (responseTimeout !== undefined) {
            connection.responseTimeout = responseTimeout;
          }

          connection.onReceive = message => Context.apply(message.contextData, () => this.handleRequest(message));

          resolve(connection);
        } catch (err) {
          reject(err);
        }
      })
    );
  }

  public async connect(): Promise<void> {
    await this.connection;
  }

  public async disconnect(): Promise<void> {
    if (this.connected) {
      this.connected = false;
      await this.transport.close();
    }
  }

  /**
   * Returns the total time to fulfill a simple request from the client's perspective. This
   * round trip entails 4 message transfers:
   *
   *    client -> NATS (request)
   *    NATS -> service (request)
   *    -------------------------
   *    service -> NATS (response)
   *    NATS -> client (response)
   *
   * @returns the latency in milliseconds
   */
  public async testLatency(): Promise<number> {
    if (!this.domain) {
      throw new Error('testLatency requires a configured domain');
    }
    const client = this.getClient();
    const start = process.hrtime.bigint();
    if ((await client.ping()) !== 'pong') {
      throw new Error('ping/pong failed');
    }
    return Number(process.hrtime.bigint() - start) / 1_000_000;
  }

  protected marshalPayload(payload: ServiceMessage): ServiceMessage {
    return payload;
  }

  protected unmarshalPayload(payload: ServiceMessage): ServiceMessage {
    return payload;
  }

  /**
   *
   * @param domain
   * @returns
   */
  public getClient(): T['handlers'] & DefaultClient {
    const { clientStats, domain } = this;
    return new Proxy(
      {},
      {
        get: (_, method: string) => {
          if (method === 'isConnected') {
            return this.isConnected;
          } else if (method === 'stats') {
            return clientStats.stats;
          }

          const start = performance.now();

          return async (payload: unknown) => {
            if (method === 'disconnect') {
              await this.disconnect();
              return;
            }

            const connection = await this.connection;

            if (method === 'connect') {
              // Just return if 'connect' is called since connect() is invoked above.
              return;
            }

            if (connection) {
              const response = await connection.request(
                {
                  domain,
                  origin: this.origin,
                  method,
                  payload,
                  contextData: Context.current.data,
                },
                method !== 'checkIn',
              );

              if (
                typeof response === 'object' &&
                (response as AsyncIterableIterator<ServiceResponseMessage>)[Symbol.asyncIterator]
              ) {
                const responseIter = response as AsyncIterableIterator<ServiceResponseMessage>;
                const context = Context.current;
                return (async function* () {
                  Context.apply(context.data);
                  let numResponses = 0;
                  for await (const { payload, sharedContextData } of responseIter) {
                    numResponses += 1;
                    Context.current.merge(sharedContextData);
                    yield payload;
                  }
                  clientStats.record(domain, method, { time: performance.now() - start, numResponses });
                })();
              } else if (response) {
                const { payload, sharedContextData } = response as ServiceResponseMessage;
                Context.current.merge(sharedContextData);
                clientStats.record(domain, method, { time: performance.now() - start });
                return payload;
              }
            } else {
              clientStats.record(domain, method, { time: performance.now() - start, error: true });
              // This should never happen.
              this.log.error('No connection');
            }
          };
        },
      },
    ) as T['handlers'] & DefaultClient;
  }

  private async handleRequest({
    domain,
    method,
    origin,
    payload,
  }: ServiceRequestMessage): Promise<ServiceResponseMessage | AsyncIterableIterator<ServiceResponseMessage>> {
    const start = process.hrtime.bigint();

    const stats = this.serviceStats;

    const handler = this.handlers[method];
    if (handler) {
      try {
        Context.current.getClient = <T extends ServiceApi<D>, D extends string = T['domain']>(domain: D) =>
          ServiceClient.create<T>(domain);
        const response = await handler(payload, this);
        if (typeof response === 'object' && (response as AsyncIterableIterator<ServiceMessage>)[Symbol.asyncIterator]) {
          const context = Context.current;
          return (async function* (): AsyncIterableIterator<ServiceResponseMessage> {
            Context.apply(context.data);
            let numResponses = 0;
            for await (const payload of response as AsyncIterableIterator<ServiceResponseMessage>) {
              numResponses += 1;
              yield {
                origin,
                payload,
                stats: { time: Number(process.hrtime.bigint() - start) / 1_000_000 },
                sharedContextData: Context.current.sharedData,
              };
            }
            stats.record(domain, method, {
              time: Number(process.hrtime.bigint() - start) / 1_000_000,
              numResponses,
            });
          })();
        } else {
          const time = Number(process.hrtime.bigint() - start) / 1_000_000;
          stats.record(domain, method, { time });
          return {
            origin,
            payload: response,
            stats: { time },
            sharedContextData: Context.current.sharedData,
          };
        }
      } catch (err) {
        stats.record(domain, method, { time: Number(process.hrtime.bigint() - start) / 1_000_000, error: true });
        this.log.error(`Error handling request [${domain}.${method}]`).stack(err);

        if (err instanceof ServiceError && err.type !== 'server-error') {
          throw new Anomaly(err.message, err.payload);
        }

        throw err;
      }
    }
    throw new Anomaly(`No handler for method: ${domain}.${method}`);
  }
}

const DEFAULT_TRANSPORT = {
  async send() {
    // do nothing
  },

  onReceive() {
    // do nothing
  },

  async close() {
    // do nothing
  },
};

const isDefined = <T = unknown>(val: T | undefined | null): val is T => val !== undefined && val !== null;

// const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export default Service;
