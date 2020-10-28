import { search } from '@phnq/model';
import bcrypt from 'bcrypt';

import Context from '../../Context';
import AuthApi, { AuthError, AuthErrorInfo } from '../AuthApi';
import AuthService from '../AuthService';
import Session from '../model/Session';

const setPassword: AuthApi['setPassword'] = async (
  { password, token = Context.current.authToken },
  service?: AuthService,
) => {
  if (!(await service!.validatePasswordRules(password))) {
    throw new AuthError(AuthErrorInfo.PasswordRulesViolation);
  }

  const session = await search(Session, { token }).first();
  if (session) {
    const account = await session.account;
    account.password = await bcrypt.hash(password, 5);
    await account.save();
    return { passwordSet: true };
  }
  throw new AuthError(AuthErrorInfo.NotAuthenticated);
};

export default setPassword;
