import { field, Model } from '@phnq/model';

import { AccountStatus, AuthError, AuthErrorInfo } from '../AuthApi';

const AUTH_CODE_EXPIRY = 5 * 60 * 1000; // 5 minutes

class Account extends Model {
  @field public readonly address: string;
  // @field public twoFactorAddress?: string; // At some point
  @field public password?: string;
  @field public authCode: { code: string; expiry: Date } | null;
  @field public status: AccountStatus = { state: 'created' };

  public constructor(address: string) {
    super();
    this.address = address;
    this.authCode = null;
  }

  public setAuthCode(code: string): void {
    if (this.status.state === 'inactive') {
      throw new AuthError(AuthErrorInfo.InactiveAccount);
    }
    this.authCode = { code, expiry: new Date(Date.now() + AUTH_CODE_EXPIRY) };
  }
}

export default Account;
