import ServiceClient, { StandaloneClient } from '../ServiceClient';
import AuthApi from './AuthApi';
import { AUTH_SERVICE_DOMAIN } from './AuthService';

class AuthClient {
  public static create(): AuthApi & StandaloneClient {
    return ServiceClient.create<AuthApi>(AUTH_SERVICE_DOMAIN);
  }
}

export default AuthClient;
