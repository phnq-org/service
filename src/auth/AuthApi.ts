export default interface AuthApi {
  domain: "phnq-auth";
  handlers: {
    authenticate(authReq: unknown): Promise<AuthResult>;
    clearIdentity(): Promise<void>;
  };
}

export interface AuthResult {
  authenticated: boolean;
  identity?: string;
  error?: string;
  authResponse?: unknown;
}
