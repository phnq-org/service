import { Anomaly } from '@phnq/message';
import { field, Model } from '@phnq/model';

import { AccountStatus } from '../AuthApi';

const AUTH_CODE_EXPIRY = 5 * 60 * 1000; // 5 minutes

class Account extends Model {
  @field public readonly email: string;
  @field public password?: string;
  @field public authCode: { code: string; expiry: Date } | null;
  @field public status: AccountStatus = { state: 'created' };

  public constructor(email: string) {
    super();
    this.email = email;
    this.authCode = null;
  }

  public setAuthCode(code: string): void {
    if (this.status.state === 'inactive') {
      throw new Anomaly('Account is not active');
    }
    this.authCode = { code, expiry: new Date(Date.now() + AUTH_CODE_EXPIRY) };
  }
}

export default Account;
