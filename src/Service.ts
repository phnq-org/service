import { createLogger } from '@phnq/log';
import { Logger } from '@phnq/log/logger';
import { Anomaly, AnomalyMessage, ErrorMessage, MessageConnection, MessageTransport, MessageType } from '@phnq/message';
import { NATSTransport } from '@phnq/message/transports/NATSTransport';
import { ConnectionOptions } from 'nats';
import { v4 as uuid } from 'uuid';

import Context from './Context';
import { DefaultClient } from './ServiceClient';
import { ServiceMessage, ServiceRequestMessage, ServiceResponseMessage } from './ServiceMessage';

const CHECK_IN_INTERVAL = 10 * 1000;
const PEER_PRUNE_THRESHOLD = 30 * 1000;

interface AllServicesClient {
  checkIn(info: { origin: string; domain: string }): void;
}

export interface ServiceInstanceInfo {
  origin: string;
  domain: string;
  lastCheckIn: number;
}

export interface ServiceConfig {
  /** Provides a way to address this service. A service with no domain is a client only. */
  domain?: string;
  nats: ConnectionOptions;
  signSalt: string;
  handlers?: { [key: string]: ServiceHandler };
  /** Time (ms) alotted for a response before a timeout error. */
  responseTimeout?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceHandler = (requestPayload: any, service: Service) => Promise<unknown | AsyncIterableIterator<unknown>>;

class Service {
  public readonly origin = uuid().replace(/[^\w]/g, '');
  private log: Logger;
  private config: ServiceConfig;
  private transport: MessageTransport<ServiceRequestMessage, ServiceResponseMessage>;
  private connection?: MessageConnection<ServiceRequestMessage, ServiceResponseMessage>;
  private readonly handlers: { [key: string]: ServiceHandler };
  private connected = false;
  private allServicesClient = this.getClient<AllServicesClient>('all-services');
  private readonly peerServiceInstanceInfos: ServiceInstanceInfo[] = [];
  private checkInPid?: NodeJS.Timer;

  public constructor(config: ServiceConfig) {
    this.log = createLogger(config.domain || 'client');
    this.config = config;
    this.transport = DEFAULT_TRANSPORT;
    this.handlers = Object.freeze({
      ...config.handlers,
      ping: async () => 'pong',
      checkIn: ({ origin, domain }: Parameters<AllServicesClient['checkIn']>[0]) => {
        if (origin !== this.origin) {
          const instance = this.peerServiceInstanceInfos.find(i => i.origin === origin);
          if (instance) {
            instance.lastCheckIn = Date.now();
          } else {
            this.peerServiceInstanceInfos.push({ origin, domain, lastCheckIn: Date.now() });
          }
        }
        return Promise.resolve();
      },
    });
    if (config.domain) {
      this.peerServiceInstanceInfos.push({ origin: this.origin, domain: config.domain, lastCheckIn: 0 });
    }
  }

  public get isConnected(): boolean {
    return this.connected;
  }

  /**
   * Returns a list of peer service instances that have checked in within the last 30 seconds.
   * A peer service instance is a service instance that is using the same NATS server.
   */
  public get peerServiceInfos(): ServiceInstanceInfo[] {
    return this.peerServiceInstanceInfos;
  }

  public async connect(): Promise<void> {
    const { domain, nats, signSalt, responseTimeout } = this.config;

    if (this.connected) {
      return;
    }

    this.log('Starting service...');

    this.transport = await NATSTransport.create(nats, {
      subscriptions: [this.origin, domain, domain && 'all-services'].filter(Boolean) as string[],
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
    });

    this.log('Connected to NATS.');

    this.connection = new MessageConnection<ServiceRequestMessage, ServiceResponseMessage>(this.transport, {
      signSalt,
      marshalPayload: p => this.marshalPayload(p),
      unmarshalPayload: p => this.unmarshalPayload(p),
    });

    if (domain) {
      setTimeout(() => {
        this.allServicesClient.checkIn({ origin: this.origin, domain });
        this.checkInPid = setInterval(() => {
          this.allServicesClient.checkIn({ origin: this.origin, domain });
          const now = Date.now();
          let i = this.peerServiceInstanceInfos.length;
          while (i--) {
            const instance = this.peerServiceInstanceInfos[i];
            if (instance.origin !== this.origin && now - instance.lastCheckIn > PEER_PRUNE_THRESHOLD) {
              this.log('Pruning peer service instance: %s (%s)', instance.origin, instance.domain);
              this.peerServiceInstanceInfos.splice(i, 1);
            }
          }
        }, CHECK_IN_INTERVAL);
      }, Math.round(Math.random() * CHECK_IN_INTERVAL));
    }

    if (responseTimeout !== undefined) {
      this.connection.responseTimeout = responseTimeout;
    }

    if (domain) {
      this.connection.onReceive = message => this.handleRequest(message);
    }

    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    if (this.connected) {
      if (this.checkInPid) {
        clearInterval(this.checkInPid);
      }

      await this.transport.close();
      this.connected = false;
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
    if (!this.config.domain) {
      throw new Error('testLatency requires a configured domain');
    }
    const client = this.getClient(this.config.domain);
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
  public getClient<T = unknown>(domain: string): T & DefaultClient {
    return new Proxy(
      {},
      {
        get: (_, method: string) => {
          if (method === 'isConnected') {
            return this.isConnected;
          }

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
                  for await (const { payload, sharedContextData } of responseIter) {
                    Context.current.merge(sharedContextData);
                    yield payload;
                  }
                })();
              } else if (response) {
                const { payload, sharedContextData } = response as ServiceResponseMessage;
                Context.current.merge(sharedContextData);
                return payload;
              }
            } else {
              // This should never happen.
              this.log.error('No connection');
            }
          };
        },
      },
    ) as T & DefaultClient;
  }

  private handleRequest({
    method,
    origin,
    payload,
    contextData,
  }: ServiceRequestMessage): Promise<ServiceResponseMessage | AsyncIterableIterator<ServiceResponseMessage>> {
    const start = process.hrtime.bigint();

    const handler = this.handlers[method];
    if (handler) {
      return new Promise<ServiceResponseMessage | AsyncIterableIterator<ServiceResponseMessage>>((resolve, reject) => {
        Context.apply(contextData, async () => {
          try {
            Context.current.getClient = <T = unknown>(domain: string): T & DefaultClient => this.getClient(domain);
            const response = await handler(payload, this);
            if (
              typeof response === 'object' &&
              (response as AsyncIterableIterator<ServiceMessage>)[Symbol.asyncIterator]
            ) {
              resolve(
                (async function* (): AsyncIterableIterator<ServiceResponseMessage> {
                  for await (const payload of response as AsyncIterableIterator<ServiceResponseMessage>) {
                    yield {
                      origin,
                      payload,
                      stats: { time: Number(process.hrtime.bigint() - start) },
                      sharedContextData: Context.current.sharedData,
                    };
                  }
                })(),
              );
            } else {
              resolve({
                origin,
                payload: response,
                stats: { time: Number(process.hrtime.bigint() - start) / 1_000_000 },
                sharedContextData: Context.current.sharedData,
              });
            }
          } catch (err) {
            this.log.error(`Error handling request [${method}]`).stack(err);
            reject(err);
          }
        });
      });
    }
    throw new Anomaly(`No handler for method: ${method}`);
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

export default Service;
