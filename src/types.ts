import { ContextData } from './Context';

interface ServiceMessageBase {
  origin: string; // service that initiated the conversation (req/res chain)
  payload: unknown; // opaque data attached to message
}

export interface RequestMessage extends ServiceMessageBase {
  domain: string; // intended recipient service
  method: string; // target message handler on the recipient service
  contextData: ContextData;
}

export interface ResponseMessage extends ServiceMessageBase {
  stats: {
    time: number; // milliseconds from when request was received to when response is sent (i.e handler time)
  };
}

export type ServiceMessage = RequestMessage | ResponseMessage;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ServiceHandler = (requestPayload: any) => Promise<unknown | AsyncIterableIterator<unknown>>;

export interface DefaultClient {
  ping(): Promise<string>;
  isConnected: boolean;
}
