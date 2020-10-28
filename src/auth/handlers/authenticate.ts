import { search } from '@phnq/model';

import Context from '../../Context';
import AuthApi, { AuthError, AuthErrorInfo } from '../AuthApi';
import Session from '../model/Session';

const authenticate: AuthApi['authenticate'] = async ({ token = Context.current.authToken } = {}) => {
  if (token) {
    const session = await search(Session, { token }).first();
    if (session && session.isValid) {
      const account = await session.account;
      Context.current.identity = account.address;
      Context.current.authToken = token;
      return { accountStatus: account.status };
    }
    Context.current.identity = undefined;
    Context.current.authToken = undefined;
  }
  throw new AuthError(AuthErrorInfo.NotAuthenticated);
};

export default authenticate;
