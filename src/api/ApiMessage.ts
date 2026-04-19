interface ApiMessage {
  payload: unknown;
}

export interface ApiRequestMessage extends ApiMessage {
  domain: string;
  method: string;
}

export interface ApiResponseMessage extends ApiMessage {
  stats: unknown;
}

export interface ApiNotificationMessage extends ApiMessage {
  recipient: { topic: string };
  domain?: string;
}

export interface NotifyApi {
  domain: "_phnq-api";
  handlers: {
    notify: (msg: ApiNotificationMessage) => Promise<void>;
    subscribe: (subscription: {
      connectionId: string;
      topic: string;
      options?: { filter?(payload: unknown): boolean };
    }) => Promise<void>;
    unsubscribe: (subscription: { connectionId: string; topic: string }) => Promise<void>;
    destroyTopic: (info: { topic: string }) => Promise<void>;
  };
}
