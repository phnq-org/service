import Context from '../../Context';
import AuthApi from '../AuthApi';
import AuthService from '../AuthService';

const authenticate: AuthApi['authenticate'] = async (authReq, service?: AuthService) => {
  if (service?.onAuthenticate) {
    try {
      const { identity } = await service.onAuthenticate(authReq);
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
