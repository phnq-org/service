import Context from '../../Context';
import { ApiPlus } from '../../Service';
import AuthApi from '../AuthApi';
import AuthService from '../AuthService';

type AuthApiPlus = ApiPlus<AuthApi>;

const authenticate: AuthApiPlus['authenticate'] = async (authReq, service) => {
  const authService = service as AuthService;
  if (authService.onAuthenticate) {
    try {
      const { identity } = await authService.onAuthenticate(authReq);
      Context.current.identity = identity;
      return { authenticated: true, identity };
    } catch (err) {
      Context.current.identity = undefined;
      return { authenticated: false, error: (err as Error).message || String(err) };
    }
  }
  throw new Error('No onAuthenticate handler configured.');
};

export default authenticate;
