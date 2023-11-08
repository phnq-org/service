export default interface AuthApi {
  authenticate(authReq: unknown): Promise<AuthResult>;
}

export interface AuthResult {
  authenticated: boolean;
  identity?: string;
  error?: string;
}
