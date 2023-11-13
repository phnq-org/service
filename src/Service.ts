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
const ALL_SERVICES_DOMAIN = 'all-services';

interface AllServices {
  checkIn(info: { origin: string; domain: string }): Promise<void>;
  requestCheckIn(): Promise<void>;
}

export interface ServiceInstanceInfo {
  origin: string;
  domain: string;
  lastCheckIn: number;
}

export interface ServiceConfig<T extends ServiceApi<T>> {
  /** Provides a way to address this service. A service with no domain is a client only. */
  domain?: string;
  nats: ConnectionOptions;
  signSalt: string;
  handlers?: { [K in keyof T]: (arg: Parameters<T[K]>[0], service: Service<T>) => ReturnType<T[K]> };
  /** Time (ms) alotted for a response before a timeout error. */
  responseTimeout?: number;
}

type ServiceHandler = (arg: never) => Promise<unknown | AsyncIterableIterator<unknown>>;
export type ServiceApi<T> = Record<keyof T, ServiceHandler>;

export type ApiPlus<T extends Record<keyof T, ServiceHandler>> = {
  [K in keyof T]: (arg: Parameters<T[K]>[0], service: Service<T>) => ReturnType<T[K]>;
};

class Service<T extends ServiceApi<T>> {
  public readonly origin = uuid().replace(/[^\w]/g, '');
  private log: Logger;
  private config: ServiceConfig<T>;
  private transport: MessageTransport<ServiceRequestMessage, ServiceResponseMessage>;
  private connection?: MessageConnection<ServiceRequestMessage, ServiceResponseMessage>;
  private readonly handlers: Record<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (arg: any, service: Service<T>) => Promise<unknown | AsyncIterableIterator<unknown>>
  > &
    AllServices;
  private connected = false;
  private allServicesClient = this.getClient<AllServices>(ALL_SERVICES_DOMAIN);
  private readonly peerServiceInstanceInfos: ServiceInstanceInfo[] = [];
  private checkInPid?: NodeJS.Timer;

  public constructor(config: ServiceConfig<T>) {
    this.log = createLogger(config.domain || 'client');
    this.config = config;
    this.transport = DEFAULT_TRANSPORT;
    this.handlers = Object.freeze({
      ...config.handlers,
      ping: async () => 'pong',
      checkIn: ({ origin, domain }) => {
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
      requestCheckIn: () => {
        if (config.domain) {
          this.allServicesClient.checkIn({ origin: this.origin, domain: config.domain });
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

    this.connected = true;

    this.log('Starting service...');

    /**
     * Create a NATS transport.
     * This configiration deterimines how messages are routed.
     */
    this.transport = await NATSTransport.create(nats, {
      /**
       * This service listens for incoming messages on the following subjects:
       * - `origin` (uuid) messages sent directly to this service instance.
       * - `domain` (string) messages sent to this service's domain.
       * - `all-services` messages sent to all services.
       */
      subscriptions: [this.origin, domain, ALL_SERVICES_DOMAIN].filter(Boolean) as string[],
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
    });

    this.log('Connected to NATS.');

    this.connection = new MessageConnection<ServiceRequestMessage, ServiceResponseMessage>(this.transport, {
      signSalt,
      marshalPayload: p => this.marshalPayload(p),
      unmarshalPayload: p => this.unmarshalPayload(p),
    });

    if (domain) {
      this.allServicesClient.checkIn({ origin: this.origin, domain });
      /**
       * After the immediate checkin above, start periodic checkins, but only after a random
       * delay of up to `CHECK_IN_INTERVAL`. This is to avoid all services checking in at
       * the same time.
       */
      setTimeout(() => {
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

    this.connection.onReceive = message => this.handleRequest(message);
  }

  public async disconnect(): Promise<void> {
    if (this.connected) {
      this.connected = false;
      if (this.checkInPid) {
        clearInterval(this.checkInPid);
      }
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
    let lastServiceOrigin: string;

    /**
     * Looks up the service origin(s) for the client's domain and returns the next one
     * based on a round-robin algorithm.
     */
    const getServiceOrigin = async (): Promise<string> => {
      let serviceOrigins = this.peerServiceInstanceInfos.filter(i => i.domain === domain).map(i => i.origin);
      if (serviceOrigins.length === 0) {
        this.log('Cannot find service instance for domain `%s`. Roll call.', domain);
        await this.allServicesClient.requestCheckIn();
        await sleep(500);
        serviceOrigins = this.peerServiceInstanceInfos.filter(i => i.domain === domain).map(i => i.origin);
      }
      if (serviceOrigins.length === 0) {
        throw new Error(`No service instances found for domain: ${domain}`);
      }
      const serviceOriginIndex = (serviceOrigins.indexOf(lastServiceOrigin) + 1) % serviceOrigins.length;
      lastServiceOrigin = serviceOrigins[serviceOriginIndex];
      return lastServiceOrigin;
    };

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
              if (method === 'rollCall') {
                await this.allServicesClient.requestCheckIn();
                await sleep(500);
                return this.peerServiceInstanceInfos;
              }

              const response = await this.connection.request(
                {
                  domain: domain === ALL_SERVICES_DOMAIN ? domain : await getServiceOrigin(),
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
            Context.current.getClient = <T>(domain: string): T & DefaultClient => this.getClient(domain);
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

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export default Service;
