import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import { v4 as uuid } from "uuid";
import type { ApiNotificationMessage, NotifyApi } from "./api/ApiMessage";
import ServiceClient from "./ServiceClient";

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
  originDomain?: string;
}

export interface SessionContext {
  connectionId?: string;
  connectionPath?: string;
  langs?: string[];
  identity?: string;
}

interface ContextEvents<R extends RequestContext, S extends SessionContext> {
  enter: { context: Context<R, S> };
  exit: { context: Context<R, S>; exitedContext: Context<R, S> };
  "api:request": { domain: string; method: string; payload: unknown; context: Context<R, S> };
  "service:request": { domain: string; method: string; payload: unknown; context: Context<R, S> };
  "api:error": {
    error: unknown;
    domain: string;
    method: string;
    payload: unknown;
    context: Context<R, S>;
  };
  "service:error": {
    error: unknown;
    domain: string;
    method: string;
    payload: unknown;
    context: Context<R, S>;
  };
}

const eventListeners = new Map<
  keyof ContextEvents<RequestContext, SessionContext>,
  Set<(payload: unknown) => Promise<void>>
>();

export const dispatchContextEvent = async <
  K extends keyof ContextEvents<R, S>,
  R extends RequestContext,
  S extends SessionContext,
>(
  event: K,
  payload: Omit<ContextEvents<R, S>[K], "context">,
): Promise<void> => {
  const listeners = eventListeners.get(event);
  if (listeners) {
    await Promise.all(
      Array.from(listeners).map((listener) =>
        listener({
          ...payload,
          context: "exitedContext" in payload ? payload.exitedContext : DefaultContext.current,
        }),
      ),
    );
  }
};

class Context<R extends RequestContext, S extends SessionContext> {
  public readonly id = uuid().replace(/[^\w]/g, "");
  public state: "current" | "exited" | "detached" = "current";
  private _requestContext: R;
  private _sessionContext: S;
  public readonly parentContext: Context<RequestContext, SessionContext> | undefined;
  private extensions = new Set<(context: Context<R, S>) => unknown>();

  public constructor(
    requestContext: R,
    sessionContext: S,
    options?: { parentContext?: Context<RequestContext, SessionContext>; isDetached?: boolean },
  ) {
    this._requestContext = requestContext;
    this._sessionContext = sessionContext;
    this.parentContext = options?.parentContext;

    if (options?.isDetached) {
      this.state = "detached";
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
      if (descriptors[key]) {
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

  public async subscribe(topic: string) {
    const apiClient = ServiceClient.create<NotifyApi>("_phnq-api");
    assert(this.connectionId, "No connection id");
    await apiClient.subscribe({ connectionId: this.connectionId, topic });
  }

  public async unsubscribe(topic: string) {
    const apiClient = ServiceClient.create<NotifyApi>("_phnq-api");
    assert(this.connectionId, "No connection id");
    await apiClient.unsubscribe({ connectionId: this.connectionId, topic });
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
    const recip = recipient ?? (this.connectionId ? { topic: this.connectionId } : undefined);
    if (!recip) {
      throw new Error("No recipient set and could not derive one.");
    }
    const apiClient = ServiceClient.create<NotifyApi>("_phnq-api");
    return apiClient.notify({
      recipient: recip,
      payload,
      domain: this.domain,
    });
  }

  public get<K extends keyof R>(key: K): R[K];
  public get<K extends keyof S>(key: K): S[K];
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
    this._sessionContext = { ...(this._sessionContext ?? {}), [key]: val };
  }

  public merge(sessionContext: SessionContext) {
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
  enter(r: R, s: S): Promise<void>;
  exit(): void;
  apply<T>(r: R, s: S, fn: () => Promise<T>): Promise<T>;
  current: Context<R, S> & X1;
  extend<X2>(xFn: (context: Context<R, S>) => X2): ContextFactory<X1 & X2, R, S>;
  on: <K extends keyof ContextEvents<R, S>>(
    event: K,
    listener: (payload: ContextEvents<R, S>[K]) => Promise<void>,
  ) => void;
}

export const createContextFactory = <
  RX = object,
  SX = object,
  R extends RequestContext & RX = RequestContext & RX,
  S extends SessionContext & SX = SessionContext & SX,
>(
  extFn: (context: Context<R, S>) => unknown = () => ({}),
) => {
  return {
    enter(r, s) {
      const parentContext = contextLocalStorage.getStore() as
        | Context<RequestContext, SessionContext>
        | undefined;
      const context = new Context(r, s, { parentContext });
      context.extend(extFn);
      contextLocalStorage.enterWith(context);
      return new Promise<void>((resolve, reject) => {
        dispatchContextEvent("enter", {})
          .then(() => resolve())
          .catch((err) => reject(err));
      });
    },
    exit() {
      const context = contextLocalStorage.getStore() as
        | Context<RequestContext, SessionContext>
        | undefined;
      contextLocalStorage.exit(async () => {
        if (context) {
          context.state = "exited";
          await dispatchContextEvent("exit", { exitedContext: context });
        }
      });
    },
    async apply(r, s, fn) {
      const parentContext = contextLocalStorage.getStore() as Context<
        RequestContext,
        SessionContext
      >;

      const context = new Context(r, s, { parentContext });
      context.extend(extFn);
      return new Promise((resolve, reject) => {
        contextLocalStorage
          .run(context, async () => {
            await dispatchContextEvent("enter", {});
            try {
              const result = await fn();
              resolve(result);
            } catch (err) {
              reject(err);
            }
          })
          .then(async () => {
            context.state = "exited";
            await dispatchContextEvent<"exit", R, S>("exit", { exitedContext: context });
          });
      });
    },

    get current() {
      const context = (contextLocalStorage.getStore() ??
        new Context({}, {}, { isDetached: true })) as Context<R, S>;
      context.extend(extFn);
      return context;
    },

    extend(xFn) {
      return createContextFactory(xFn);
    },

    on: (event, listener) => {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, new Set());
      }
      const listeners = eventListeners.get(event);
      assert(listeners, "Event listeners should be defined");
      listeners.add(listener as (payload: unknown) => Promise<void>);
    },
  } as ContextFactory<object, R, S>;
};

const DefaultContext = createContextFactory();

export default DefaultContext;
