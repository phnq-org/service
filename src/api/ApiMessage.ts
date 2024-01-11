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
  recipient: { id: string };
}

export interface NotifyApi {
  notify: (msg: ApiNotificationMessage) => Promise<void>;
}
