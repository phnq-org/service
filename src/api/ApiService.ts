import assert from "node:assert";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { createLogger } from "@phnq/log";
import { Anomaly, type MessageConnection, WebSocketMessageServer } from "@phnq/message";
import Context, {
  dispatchContextEvent,
  type RequestContext,
  type SessionContext,
} from "../Context";
import { API_SERVICE_DOMAIN } from "../domains";
import Service from "../Service";
import ServiceClient from "../ServiceClient";
import type { ApiRequestMessage, ApiResponseMessage, NotifyApi } from "./ApiMessage";

const log = createLogger("ApiService");

interface Config {
  secure?: false;
  port: number;
  transformResponsePayload?: (payload: unknown, message: ApiRequestMessage) => unknown;
  transformRequestPayload?: (payload: unknown, message: ApiRequestMessage) => unknown;
  path?: string;
  paths?: string[];
  pingPath?: string;
  logConnections?: boolean;
}

interface SecureConfig extends Omit<Config, "secure"> {
  secure: true;
  keyPath: string;
  certPath: string;
}

class ApiService extends Service<NotifyApi> {
  private apiServiceConfig: Config | SecureConfig;
  private wsServer: WebSocketMessageServer<ApiRequestMessage, ApiResponseMessage, SessionContext>;
  private readonly _httpServer: http.Server;
  private subscriptions: { connectionId: string; topic: string }[] = [];
  public onHttpRequest: (
    req: http.IncomingMessage,
    res: http.ServerResponse<http.IncomingMessage> & {
      req: http.IncomingMessage;
    },
  ) => void = (_, res) => {
    res.writeHead(404);
    res.end();
  };

  constructor(config: Config | SecureConfig) {
    super("_phnq-api", {
      ...config,
      handlers: {
        notify: async (m) => {
          const connections = this.subscriptions
            .filter(({ topic }) => topic === m.recipient.topic)
            .map((sub) => this.wsServer.getConnection(sub.connectionId))
            .filter((conn) => !!conn);

          for (const conn of connections) {
            conn.send({
              domain: m.domain || API_SERVICE_DOMAIN,
              method: "notify",
              payload: m.payload,
            });
          }
        },

        subscribe: async ({ connectionId, topic }) => {
          this.addSubscription({ connectionId, topic });
        },

        unsubscribe: async ({ connectionId, topic }) => {
          this.removeSubscription({ connectionId, topic });
        },

        destroyTopic: async ({ topic }) => {
          this.removeAllSubscriptions({ topic });
        },
      },
    });

    this.apiServiceConfig = config;

    const { path, paths, pingPath = path ?? paths?.[0] ?? "/", secure } = config;

    if (path && paths) {
      throw new Error("Cannot specify both 'path' and 'paths'");
    }

    if (secure) {
      const { keyPath, certPath } = config as SecureConfig;
      this._httpServer = https.createServer({
        key: readFileSync(keyPath),
        cert: readFileSync(certPath),
      });
    } else {
      this._httpServer = http.createServer();
    }

    this.wsServer = new WebSocketMessageServer<
      ApiRequestMessage,
      ApiResponseMessage,
      SessionContext
    >({
      path,
      paths,
      httpServer: this.httpServer,
    });
    this.httpServer.on("request", (req, res) => {
      if (req.url === pingPath) {
        res.writeHead(200);
        res.end();
      } else {
        this.onHttpRequest(req, res);
      }
    });
    this.wsServer.onConnect = (conn, req) => this.onConnect(conn, req);
    this.wsServer.onDisconnect = (conn) => this.onDisconnect(conn);
    this.wsServer.onReceive = (conn, message) => this.onReceiveClientMessage(conn, message);
  }

  get httpServer(): http.Server {
    return this._httpServer;
  }

  public async start(): Promise<void> {
    const { port } = this.apiServiceConfig;

    log("Starting server...");
    await new Promise<void>((resolve, reject): void => {
      try {
        this.httpServer.listen({ port: port }, resolve);
      } catch (err) {
        reject(err);
      }
    });
    log("Server listening on port %d", port);

    log("Connecting to pub/sub...");
    await this.connect();
    log("Connected to pub/sub.");
  }

  public async stop(): Promise<void> {
    log("Stopping server...");
    await this.wsServer.close();

    if (this.httpServer.listening) {
      await new Promise<void>((resolve, reject): void => {
        try {
          this.httpServer.closeAllConnections();

          this.httpServer.close((): void => {
            resolve();
          });
        } catch (err) {
          reject(err);
        }
      });
    }

    log("Disconnecting from pub/sub...");
    await this.disconnect();

    log("Stopped.");
  }

  public logSubscriptions() {
    log("subscriptipons", this.subscriptions);
  }

  private addSubscription(subscription: { connectionId: string; topic: string }) {
    log("Adding subscription:", subscription);
    this.subscriptions.push(subscription);
  }

  private removeSubscription(subscription: { connectionId: string; topic: string }) {
    log("Removing subscription:", subscription);
    const { connectionId, topic } = subscription;
    this.subscriptions = this.subscriptions.filter(
      (s) => !(s.connectionId === connectionId && s.topic === topic),
    );
  }

  private removeAllSubscriptions({ connectionId }: { connectionId: string }): void;
  private removeAllSubscriptions({ topic }: { topic: string }): void;
  private removeAllSubscriptions(info: { topic: string } | { connectionId: string }) {
    if ("topic" in info) {
      log("Removing all subscriptions for topic", info.topic);
      this.subscriptions = this.subscriptions.filter((s) => s.topic !== info.topic);
    } else {
      log("Removing all subscriptions for connectionId", info.connectionId);
      this.subscriptions = this.subscriptions.filter((s) => s.connectionId !== info.connectionId);
    }
  }

  /**
   * This is where WebSocket connections are established. Both the initial
   * HTTP request and the underlying MessageConnection abstraction are available
   * here as parameters. It is a convenient place to harvest headers from the
   * HTTP request for the purpose of storing connection-persisnet data.
   */
  private async onConnect(
    conn: MessageConnection<ApiRequestMessage, ApiResponseMessage, SessionContext>,
    req: http.IncomingMessage,
  ): Promise<void> {
    if (this.apiServiceConfig.logConnections) {
      log("Connected:", conn.id);
    }

    assert(req.url, "Request URL is required");

    conn.setAttribute("connectionId", conn.id);
    conn.setAttribute("connectionPath", req.url);
    conn.setAttribute("langs", getLangs(req));

    this.addSubscription({ connectionId: conn.id, topic: conn.id });
  }

  private async onDisconnect(
    conn: MessageConnection<ApiRequestMessage, ApiResponseMessage, SessionContext>,
  ): Promise<void> {
    if (this.apiServiceConfig.logConnections) {
      log("Disconnected:", conn.id);
    }

    this.removeAllSubscriptions({ connectionId: conn.id });
  }

  private checkAccess(domain: string, method: string): void {
    if (domain.trim().charAt(0) === "_" || method.trim().charAt(0) === "_") {
      throw new Anomaly(`Inaccessible: ${domain}.${method}`);
    }
  }

  private async onReceiveClientMessage(
    conn: MessageConnection<ApiRequestMessage, ApiResponseMessage, SessionContext>,
    requestMessage: ApiRequestMessage,
  ): Promise<ApiResponseMessage | AsyncIterableIterator<ApiResponseMessage>> {
    const { transformRequestPayload = (p) => p, transformResponsePayload = (p) => p } =
      this.apiServiceConfig;

    const { domain, method, payload: payloadRaw } = requestMessage;

    this.checkAccess(domain, method);

    const requestContext: Partial<RequestContext> = {
      originDomain: domain,
    };

    const sessionContext = conn.attributes;

    const serviceClient = ServiceClient.get<{
      domain: typeof domain;
      handlers: Record<
        string,
        (payload: unknown) => Promise<unknown | AsyncIterableIterator<unknown>>
      >;
    }>(domain);

    const payload = transformRequestPayload(payloadRaw, requestMessage);

    return Context.apply(requestContext, sessionContext, async () => {
      try {
        await dispatchContextEvent("api:request", { domain, method, payload });

        const response = await serviceClient[method]?.(payload);
        if (
          typeof response === "object" &&
          (response as AsyncIterableIterator<unknown>)[Symbol.asyncIterator]
        ) {
          return (async function* (): AsyncIterableIterator<ApiResponseMessage> {
            await Context.enter(requestContext, sessionContext);
            for await (const payload of response as AsyncIterableIterator<unknown>) {
              yield { payload: transformResponsePayload(payload, requestMessage), stats: 0 };
            }
            for (const [k, v] of Object.entries(Context.current.sessionContext)) {
              conn.setAttribute(k as keyof SessionContext, v);
            }
            Context.exit();
          })();
        } else {
          for (const [k, v] of Object.entries(Context.current.sessionContext)) {
            conn.setAttribute(k as keyof SessionContext, v);
          }

          return { payload: transformResponsePayload(response, requestMessage), stats: 0 };
        }
      } catch (err) {
        await dispatchContextEvent("api:error", { error: err, domain, method, payload });
        throw err;
      }
    });
  }
}

export default ApiService;

const getLangs = (req: http.IncomingMessage): string[] => {
  const acceptLangHeader = req.headers["accept-language"];
  if (acceptLangHeader) {
    const langs = acceptLangHeader
      .split(",")
      .map((lang) => lang.split(";")[0])
      .filter((l) => l !== undefined);
    if (langs.length > 0) {
      return langs;
    }
  }
  return ["en"];
};
