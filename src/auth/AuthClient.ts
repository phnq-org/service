import ServiceClient, { StandaloneClient } from '../ServiceClient';
import AuthApi from './AuthApi';

class AuthClient {
  public static create(): AuthApi['handlers'] & StandaloneClient {
    return ServiceClient.create<AuthApi>('phnq-auth');
  }
}

export default AuthClient;
