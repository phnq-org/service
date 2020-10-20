/**
 * Authentication
 * --------------
 * There are
 *
 */

export default interface AuthApi {
  identify({ email }: { email: string }): Promise<{ identified: boolean }>;
  createSession(params: CreateSessionParams): Promise<{ accountStatus: AccountStatus; token: string }>;
  authenticate(params?: { token?: string }): Promise<{ accountStatus: AccountStatus }>;
  destroySession(params?: { token?: string }): Promise<{ destroyed: boolean }>;
  setPassword({ password, token }: { password: string; token?: string }): Promise<{ passwordSet: boolean }>;
}

type CreateSessionParams =
  | { code: string; email?: undefined; password?: undefined }
  | { email?: string; password: string; code?: undefined };

export interface AccountStatus {
  state: 'created' | 'active' | 'inactive';
}
