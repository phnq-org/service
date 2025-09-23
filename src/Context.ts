import { AsyncLocalStorage } from "node:async_hooks";
import type { ApiNotificationMessage, NotifyApi } from "./api/ApiMessage";
import type { ServiceApi } from "./Service";
import type { DefaultClient } from "./ServiceClient";

// This is typed as `unknown`. Casting is done as needed.
const contextLocalStorage = new AsyncLocalStorage();

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

const initializers = new Set<(context: unknown) => Promise<void>>();

class Context<R extends RequestContext, S extends SessionContext> {
  private _requestContext: Partial<R>;
  private _sessionContext: Partial<S>;
  private extensions = new Set<(context: Context<R, S>) => unknown>();

  public constructor(requestContext: Partial<R>, sessionContext: Partial<S>) {
    this._requestContext = requestContext;
    this._sessionContext = sessionContext;
  }

  public async init() {
    for (const init of initializers) {
      try {
        await init(this);
      } catch (err) {
        console.error("Error during context initialization:", err);
      }
    }
  }

  /**
   * Extend the context. This will be run every time the context is referenced.
   * However, each extension will only be applied once.
   */
  public extend(extFn: (context: Context<R, S>) => unknown) {
    if (this.extensions.has(extFn)) {
      return;
    }

    this.extensions.add(extFn);

    const descriptors = Object.getOwnPropertyDescriptors(extFn(this));
    for (const key in descriptors) {
      if (key !== "init" && descriptors[key]) {
        Object.defineProperty(this, key, descriptors[key]);
      }
    }
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

export interface ContextFactory<X1, R extends RequestContext, S extends SessionContext> {
  enter(r: Partial<R>, s: Partial<S>): Promise<void>;
  exit(): void;
  apply<T>(r: Partial<R>, s: Partial<S>, fn: () => Promise<T>): Promise<T>;
  current: Context<R, S> & X1;
  extend<X2 extends { init?: () => Promise<void> } | object>(
    xFn: (context: Context<R, S>) => X2,
  ): ContextFactory<X1 & X2, R, S>;
  init: (initFn: (context: Context<R, S>) => Promise<void>) => void;
}

export const createContextFactory = <
  RX = object,
  SX = object,
  R extends RequestContext & RX = RequestContext & RX,
  S extends SessionContext & SX = SessionContext & SX,
>(
  extFn: (context: Context<R, S>) => { init?: () => Promise<void> } = () => ({}),
) => {
  const init = extFn(new Context({}, {})).init;
  if (init) {
    initializers.add(init);
  }

  return {
    enter(r, s) {
      const context = new Context(r, s);
      context.extend(extFn);
      contextLocalStorage.enterWith(context);
      return new Promise<void>((resolve, reject) => {
        context
          .init()
          .then(() => resolve())
          .catch((err) => reject(err));
      });
    },
    exit() {
      contextLocalStorage.exit(() => {});
    },
    async apply(r, s, fn) {
      const context = new Context(r, s);
      context.extend(extFn);
      return new Promise((resolve, reject) => {
        contextLocalStorage.run(context, async () => {
          await context.init();
          try {
            const result = await fn();
            resolve(result);
          } catch (err) {
            reject(err);
          }
        });
      });
    },

    get current() {
      const context = (contextLocalStorage.getStore() ?? new Context({}, {})) as Context<R, S>;
      context.extend(extFn);
      return context;
    },

    extend(xFn) {
      return createContextFactory(xFn);
    },

    init(initFn) {
      initializers.add(initFn as (context: unknown) => Promise<void>);
    },
  } as ContextFactory<object, R, S>;
};

const DefaultContext = createContextFactory();

export default DefaultContext;
