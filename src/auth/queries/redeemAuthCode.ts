import { Anomaly } from '@phnq/message';
import { search } from '@phnq/model';

import Account from '../model/Account';

const redeemAuthCode = async (code: string, addressAsCode = false): Promise<Account> => {
  const query =
    addressAsCode && code.match(/^CODE:/) ? { address: code.substring('CODE:'.length) } : { 'authCode.code': code };

  const account = await search(Account, query).first();
  if (account && account.authCode && account.authCode.expiry.getTime() < Date.now()) {
    account.authCode = null;
    await account.save();
    throw new Anomaly('Invalid code');
  }

  if (account) {
    account.authCode = null;
    return account.save();
  }

  throw new Anomaly('Invalid code');
};

export default redeemAuthCode;
