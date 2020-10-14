import { createLogger } from '@phnq/log';
import { MessageConnection } from '@phnq/message';
import { WebSocketMessageServer } from '@phnq/message/WebSocketMessageServer';
import http from 'http';

import Context, { ContextData } from '../../Context';
import Service, { ServiceConfig } from '../../Service';
import { ApiRequestMessage, ApiResponseMessage } from '../ApiMessage';

const log = createLogger('WebSocketApiService');

interface Config extends ServiceConfig {
  port: number;
  authTokenCookie?: string;
}

class WebSocketApiService {
  private config: Config;
  private httpServer: http.Server;
  private wsServer: WebSocketMessageServer<ApiRequestMessage, ApiResponseMessage>;
  private apiService: Service;

  constructor(config: Config) {
    this.config = config;
    this.httpServer = http.createServer();
    this.apiService = new Service(this.config);
    this.wsServer = new WebSocketMessageServer<ApiRequestMessage, ApiResponseMessage>({
      httpServer: this.httpServer,
    });
    this.wsServer.onConnect = (conn, req) => this.onConnect(conn, req);
    this.wsServer.onReceive = (conn, message) => this.onReceiveClientMessage(conn, message);
  }

  public async start(): Promise<void> {
    const { port } = this.config;

    log('Starting server...');
    await new Promise((resolve, reject): void => {
      try {
        this.httpServer.listen({ port: port }, resolve);
      } catch (err) {
        reject(err);
      }
    });
    log('Server listening on port %d', port);

    log('Connecting to pub/sub...');
    await this.apiService.connect();
    log('Connected to pub/sub.');
  }

  public async stop(): Promise<void> {
    log('Stopping server...');
    await this.wsServer.close();

    if (this.httpServer.listening) {
      await new Promise((resolve, reject): void => {
        try {
          this.httpServer.close((): void => {
            resolve();
          });
        } catch (err) {
          reject(err);
        }
      });
    }

    log('Disconnecting from pub/sub...');
    await this.apiService.disconnect();

    log('Stopped.');
  }

  private async onConnect(
    conn: MessageConnection<ApiRequestMessage, ApiResponseMessage>,
    req: http.IncomingMessage,
  ): Promise<void> {
    conn.setData('langs', getLangs(req));

    const authToken = getAuthToken(req, this.config.authTokenCookie);
    if (authToken) {
      conn.setData('authToken', authToken);
    }
  }

  private async onReceiveClientMessage(
    conn: MessageConnection<ApiRequestMessage, ApiResponseMessage>,
    { domain, method, payload }: ApiRequestMessage,
  ): Promise<ApiResponseMessage | AsyncIterableIterator<ApiResponseMessage>> {
    const context: ContextData = {
      authToken: conn.getData<string | undefined>('authToken'),
      langs: conn.getData<string[]>('langs'),
    };

    const serviceClient = this.apiService.getClient<{
      [key: string]: (payload: unknown) => Promise<unknown | AsyncIterableIterator<unknown>>;
    }>(domain);

    const response = await new Promise<unknown | AsyncIterableIterator<unknown>>((resolve, reject) => {
      Context.apply(context, async () => {
        try {
          resolve(await serviceClient[method](payload));
        } catch (err) {
          reject(err);
        }
      });
    });

    if (typeof response === 'object' && (response as AsyncIterableIterator<unknown>)[Symbol.asyncIterator]) {
      return (async function* (): AsyncIterableIterator<ApiResponseMessage> {
        for await (const payload of response as AsyncIterableIterator<unknown>) {
          conn.setData('authToken', Context.current.authToken);
          yield { payload, stats: 0 };
        }
      })();
    } else {
      conn.setData('authToken', Context.current.authToken);
      return { payload: response, stats: 0 };
    }
  }
}

export default WebSocketApiService;

const getLangs = (req: http.IncomingMessage): string[] => {
  const acceptLangHeader = req.headers['accept-language'];
  if (acceptLangHeader) {
    return acceptLangHeader.split(',').map(lang => lang.split(';')[0]);
  }
  return ['en'];
};

const getAuthToken = (req: http.IncomingMessage, cookieName?: string): string | undefined =>
  cookieName ? getParsedCookie(req.headers.cookie)[cookieName] : undefined;

const getParsedCookie = (cookie = ''): { [key: string]: string } =>
  cookie
    .split(/\s*;\s*/)
    .map(c => c.split('='))
    .reduce((o, t) => ({ ...o, [t[0]]: decodeURIComponent(t[1]) }), {});
