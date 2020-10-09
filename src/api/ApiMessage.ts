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
