import { AsyncLocalStorage } from 'async_hooks';

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
  authToken?: string;
  langs?: string[];
}

class Context {
  static apply(data: ContextData, fn: () => void): void {
    contextLocalStorage.run(Context.hasCurrent ? Context.current : new Context(data), fn);
  }

  static get hasCurrent(): boolean {
    return contextLocalStorage.getStore() !== undefined;
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
  public getClient?: <T = unknown>(domain: string) => T & DefaultClient;

  private constructor(contextData: ContextData) {
    this.contextData = contextData;
    this.sharedContextData = {};
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

  public merge(data: ContextData): void {
    this.contextData = { ...this.contextData, ...data };
  }

  public get data(): ContextData {
    return this.contextData;
  }

  public get sharedData(): ContextData {
    return this.sharedContextData;
  }

  public get authToken(): string | undefined {
    return this.contextData.authToken;
  }

  public set authToken(authToken: string | undefined) {
    this.set('authToken', authToken, true);
  }

  public get langs(): string[] | undefined {
    return this.contextData.langs;
  }
}

export default Context;
