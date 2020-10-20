import { search } from '@phnq/model';

import Context from '../../Context';
import AuthApi from '../AuthApi';
import Session from '../model/Session';

const destroySession: AuthApi['destroySession'] = async ({ token = Context.current.authToken } = {}) => {
  if (token) {
    const session = await search(Session, { token }).first();
    if (session && session.isValid) {
      session.active = false;
      await session.save();
    }
  }
  // Don't care about confirming valid session since we're just blanking out stuff anyway.
  Context.current.authToken = undefined;
  Context.current.identity = undefined;
  return { destroyed: true };
};

export default destroySession;
