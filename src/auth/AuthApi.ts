export default interface AuthApi {
  authenticate({ token }: { token?: string }): Promise<{ accountStatus: AccountStatus }>;

  createAccount({ email, password }: { email: string; password?: string }): Promise<{ accountStatus: AccountStatus }>;

  createSession({ email, password, code }: SessionParams): Promise<{ token?: string; accountStatus: AccountStatus }>;

  destroySession({ token }: { token?: string }): Promise<{ destroyed: boolean }>;

  setPassword({ password, token }: { password: string; token?: string }): Promise<{ passwordSet: boolean }>;
}

export interface AccountStatus {
  state: 'created' | 'active' | 'inactive';
}

type SessionParams = SessionWithCredentialsParams | SessionWithCodeParams;

interface SessionWithCredentialsParams {
  email: string;
  password: string;
  code?: undefined;
}

interface SessionWithCodeParams {
  code: string;
  email?: undefined;
  password?: undefined;
}
