import { Anomaly } from '@phnq/message';
import { search } from '@phnq/model';

import Context from '../../Context';
import AuthApi from '../AuthApi';
import Session from '../model/Session';

const authenticate: AuthApi['authenticate'] = async ({ token }) => {
  const session = await search(Session, { token: token || Context.current.authToken }).first();
  if (session && session.isValid) {
    return { accountStatus: (await session.account).status };
  }
  throw new Anomaly('Not Authenticated');
};

export default authenticate;
