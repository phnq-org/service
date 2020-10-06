interface ApiMessage {
  payload: unknown;
}

interface ApiRequestMessage extends ApiMessage {
  domain: string;
  type: string;
}

interface ApiResponseMessage extends ApiMessage {
  stats: unknown;
}
