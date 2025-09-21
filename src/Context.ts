import { AsyncLocalStorage } from "node:async_hooks";
import type { ApiNotificationMessage, NotifyApi } from "./api/ApiMessage";
import type { ServiceApi } from "./Service";
import type { DefaultClient } from "./ServiceClient";

const contextLocalStorage = new AsyncLocalStorage<Context<RequestContext, SessionContext>>();

export type Serializable =
  | string
  | number
  | boolean
  | null
  | undefined
  | Serializable[]
  | SerializableObject;

interface SerializableObject {
  [key: string]: Serializable;
}

export interface RequestContext {
  originDomain: string;
}

export interface SessionContext {
  connectionId: string;
  langs: string[];
  identity: string;
}

class Context<R extends RequestContext, S extends SessionContext> {
  private _requestContext: Partial<R>;
  private _sessionContext: Partial<S>;

  public constructor(requestContext: Partial<R>, sessionContext: Partial<S>) {
    this._requestContext = requestContext;
    this._sessionContext = sessionContext;
  }

  public get requestContext() {
    return this._requestContext;
  }

  public get sessionContext() {
    return this._sessionContext;
  }

  public getClient<T extends ServiceApi<D>, D extends string = T["domain"]>(
    domain: D,
  ): T["handlers"] & DefaultClient {
    throw new Error(`No client for domain ${domain}`);
  }

  /**
   * Send a notification to the given recipient. The payload must have a `type` attribute.
   * If no recipient is provided, the notification will be sent as a push on the WebSocket
   * connection associated with the current context.
   * @param payload
   * @param recipient
   * @returns
   */
  public notify<P extends { type: string }>(
    payload: P,
    recipient?: ApiNotificationMessage["recipient"],
  ): Promise<void> {
    const recip = recipient || (this.connectionId ? { id: this.connectionId } : undefined);
    if (!recip) {
      throw new Error("No recipient set and could not derive one.");
    }
    return this.getClient<NotifyApi>("_phnq-api").notify({
      recipient: recip,
      payload,
      domain: this.domain,
    });
  }

  public get<K extends keyof R>(key: K): Partial<R>[K];
  public get<K extends keyof S>(key: K): Partial<S>[K];
  public get<K extends keyof (R & S)>(key: K) {
    if (key in this._requestContext) {
      return this._requestContext[key as keyof R];
    }
    if (this._sessionContext && key in this._sessionContext) {
      return this._sessionContext[key as keyof S];
    }
  }

  public setRequest<K extends keyof R>(key: K, val: R[K] | null): void {
    this._requestContext = { ...this._requestContext, [key]: val };
  }

  public setSession<K extends keyof S>(key: K, val: S[K] | null): void {
    this._sessionContext = { ...(this._sessionContext ?? {}), [key]: val } as Partial<S>;
  }

  public merge(sessionContext: Partial<SessionContext>) {
    this._sessionContext = { ...this._sessionContext, ...sessionContext };
  }

  public get identity() {
    return this.get("identity");
  }

  public get domain() {
    return this.get("originDomain");
  }

  public get langs() {
    return this.get("langs");
  }

  public get connectionId() {
    return this.get("connectionId");
  }
}

export const createContextFactory = <
  R extends RequestContext = RequestContext,
  S extends SessionContext = SessionContext,
>() => {
  function apply(r: Partial<R>, s: Partial<S>): void;
  function apply<T>(r: Partial<R>, s: Partial<S>, fn: () => Promise<T>): Promise<T>;
  function apply<T>(r: Partial<R>, s: Partial<S>, fn?: () => Promise<T>): Promise<T> | undefined {
    if (fn) {
      return new Promise<T>((resolve) => {
        contextLocalStorage.run(new Context(r, s), () => resolve(fn()));
      });
    } else {
      contextLocalStorage.enterWith(new Context(r, s));
    }
  }

  return {
    apply,

    get current() {
      const context = contextLocalStorage.getStore() ?? new Context<R, S>({}, {});
      return context as Context<R, S>;
    },
  };
};

const DefaultContext = createContextFactory();

export default DefaultContext;
