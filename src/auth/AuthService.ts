import md5 from 'md5';

import Service, { ServiceConfig } from '../Service';
import AuthPersistence from './AuthPersistence';
import authenticate from './handlers/authenticate';
import createSession from './handlers/createSession';
import destroySession from './handlers/destroySession';
import identify from './handlers/identify';
import setPassword from './handlers/setPassword';

interface AuthServiceConfig extends Omit<ServiceConfig, 'handlers'> {
  persistence: AuthPersistence;
  authCodeUrl(code: string): string;
  addressAsCode?: boolean;
  validatePasswordRules?(password: string): Promise<boolean>;
  hashPassword?(password: string): Promise<string>;
}

class AuthService extends Service {
  public readonly persistence: AuthPersistence;
  private addressAsCode?: boolean;
  public readonly authCodeUrl: (code: string) => string;
  public readonly validatePasswordRules = (password: string): Promise<boolean> => Promise.resolve(password.length >= 6);
  public readonly hashPassword = (password: string): Promise<string> => Promise.resolve(md5(password));

  public constructor(config: AuthServiceConfig) {
    super({ ...config, handlers: { identify, createSession, authenticate, destroySession, setPassword } });
    this.persistence = config.persistence;
    this.authCodeUrl = config.authCodeUrl;
    this.addressAsCode = config.addressAsCode;
    if (config.validatePasswordRules) {
      this.validatePasswordRules = config.validatePasswordRules;
    }
    if (config.hashPassword) {
      this.hashPassword = config.hashPassword;
    }
  }

  public useAddressAsCode(): boolean | undefined {
    return this.addressAsCode;
  }
}

export default AuthService;
