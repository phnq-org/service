import { WebSocketMessageClient } from '@phnq/message/WebSocketMessageClient';

import { ServiceApi } from '../Service';
import { StandaloneClient } from '../ServiceClient';
import { ApiRequestMessage, ApiResponseMessage } from './ApiMessage';

class ApiClient {
  public static create<T extends ServiceApi<T>>(domain: string, url: string): T & StandaloneClient {
    let wsClient: WebSocketMessageClient<ApiRequestMessage, ApiResponseMessage> | undefined;
    return new Proxy(
      {},
      {
        get: (_, method: string) => {
          if (method === 'isConnected') {
            return wsClient !== undefined && wsClient.isOpen();
          }

          return async (payload: unknown) => {
            if (method === 'disconnect') {
              if (wsClient !== undefined && wsClient.isOpen()) {
                await wsClient.close();
              }
              return;
            }

            if (!wsClient) {
              wsClient = WebSocketMessageClient.create<ApiRequestMessage, ApiResponseMessage>(url);
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
                  yield payload;
                }
              })();
            } else {
              return (response as ApiResponseMessage).payload;
            }
          };
        },
      },
    ) as T & StandaloneClient;
  }
}

export default ApiClient;
