/**
 * Authentication Semantics
 * ------------------------
 * In order to obtain a valid session, a user can either:
 * 1. Call `createSession` with valid credentials, or
 * 2. Call `createSession` with a temporary code.
 *    - A temporary code is sent to the user when they call `identify` with a valid address (email or phone).
 *    - The temporary code is valid for 5 minutes.
 *
 * Calling `identify` will create an account for the supplied address if one does not exist.
 *
 * To be able to use credentials, the user must set a password by calling `setPassword`. The user does not
 * ever need to set a password. Without a password set, creating a session is a two step process: identify,
 * createSession.
 *
 * Note: when using WebSockets, the `token` is not required for `authenticate`, `setPassword`
 * and `destroySession`; the token is cached on the WebSocket's state.
 */

import { Anomaly } from '@phnq/message';

export default interface AuthApi {
  identify({ address }: { address: string }): Promise<{ identified: boolean }>;
  createSession(params: CreateSessionParams): Promise<{ accountStatus: AccountStatus; token: string }>;
  authenticate(params?: { token?: string }): Promise<{ accountStatus: AccountStatus }>;
  destroySession(params?: { token?: string }): Promise<{ destroyed: boolean }>;
  setPassword({ password, token }: { password: string; token?: string }): Promise<{ passwordSet: boolean }>;
}

type CreateSessionParams =
  | { code: string; address?: undefined; password?: undefined } // with temporary code
  | { address?: string; password: string; code?: undefined }; // with credentials

export interface AccountStatus {
  state: 'created' | 'active' | 'inactive';
}

export const enum AuthErrorInfo {
  NotAuthenticated,
  InvalidAddress,
  PasswordRulesViolation,
  InactiveAccount,
  InvalidCode,
}

export class AuthError extends Anomaly {
  constructor(info: AuthErrorInfo) {
    super('AuthError', info);
  }
}
