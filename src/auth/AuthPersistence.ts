import { AccountStatus } from './AuthApi';

export interface Account {
  address: string;
  password?: string;
  authCode: { code: string; expiry: Date } | null;
  status: AccountStatus;
}

export interface Session {
  token: string;
  accountAddress: Account['address'];
  expiry: Date;
  active: boolean;
}

export default interface AuthPersistence {
  findAccount(q: { address: string; code?: never } | { code: string; address?: never }): Promise<Account | undefined>;
  createAccount(account: Account): Promise<Account>;
  updateAccount(address: string, updates: Partial<Omit<Account, 'address'>>): Promise<Account | undefined>;

  findSession(q: { token: string }): Promise<Session | undefined>;
  createSession(session: Session): Promise<Session>;
  updateSession(token: string, updates: Partial<Omit<Session, 'token'>>): Promise<Session | undefined>;
}

/**
 * This is only for testing purposes.
 */
export class InMemoryAuthPersistence implements AuthPersistence {
  private accounts: Account[] = [];
  private sessions: Session[] = [];

  reset(): void {
    this.accounts = [];
    this.sessions = [];
  }

  async findAccount(
    q: { address: string; code?: never } | { code: string; address?: never },
  ): Promise<Account | undefined> {
    const { address, code } = q;
    if (address) {
      return this.accounts.find(a => a.address === address);
    } else if (code) {
      return this.accounts.find(a => a.authCode?.code === code);
    }
    return undefined;
  }

  async createAccount(account: Account): Promise<Account> {
    const newAccount = { ...account };
    this.accounts.push(newAccount);
    return newAccount;
  }

  async updateAccount(address: string, updates: Partial<Omit<Account, 'address'>>): Promise<Account | undefined> {
    const account = this.accounts.find(a => a.address === address);
    if (!account) {
      return undefined;
    }
    const updatedAccount = { ...account, ...updates };
    this.accounts = this.accounts.map(a => (a.address === address ? updatedAccount : a));
    return updatedAccount;
  }

  async findSession({ token }: { token: string }): Promise<Session | undefined> {
    return this.sessions.find(s => s.token === token);
  }

  async createSession(session: Session): Promise<Session> {
    const newSession = { ...session };
    this.sessions.push(newSession);
    return newSession;
  }

  async updateSession(token: string, updates: Partial<Omit<Session, 'id'>>): Promise<Session | undefined> {
    const session = this.sessions.find(s => s.token === token);
    if (!session) {
      return undefined;
    }
    const updatedSession = { ...session, ...updates };
    this.sessions = this.sessions.map(s => (s.token === token ? updatedSession : s));
    return updatedSession;
  }
}
