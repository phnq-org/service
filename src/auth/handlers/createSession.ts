import { createLogger } from '@phnq/log';
import { Anomaly } from '@phnq/message';
import { search } from '@phnq/model';
import bcrypt from 'bcrypt';
import cryptoRandomString from 'crypto-random-string';

import Context from '../../Context';
import AuthApi from '../AuthApi';
import AuthService from '../AuthService';
import Account from '../model/Account';
import Session from '../model/Session';
import redeemAuthCode from '../queries/redeemAuthCode';

const log = createLogger('createSession');

const createSession: AuthApi['createSession'] = async ({ email, password, code }, service?: AuthService) => {
  if (email) {
    const account = await search(Account, { email }).first();
    if (account) {
      if (password) {
        if (account && account.status.state !== 'active') {
          throw new Anomaly('Account is not active');
        }

        // If email and password are specified, check the password and create a session if ok.
        if (account && account.password && (await bcrypt.compare(password, account.password))) {
          const session = await new Session(account.id).save();
          Context.current.authToken = session.token;
          return { token: session.token, accountStatus: account.status };
        }
      } else {
        // If only an email is specified, send a session link by email.
        account.setAuthCode(cryptoRandomString({ length: 10, type: 'url-safe' }));

        if (account.authCode) {
          log('Auth code path: /code/%s', account.authCode.code);
          // TODO: Send email with auth link
        }

        return { accountStatus: (await account.save()).status };
      }
    }
  } else if (code) {
    // If a code was specified, find the account by the code and create a session if found.
    const account = await redeemAuthCode(code, service!.useEmailAsCode());
    if (account) {
      if (account.status.state === 'created') {
        account.status.state = 'active';
        await account.save();
      }
      const session = await new Session(account.id).save();
      Context.current.authToken = session.token;
      return { token: session.token, accountStatus: account.status };
    }
  }
  throw new Anomaly('Invalid Credentials');
};

export default createSession;
