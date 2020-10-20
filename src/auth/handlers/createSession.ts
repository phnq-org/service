import { Anomaly } from '@phnq/message';
import { search } from '@phnq/model';
import bcrypt from 'bcrypt';

import Context from '../../Context';
import AuthApi from '../AuthApi';
import AuthService from '../AuthService';
import Account from '../model/Account';
import Session from '../model/Session';
import redeemAuthCode from '../queries/redeemAuthCode';
import destroySession from './destroySession';

const createSession: AuthApi['createSession'] = async (
  { code, email = Context.current.identity, password },
  service?: AuthService,
) => {
  if (Context.current.authToken) {
    await destroySession({ token: Context.current.authToken });
  }

  const useEmailAsCode = service!.useEmailAsCode() || false;
  let session: Session | undefined;
  if (code) {
    session = await createSessionWithCode(code, useEmailAsCode!);
  } else if (email && password) {
    session = await createSessionWithCredentials(email, password);
  }

  if (session) {
    const account = await session.account;
    Context.current.identity = account.email;
    Context.current.authToken = session.token;
    return { token: session.token, accountStatus: account.status };
  }

  throw new Anomaly('Not Authenticated');
};

const createSessionWithCode = async (code: string, useEmailAsCode: boolean): Promise<Session | undefined> => {
  let account = await redeemAuthCode(code, useEmailAsCode);
  if (account) {
    if (account.status.state === 'created') {
      account.status.state = 'active';
      account = await account.save();
    }
    if (account.status.state === 'active') {
      const session = new Session(account);
      await session.save();
      return session;
    }
  }
  return undefined;
};

const createSessionWithCredentials = async (email: string, password: string): Promise<Session | undefined> => {
  const account = await search(Account, { email }).first();
  if (
    account &&
    account.password &&
    (await bcrypt.compare(password, account.password)) &&
    account.status.state === 'active'
  ) {
    const session = new Session(account);
    await session.save();
    return session;
  }
  return undefined;
};

export default createSession;
