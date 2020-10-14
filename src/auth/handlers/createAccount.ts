import { createLogger } from '@phnq/log';
import { Anomaly } from '@phnq/message';
import bcrypt from 'bcrypt';
import cryptoRandomString from 'crypto-random-string';
import isEmail from 'validator/lib/isEmail';

import AuthApi from '../AuthApi';
import AuthService from '../AuthService';
import Account from '../model/Account';

const log = createLogger('createAccount');

const createAccount: AuthApi['createAccount'] = async ({ email, password }, service?: AuthService) => {
  if (!isEmail(email)) {
    throw new Anomaly('Invalid email address');
  }

  const account = new Account(email);
  account.setAuthCode(cryptoRandomString({ length: 10, type: 'url-safe' }));

  if (password) {
    if (!(await service!.validatePassword(password))) {
      throw new Anomaly('Invalid password');
    }
    account.password = await bcrypt.hash(password, 5);
  }

  try {
    await account.save();

    if (account.authCode) {
      log('Auth code path: /code/%s', account.authCode.code);
      // TODO: Send email with auth link
    }

    return { accountStatus: account.status };
  } catch (err) {
    log.error('Could not create account: ', err);
    throw new Anomaly('Could not create account');
  }
};

export default createAccount;
