import { AsyncLocalStorage } from 'async_hooks';

import { ApiNotificationMessage, NotifyApi } from './api/ApiMessage';
import { API_SERVICE_DOMAIN } from './domains';
import { DefaultClient } from './ServiceClient';

const contextLocalStorage = new AsyncLocalStorage<Context>();

export type Serializable =
  | string
  | number
  | boolean
  | null
  | undefined
  | Serializable[]
  | { [key: string]: Serializable };

export interface ContextData {
  [key: string]: Serializable;
  connectionId?: string;
  identity?: string;
  langs?: string[];
}

class Context {
  static apply<T>(data: ContextData, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>(resolve => {
      contextLocalStorage.run(Context.current.merge(data), () => resolve(fn()));
    });
  }

  static get current(): Context {
    const context = contextLocalStorage.getStore();
    if (context) {
      return context;
    }
    return new Context({});
  }

  private contextData: ContextData;
  private sharedContextData: ContextData;

  private constructor(contextData: ContextData) {
    this.contextData = contextData;
    this.sharedContextData = {};
  }

  public getClient<T>(domain: string): T & DefaultClient {
    throw new Error(`No client for domain ${domain}`);
  }

  public notify<P extends { type: string }>(
    payload: P,
    recipient?: ApiNotificationMessage['recipient'],
  ): Promise<void> {
    const recip = recipient || (this.connectionId ? { id: this.connectionId } : undefined);
    if (!recip) {
      throw new Error('No recipient set and could not derive one.');
    }
    return this.getClient<NotifyApi>(API_SERVICE_DOMAIN).notify({
      recipient: recip,
      payload,
    });
  }

  public set(key: string, val: Serializable, share = false): void {
    this.contextData = { ...this.contextData, [key]: val };
    if (share) {
      this.sharedContextData = { ...this.sharedContextData, [key]: val };
    }
  }

  public get<T extends Serializable>(key: string): T | undefined {
    return this.contextData[key] as T;
  }

  public merge(data: ContextData): Context {
    this.contextData = { ...this.contextData, ...data };
    return this;
  }

  public get data(): ContextData {
    return this.contextData;
  }

  public get sharedData(): ContextData {
    return this.sharedContextData;
  }

  public get identity(): string | undefined {
    return this.contextData.identity;
  }

  public set identity(identity: string | undefined) {
    this.set('identity', identity, true);
  }

  public get langs(): string[] | undefined {
    return this.contextData.langs;
  }

  public get connectionId(): string | undefined {
    return this.contextData.connectionId;
  }
}

export default Context;
