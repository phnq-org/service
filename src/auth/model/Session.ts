import { field, find, Model, ModelId } from '@phnq/model';
import { v4 as uuid } from 'uuid';

import Account from './Account';

export const AUTH_CODE_SESSION_EXPIRY = 10 * 60 * 1000; // 10 minutes
export const CREDENTIALS_SESSION_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days

class Session extends Model {
  @field public readonly accountId: ModelId;
  @field public readonly token = uuid();
  @field public expiry: Date;
  @field public active = true;

  public constructor(accountId: ModelId) {
    super();
    this.accountId = accountId;
    this.expiry = new Date(Date.now() + CREDENTIALS_SESSION_EXPIRY);
  }

  public get isValid(): boolean {
    return this.active && this.expiry.getTime() > Date.now();
  }

  public get account(): Promise<Account> {
    return find(Account, this.accountId) as Promise<Account>;
  }
}

export default Session;
