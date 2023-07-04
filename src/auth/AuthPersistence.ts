import { AccountStatus } from './AuthApi';

export interface Account {
  id: unknown;
  address: string;
  password?: string;
  authCode: { code: string; expiry: Date } | null;
  status: AccountStatus;
}

export interface Session {
  id: unknown;
  accountId: Account['id'];
  token: string;
  expiry: Date;
  active: boolean;
}

export default interface AuthPersistence {
  findAccount(q: { id: unknown } | { address: string } | { code: string }): Promise<Account | undefined>;
  createAccount(account: Omit<Account, 'id'>): Promise<Account>;
  updateAccount(id: unknown, updates: Partial<Omit<Account, 'id'>>): Promise<Account | undefined>;

  findSession(q: { token: string }): Promise<Session | undefined>;
  createSession(session: Omit<Session, 'id'>): Promise<Session>;
  updateSession(id: unknown, updates: Partial<Omit<Session, 'id'>>): Promise<Session | undefined>;
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

  async findAccount(q: { id: unknown } | { address: string } | { code: string }): Promise<Account | undefined> {
    const { id, address, code } = q as Partial<{ id: unknown; address: string; code: string }>;
    if (id) {
      return this.accounts.find(a => a.id === id);
    } else if (address) {
      return this.accounts.find(a => a.address === address);
    } else if (code) {
      return this.accounts.find(a => a.authCode?.code === code);
    }
    return undefined;
  }

  async createAccount(account: Omit<Account, 'id'>): Promise<Account> {
    const newAccount = { ...account, id: idIter.next().value };
    this.accounts.push(newAccount);
    return newAccount;
  }

  async updateAccount(id: unknown, updates: Partial<Omit<Account, 'id'>>): Promise<Account | undefined> {
    const account = this.accounts.find(a => a.id === id);
    if (!account) {
      return undefined;
    }
    const updatedAccount = { ...account, ...updates };
    this.accounts = this.accounts.map(a => (a.id === id ? updatedAccount : a));
    return updatedAccount;
  }

  async findSession({ token }: { token: string }): Promise<Session | undefined> {
    return this.sessions.find(s => s.token === token);
  }

  async createSession(session: Omit<Session, 'id'>): Promise<Session> {
    const newSession = { ...session, id: idIter.next().value };
    this.sessions.push(newSession);
    return newSession;
  }

  async updateSession(id: unknown, updates: Partial<Omit<Session, 'id'>>): Promise<Session | undefined> {
    const session = this.sessions.find(s => s.id === id);
    if (!session) {
      return undefined;
    }
    const updatedSession = { ...session, ...updates };
    this.sessions = this.sessions.map(s => (s.id === id ? updatedSession : s));
    return updatedSession;
  }
}

const idIter = (function* nameGen() {
  let i = 0;
  while (true) {
    i += 1;
    yield i;
  }
})();
