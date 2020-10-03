import { createLogger } from '@phnq/log';
import { Logger } from '@phnq/log/logger';
import { Anomaly, AnomalyMessage, ErrorMessage, MessageConnection, MessageTransport, MessageType } from '@phnq/message';
import { NATSTransport } from '@phnq/message/transports/NATSTransport';
import { NatsConnectionOptions } from 'ts-nats';
import { v4 as uuid } from 'uuid';

import { DefaultClient, RequestMessage, ResponseMessage, ServiceHandler, ServiceMessage } from './types';

export interface ServiceConfig {
  domain?: string;
  nats: NatsConnectionOptions;
  signSalt: string;
}

class Service {
  private log: Logger;
  private config: ServiceConfig;
  private transport: MessageTransport<RequestMessage, ResponseMessage>;
  private connection?: MessageConnection<RequestMessage, ResponseMessage>;
  private handlers = new Map<string, ServiceHandler>();
  private readonly origin = uuid().replace(/[^\w]/g, '');
  private connected = false;

  public constructor(config: ServiceConfig) {
    this.log = createLogger(config.domain || 'client');
    this.config = config;
    this.transport = DEFAULT_TRANSPORT;
  }

  public get isConnected(): boolean {
    return this.connected;
  }

  public async connect(): Promise<void> {
    const { domain, nats, signSalt } = this.config;

    if (this.connected) {
      return;
    }

    this.log('Starting service...');

    this.transport = await NATSTransport.create(nats, {
      subscriptions: [domain, this.origin].filter(Boolean) as string[],
      publishSubject: ({ t, p }) => {
        switch (t) {
          case MessageType.Request:
            return (p as RequestMessage).domain;
          case MessageType.Anomaly:
          case MessageType.Error:
            return ((p as AnomalyMessage['p'] | ErrorMessage['p']).requestPayload as RequestMessage).origin;
        }
        return (p as ResponseMessage).origin;
      },
    });

    this.log('Connected to NATS.');

    this.connection = new MessageConnection<RequestMessage, ResponseMessage>(this.transport, {
      signSalt,
      marshalPayload: p => this.marshalPayload(p),
      unmarshalPayload: p => this.unmarshalPayload(p),
    });

    if (domain) {
      this.connection.onReceive = message => this.handleRequest(message);
      this.handlers.set('ping', () => Promise.resolve('pong'));
    }

    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    if (this.connected) {
      await this.transport.close();
      this.connected = false;
    }
  }

  public setHandler(method: string, handler: ServiceHandler): void {
    if (!this.config.domain) {
      throw new Error('Handlers can only be set if a domain is configured');
    }

    this.handlers.set(method, handler);
  }

  public deleteHandler(method: string): void {
    this.handlers.delete(method);
  }

  /**
   * Returns the total time to fulfill a simple request from the client's perspective. This
   * round trip enatils 4 message transfers:
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

            const response = await this.connection!.request({ domain, origin: this.origin, method, payload });

            if (
              typeof response === 'object' &&
              (response as AsyncIterableIterator<ServiceMessage>)[Symbol.asyncIterator]
            ) {
              const responseIter = response as AsyncIterableIterator<ResponseMessage>;
              return (async function* () {
                for await (const comp of responseIter) {
                  yield comp.payload;
                }
              })();
            } else {
              return (response as ResponseMessage).payload;
            }
          };
        },
      },
    ) as T & DefaultClient;
  }

  private async handleRequest({
    method,
    origin,
    payload,
  }: RequestMessage): Promise<ResponseMessage | AsyncIterableIterator<ResponseMessage>> {
    const start = process.hrtime.bigint();
    const handler = this.handlers.get(method);
    if (handler) {
      const response = await handler(payload);
      if (typeof response === 'object' && (response as AsyncIterableIterator<ServiceMessage>)[Symbol.asyncIterator]) {
        return (async function* (): AsyncIterableIterator<ResponseMessage> {
          for await (const payload of response as AsyncIterableIterator<ResponseMessage>) {
            yield { origin, payload, stats: { time: Number(process.hrtime.bigint() - start) } };
          }
        })();
      } else {
        return { origin, payload: response, stats: { time: Number(process.hrtime.bigint() - start) / 1_000_000 } };
      }
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
