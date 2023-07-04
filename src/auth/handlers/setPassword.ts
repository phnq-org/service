import bcrypt from 'bcrypt';

import Context from '../../Context';
import AuthApi, { AuthError, AuthErrorInfo } from '../AuthApi';
import AuthService from '../AuthService';

const setPassword: AuthApi['setPassword'] = async (
  { password, token = Context.current.authToken },
  service?: AuthService,
) => {
  if (!(await service!.validatePasswordRules(password))) {
    throw new AuthError(AuthErrorInfo.PasswordRulesViolation);
  }

  const persistence = service!.persistence;

  if (token) {
    const session = await persistence.findSession({ token });

    if (session) {
      const account = await persistence.findAccount({ id: session.accountId });
      if (account) {
        await persistence.updateAccount(account.id, { password: await bcrypt.hash(password, 5) });
      }
      return { passwordSet: true };
    }
  }
  throw new AuthError(AuthErrorInfo.NotAuthenticated);
};

export default setPassword;
