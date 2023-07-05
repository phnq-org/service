import Context from '../../Context';
import AuthApi from '../AuthApi';
import AuthService from '../AuthService';

const destroySession: AuthApi['destroySession'] = async (
  { token = Context.current.authToken } = {},
  service?: AuthService,
) => {
  if (token) {
    const persistence = service!.persistence;
    const session = await persistence.findSession({ token });
    if (session) {
      await persistence.updateSession(session.token, { active: false });
    }
  }
  // Don't care about confirming valid session since we're just blanking out stuff anyway.
  Context.current.authToken = undefined;
  Context.current.identity = undefined;
  return { destroyed: true };
};

export default destroySession;
