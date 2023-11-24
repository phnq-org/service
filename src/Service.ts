import { createLogger } from '@phnq/log';
import { Logger } from '@phnq/log/logger';
import { Anomaly, AnomalyMessage, ErrorMessage, MessageConnection, MessageTransport, MessageType } from '@phnq/message';
import { NATSTransport } from '@phnq/message/transports/NATSTransport';
import { ConnectionOptions } from 'nats';
import { v4 as uuid } from 'uuid';

import Context from './Context';
import { DefaultClient } from './ServiceClient';
import { ServiceMessage, ServiceRequestMessage, ServiceResponseMessage } from './ServiceMessage';
import ServiceStats, { HandlerStatsReport, Stats } from './ServiceStats';

const DEFAULT_NATS_URI = 'nats://localhost:4222';
const ENV_PHNQ_SERVICE_NATS = process.env.PHNQ_SERVICE_NATS;
const DEFAULT_NATS_MONITOR_URI = 'nats://localhost:8222';
const ENV_PHNQ_SERVICE_NATS_MONITOR = process.env.PHNQ_SERVICE_NATS_MONITOR;
const ENV_PHNQ_SERVICE_SIGN_SALT = process.env.PHNQ_SERVICE_SIGN_SALT;

const defaultNatsOptions: ConnectionOptions & { monitorUrl?: string } = {
  servers: [ENV_PHNQ_SERVICE_NATS || DEFAULT_NATS_URI],
  monitorUrl: ENV_PHNQ_SERVICE_NATS_MONITOR || DEFAULT_NATS_MONITOR_URI,
};

export interface ServiceInstanceInfo {
  origin: string;
  domain: string | null;
}

export interface ServiceConfig<T extends ServiceApi<T>> {
  nats?: ConnectionOptions & { monitorUrl?: string };
  signSalt?: string;
  handlers?: ServiceApiImpl<T>;
  /** Time (ms) alotted for a response before a timeout error. */
  responseTimeout?: number;
}

type ServiceHandler = (arg: never) => Promise<unknown | AsyncIterableIterator<unknown>>;
export type ServiceApi<T> = Record<keyof T, ServiceHandler>;

export type ServiceApiImpl<T extends Record<keyof T, ServiceHandler>> = {
  [K in keyof T]: (arg: Parameters<T[K]>[0], service: Service<T>) => ReturnType<T[K]>;
};

class Service<T extends ServiceApi<T>> {
  public readonly origin = uuid().replace(/[^\w]/g, '');
  private log: Logger;
  private readonly serviceStats = new ServiceStats({ filter: (_, m) => !['ping', 'getStats'].includes(m) });
  private readonly clientStats = new ServiceStats({ filter: (_, m) => m !== 'getStats' });
  private readonly domain: string | null;
  private readonly config: ServiceConfig<T>;
  private transport: MessageTransport<ServiceRequestMessage, ServiceResponseMessage>;
  private connection?: MessageConnection<ServiceRequestMessage, ServiceResponseMessage>;
  private readonly handlers: Record<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (arg: any, service: Service<T>) => Promise<unknown | AsyncIterableIterator<unknown>>
  >;
  private connected = false;

  public constructor(domain: string | null, config: ServiceConfig<T> = {}) {
    this.log = createLogger(domain || 'client');
    this.domain = domain;
    this.config = config;
    this.transport = DEFAULT_TRANSPORT;
    this.handlers = Object.freeze({
      ...config.handlers,
      ping: async () => 'pong',
      getStats: async () => this.stats,
    });
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
    return Promise.all(peers.map(peer => this.getClient(peer.origin).getStats()));
  }

  public async connect(): Promise<void> {
    const { nats = defaultNatsOptions, signSalt = ENV_PHNQ_SERVICE_SIGN_SALT, responseTimeout } = this.config;

    if (this.connected) {
      return;
    }

    const domain = this.domain;

    this.connected = true;

    this.log('Starting service...');

    const subscriptions: Parameters<typeof NATSTransport.create>[1]['subscriptions'] = [this.origin];

    if (domain) {
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
              return ((p as AnomalyMessage['p'] | ErrorMessage['p']).requestPayload as ServiceRequestMessage).origin;
          }
          return (p as ServiceResponseMessage).origin;
        },
      },
    );

    this.log('Connected to NATS.');

    this.connection = new MessageConnection<ServiceRequestMessage, ServiceResponseMessage>(this.transport, {
      signSalt,
      marshalPayload: p => this.marshalPayload(p),
      unmarshalPayload: p => this.unmarshalPayload(p),
    });

    if (responseTimeout !== undefined) {
      this.connection.responseTimeout = responseTimeout;
    }

    this.connection.onReceive = message => this.handleRequest(message);
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
    const client = this.getClient(this.domain);
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
  public getClient<T = unknown>(domain?: string): T & DefaultClient {
    const { clientStats } = this;
    return new Proxy(
      {},
      {
        get: (_, method: string) => {
          if (method === 'isConnected') {
            return this.isConnected;
          } else if (method === 'stats') {
            return clientStats.stats;
          }

          if (!domain) {
            throw new Anomaly('No domain');
          }

          const start = performance.now();

          return async (payload: unknown) => {
            if (method === 'disconnect') {
              await this.disconnect();
              return;
            }

            await this.connect();

            if (method === 'connect') {
              // Just return if 'connect' is called since connect() is invoked above.
              return;
            }

            if (this.connection) {
              const response = await this.connection.request(
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
                return (async function* () {
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
    ) as T & DefaultClient;
  }

  private handleRequest({
    domain,
    method,
    origin,
    payload,
    contextData,
  }: ServiceRequestMessage): Promise<ServiceResponseMessage | AsyncIterableIterator<ServiceResponseMessage>> {
    const start = process.hrtime.bigint();

    const stats = this.serviceStats;

    const handler = this.handlers[method];
    if (handler) {
      return new Promise<ServiceResponseMessage | AsyncIterableIterator<ServiceResponseMessage>>((resolve, reject) => {
        Context.apply(contextData, async () => {
          try {
            Context.current.getClient = <T>(domain: string): T & DefaultClient => this.getClient(domain);
            const response = await handler(payload, this);
            if (
              typeof response === 'object' &&
              (response as AsyncIterableIterator<ServiceMessage>)[Symbol.asyncIterator]
            ) {
              resolve(
                (async function* (): AsyncIterableIterator<ServiceResponseMessage> {
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
                })(),
              );
            } else {
              const time = Number(process.hrtime.bigint() - start) / 1_000_000;
              stats.record(domain, method, { time });
              resolve({
                origin,
                payload: response,
                stats: { time },
                sharedContextData: Context.current.sharedData,
              });
            }
          } catch (err) {
            stats.record(domain, method, { time: Number(process.hrtime.bigint() - start) / 1_000_000, error: true });
            this.log.error(`Error handling request [${domain}.${method}]`).stack(err);
            reject(err);
          }
        });
      });
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

export default Service;
