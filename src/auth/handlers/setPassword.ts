import { Anomaly } from '@phnq/message';
import { search } from '@phnq/model';
import bcrypt from 'bcrypt';

import Context from '../../Context';
import AuthApi from '../AuthApi';
import AuthService from '../AuthService';
import Session from '../model/Session';

const setPassword: AuthApi['setPassword'] = async ({ password, token }, service?: AuthService) => {
  if (!(await service!.validatePassword(password))) {
    throw new Anomaly('Invalid password');
  }

  const session = await search(Session, { token: token || Context.current.authToken }).first();
  if (session) {
    const account = await session.account;
    account.password = await bcrypt.hash(password, 5);
    await account.save();
    return { passwordSet: true };
  }
  throw new Anomaly('Not Authenticated');
};

export default setPassword;
