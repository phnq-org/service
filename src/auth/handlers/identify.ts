import { createLogger } from '@phnq/log';
import { Anomaly } from '@phnq/message';
import { search } from '@phnq/model';
import cryptoRandomString from 'crypto-random-string';
import isEmail from 'validator/lib/isEmail';

import Context from '../../Context';
import AuthApi from '../AuthApi';
import Account from '../model/Account';

const log = createLogger('identify');

const identify: AuthApi['identify'] = async ({ email }) => {
  if (!isEmail(email)) {
    throw new Anomaly('Invalid email address');
  }

  if (Context.current.identity && Context.current.identity !== email) {
    throw new Anomaly('Already identified.');
  }

  const account = (await search(Account, { email }).first()) || new Account(email);
  account.setAuthCode(cryptoRandomString({ length: 10, type: 'url-safe' }));
  await account.save();
  Context.current.identity = email;

  log(`AUTH CODE (${email}): ${account.authCode}`);

  return { identified: true };
};

export default identify;
