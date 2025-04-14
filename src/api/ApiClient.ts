import { createLogger } from '@phnq/log';
import { Anomaly } from '@phnq/message';
import { WebSocketMessageClient } from '@phnq/message/WebSocketMessageClient';

import AuthApi from '../auth/AuthApi';
import { API_SERVICE_DOMAIN } from '../domains';
import { ServiceApi } from '../Service';
import { StandaloneClient } from '../ServiceClient';
import ServiceError from '../ServiceError';
import { ApiRequestMessage, ApiResponseMessage } from './ApiMessage';

const log = createLogger('ApiClient');

interface ApiRequestEvent {
  type: 'request';
}

interface ApiResponseEvent {
  type: 'response';
  req: ApiRequestEvent;
}

interface ApiErrorEvent {
  type: 'error';
  req: ApiRequestEvent;
  err: ServiceError;
}

type ApiClientEvent = {
  domain: string;
  method: string;
  payload: unknown;
  ts: number;
} & (ApiResponseEvent | ApiRequestEvent | ApiErrorEvent);

const handlers: Record<ApiClientEvent['type'], ((event: ApiClientEvent) => void)[]> = {
  request: [],
  response: [],
  error: [],
};

const emit = <T extends ApiClientEvent>(event: T): T => {
  for (const handler of handlers[event.type]) {
    try {
      handler(event);
    } catch (err) {
      log.error('Error in API client event handler:', err);
    }
  }
  return event;
};

class ApiClient {
  public static on<T extends ApiClientEvent['type']>(
    eventType: T,
    fn: (event: ApiClientEvent & { type: T }) => void,
  ): (event: ApiClientEvent & { type: T }) => void {
    handlers[eventType].push(fn as never);
    return fn;
  }

  public static off<T extends ApiClientEvent['type']>(
    eventType: T,
    fn: (
      event: ApiClientEvent & {
        type: T;
      },
    ) => void,
  ): void {
    handlers[eventType] = handlers[eventType].filter(h => h !== fn);
  }

  public static createAuthClient(url: string): AuthApi['handlers'] & Omit<StandaloneClient, 'stats' | 'getStats'> {
    return this.create<AuthApi>('phnq-auth', url);
  }

  public static create<
    T extends ServiceApi<D>,
    N extends { type: string } | undefined = undefined,
    D extends string = T['domain'],
  >(domain: D, url: string, onNotify?: (msg: N) => void): T['handlers'] & Omit<StandaloneClient, 'stats' | 'getStats'> {
    let wsClient: WebSocketMessageClient<ApiRequestMessage, ApiResponseMessage> | undefined;
    return new Proxy(
      {},
      {
        get: (_, method: string) => {
          if (method === 'isConnected') {
            return wsClient !== undefined && wsClient.isOpen();
          } else if (['stats', 'getStats'].includes(method)) {
            throw new Error(`Method not available in client: ${method}`);
          }

          return async (payload: unknown) => {
            const req = emit({
              type: 'request',
              domain,
              method,
              payload,
              ts: Date.now(),
            });

            try {
              if (method === 'disconnect') {
                if (wsClient !== undefined && wsClient.isOpen()) {
                  await wsClient.close();
                }
                return;
              }

              if (!wsClient) {
                wsClient = WebSocketMessageClient.create<ApiRequestMessage, ApiResponseMessage>(url);

                wsClient.addReceiveHandler(async ({ domain: notifyDomain, method, payload }) => {
                  if (onNotify && [domain, API_SERVICE_DOMAIN].includes(notifyDomain)) {
                    switch (method) {
                      case 'notify':
                        return onNotify(payload as N);
                    }
                  }
                });
              }

              if (method === 'connect') {
                // connect is handled lazily in WebSocketMessageClient.
                return;
              }

              const response = await wsClient.request({ domain, method, payload });

              if (
                typeof response === 'object' &&
                (response as AsyncIterableIterator<ApiResponseMessage>)[Symbol.asyncIterator]
              ) {
                const responseIter = response as AsyncIterableIterator<ApiResponseMessage>;
                return (async function* () {
                  for await (const { payload } of responseIter) {
                    emit({
                      type: 'response',
                      domain,
                      method,
                      payload,
                      req,
                      ts: Date.now(),
                    });
                    yield payload;
                  }
                })();
              } else {
                emit({
                  type: 'response',
                  domain,
                  method,
                  payload: (response as ApiResponseMessage).payload,
                  req,
                  ts: Date.now(),
                });

                return (response as ApiResponseMessage).payload;
              }
            } catch (err) {
              const serviceError =
                err instanceof Anomaly
                  ? err.info
                    ? ServiceError.fromPayload(err.info) ?? new ServiceError({ type: 'anomaly', message: err.message })
                    : new ServiceError({ type: 'anomaly', message: err.message })
                  : ServiceError.fromError(err);

              emit({
                type: 'error',
                domain,
                method,
                payload: serviceError,
                req,
                err: serviceError,
                ts: Date.now(),
              });

              throw serviceError;
            }
          };
        },
      },
    ) as T['handlers'] & StandaloneClient;
  }
}

export default ApiClient;
