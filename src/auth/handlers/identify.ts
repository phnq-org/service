import { createLogger } from '@phnq/log';
import cryptoRandomString from 'crypto-random-string';
import isEmail from 'validator/lib/isEmail';
import isMobilePhone from 'validator/lib/isMobilePhone';

import Context from '../../Context';
import AuthApi, { AuthError, AuthErrorInfo } from '../AuthApi';
import AuthService from '../AuthService';
import destroySession from './destroySession';

const log = createLogger('identify');

const AUTH_CODE_EXPIRY = 5 * 60 * 1000; // 5 minutes

const identify: AuthApi['identify'] = async ({ address }, service?: AuthService) => {
  if (!(isEmail(address) || isMobilePhone(address, ['en-CA', 'en-US']))) {
    throw new AuthError(AuthErrorInfo.InvalidAddress);
  }

  if (Context.current.authToken) {
    await destroySession({ token: Context.current.authToken });
  }

  const persistence = service!.persistence;

  const { id } =
    (await persistence.findAccount({ address })) ||
    (await persistence.createAccount({ address, status: { state: 'created' }, authCode: null }));

  const code = cryptoRandomString({ length: 10, type: 'url-safe' });
  const expiry = new Date(Date.now() + AUTH_CODE_EXPIRY);
  const account = await persistence.updateAccount(id, { authCode: { code, expiry } });

  Context.current.identity = address;

  if (account?.authCode?.code) {
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
