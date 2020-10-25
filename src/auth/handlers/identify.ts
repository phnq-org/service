import { createLogger } from '@phnq/log';
import { Anomaly } from '@phnq/message';
import { search } from '@phnq/model';
import cryptoRandomString from 'crypto-random-string';
import isEmail from 'validator/lib/isEmail';
import isMobilePhone from 'validator/lib/isMobilePhone';

import Context from '../../Context';
import AuthApi from '../AuthApi';
import AuthService from '../AuthService';
import Account from '../model/Account';
import destroySession from './destroySession';

const log = createLogger('identify');

const identify: AuthApi['identify'] = async ({ address }, service?: AuthService) => {
  if (!(isEmail(address) || isMobilePhone(address, ['en-CA', 'en-US']))) {
    throw new Anomaly('Invalid address');
  }

  if (Context.current.authToken) {
    await destroySession({ token: Context.current.authToken });
  }

  const account = (await search(Account, { address }).first()) || new Account(address);
  account.setAuthCode(cryptoRandomString({ length: 10, type: 'url-safe' }));
  await account.save();
  Context.current.identity = address;

  if (account.authCode?.code) {
    const authCodeUrl = service?.authCodeUrl(account.authCode.code);

    if (isEmail(address)) {
      log(`EMAIL AUTH CODE (${address}):`, authCodeUrl);
    }

    if (isMobilePhone(address)) {
      log(`TEXT AUTH CODE (${address}):`, authCodeUrl);
    }
  }

  return { identified: true };
};

export default identify;
