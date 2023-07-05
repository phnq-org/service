import cryptoRandomString from 'crypto-random-string';

import Context from '../../Context';
import AuthApi, { AuthError, AuthErrorInfo } from '../AuthApi';
import { Account, Session } from '../AuthPersistence';
import AuthService from '../AuthService';
import destroySession from './destroySession';

const CREDENTIALS_SESSION_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days

const createSession: AuthApi['createSession'] = async (
  { code, address = Context.current.identity, password },
  service?: AuthService,
) => {
  const persistence = service!.persistence;

  if (Context.current.authToken) {
    await destroySession({ token: Context.current.authToken });
  }

  const useAddressAsCode = service!.useAddressAsCode() || false;
  let session: Session | undefined;
  if (code) {
    session = await createSessionWithCode(code, useAddressAsCode, service!);
  } else if (address && password) {
    session = await createSessionWithCredentials(address, password, service!);
  }

  if (session) {
    const account = await persistence.findAccount({ address: session.accountAddress });
    if (!account) {
      throw new AuthError(AuthErrorInfo.NotAuthenticated);
    }
    Context.current.identity = account.address;
    Context.current.authToken = session.token;
    return { token: session.token, accountStatus: account.status };
  }

  throw new AuthError(AuthErrorInfo.NotAuthenticated);
};

const createSessionWithCode = async (
  code: string,
  useAddressAsCode: boolean,
  service: AuthService,
): Promise<Session | undefined> => {
  let account: Account | undefined = await redeemAuthCode(code, useAddressAsCode, service);
  if (account) {
    if (account.status.state === 'created') {
      account = await service.persistence.updateAccount(account.address, { status: { state: 'active' } });
    }
    if (account?.status.state === 'active') {
      return await service.persistence.createSession({
        token: cryptoRandomString({ length: 20, type: 'url-safe' }),
        accountAddress: account.address,
        expiry: new Date(Date.now() + CREDENTIALS_SESSION_EXPIRY),
        active: true,
      });
    }
  }
  return undefined;
};

const createSessionWithCredentials = async (
  address: string,
  password: string,
  service: AuthService,
): Promise<Session | undefined> => {
  const account = await service.persistence.findAccount({ address });

  if (
    account &&
    account.password &&
    (await service.hashPassword(password)) === account.password &&
    account.status.state === 'active'
  ) {
    return await service.persistence.createSession({
      token: cryptoRandomString({ length: 20, type: 'url-safe' }),
      accountAddress: account.address,
      expiry: new Date(Date.now() + CREDENTIALS_SESSION_EXPIRY),
      active: true,
    });
  }
  return undefined;
};

const redeemAuthCode = async (
  code: string,
  addressAsCode = false,
  service: AuthService,
): Promise<Account | undefined> => {
  const account =
    addressAsCode && code.match(/^CODE:/)
      ? await service.persistence.findAccount({ address: code.substring('CODE:'.length) })
      : await service.persistence.findAccount({ code });

  if (account && account.authCode && account.authCode.expiry.getTime() < Date.now()) {
    await service.persistence.updateAccount(account.address, { authCode: null });
    throw new AuthError(AuthErrorInfo.InvalidCode);
  }

  if (account) {
    return await service.persistence.updateAccount(account.address, { authCode: null });
  }

  throw new AuthError(AuthErrorInfo.InvalidCode);
};

export default createSession;
