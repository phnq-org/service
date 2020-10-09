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
    throw new Error('Context not available.');
  }

  private contextData: ContextData;
  public getClient?: <T = unknown>(domain: string) => T & DefaultClient;

  private constructor(contextData: ContextData) {
    this.contextData = contextData;
  }

  public set(key: string, val: Serializable): void {
    this.contextData = { ...this.contextData, [key]: val };
  }

  public get<T extends Serializable>(key: string): T | undefined {
    return this.contextData[key] as T;
  }

  public get data(): ContextData {
    return this.contextData;
  }
}

export default Context;
