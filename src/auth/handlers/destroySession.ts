import { search } from '@phnq/model';

import Context from '../../Context';
import AuthApi from '../AuthApi';
import Session from '../model/Session';

const destroySession: AuthApi['destroySession'] = async ({ token }) => {
  const session = await search(Session, { token: token || Context.current.authToken }).first();
  if (session && session.isValid) {
    session.active = false;
    await session.save();
  }
  return { destroyed: true };
};

export default destroySession;
