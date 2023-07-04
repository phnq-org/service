import Context from '../../Context';
import AuthApi, { AuthError, AuthErrorInfo } from '../AuthApi';
import { Session } from '../AuthPersistence';
import AuthService from '../AuthService';

const authenticate: AuthApi['authenticate'] = async (
  { token = Context.current.authToken } = {},
  service?: AuthService,
) => {
  if (token) {
    const persistence = service!.persistence;

    const session = await persistence.findSession({ token });
    if (session && isSessionValid(session)) {
      const account = await persistence.findAccount({ id: session.accountId });
      if (account) {
        Context.current.identity = account.address;
        Context.current.authToken = token;
        return { accountStatus: account.status };
      } else {
        throw new AuthError(AuthErrorInfo.NotAuthenticated);
      }
    }
    Context.current.identity = undefined;
    Context.current.authToken = undefined;
  }
  throw new AuthError(AuthErrorInfo.NotAuthenticated);
};

const isSessionValid = (session: Session): boolean => session.active && session.expiry.getTime() > Date.now();

export default authenticate;
