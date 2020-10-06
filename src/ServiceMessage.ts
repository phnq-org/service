import { ContextData } from './Context';

interface ServiceMessageBase {
  origin: string; // service that initiated the conversation (req/res chain)
  payload: unknown; // opaque data attached to message
}

export interface ServiceRequestMessage extends ServiceMessageBase {
  domain: string; // intended recipient service
  method: string; // target message handler on the recipient service
  contextData: ContextData;
}

export interface ServiceResponseMessage extends ServiceMessageBase {
  stats: {
    time: number; // milliseconds from when request was received to when response is sent (i.e handler time)
  };
}

export type ServiceMessage = ServiceRequestMessage | ServiceResponseMessage;
