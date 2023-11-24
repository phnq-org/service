import Service, { ServiceConfig } from '../Service';
import AuthApi from './AuthApi';
import authenticate from './handlers/authenticate';

export const AUTH_SERVICE_DOMAIN = '___auth___';

interface AuthServiceConfig extends Omit<ServiceConfig<AuthApi>, 'handlers'> {
  /**
   * Setting this callback will enable authentication by delegating responsibility
   * to the application. The `authReq` argument is the payload of the `authenticate`
   * handler request.
   *
   * If the application is able to successfully authenticate a user from the `authReq`
   * argument, then this callback should return an object with an `identity` property.
   * The `identity` property should be a string that uniquely and consistently identifies
   * the user -- i.e. a user ID or email address.
   *
   * If authentication fails, then this callback should throw an error.
   *
   * @param authReq The payload of the `authenticate` handler request.
   * @returns An object with an `identity` property if authentication is successful.
   * @throws An error if authentication fails.
   */
  onAuthenticate?(authReq: unknown): Promise<{ identity: string }>;
}

class AuthService extends Service<AuthApi> {
  public readonly onAuthenticate: AuthServiceConfig['onAuthenticate'];

  public constructor(config: AuthServiceConfig) {
    super(AUTH_SERVICE_DOMAIN, { ...config, handlers: { authenticate } });
    this.onAuthenticate = config.onAuthenticate;
  }
}

export default AuthService;
