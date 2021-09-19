import { DataStore, useDataStore } from '@phnq/model';

import Service, { ServiceConfig } from '../Service';
import authenticate from './handlers/authenticate';
import createSession from './handlers/createSession';
import destroySession from './handlers/destroySession';
import identify from './handlers/identify';
import setPassword from './handlers/setPassword';
import Account from './model/Account';
import Session from './model/Session';

interface AuthServiceConfig extends Omit<ServiceConfig, 'handlers'> {
  datastore: DataStore;
  authCodeUrl(code: string): string;
  addressAsCode?: boolean;
  validatePasswordRules?(password: string): Promise<boolean>;
}

class AuthService extends Service {
  private datastore: DataStore;
  private addressAsCode?: boolean;
  public readonly authCodeUrl: (code: string) => string;
  public readonly validatePasswordRules = (password: string): Promise<boolean> => Promise.resolve(password.length >= 6);

  public constructor(config: AuthServiceConfig) {
    super({ ...config, handlers: { identify, createSession, authenticate, destroySession, setPassword } });
    this.datastore = config.datastore;
    this.authCodeUrl = config.authCodeUrl;
    this.addressAsCode = config.addressAsCode;
    if (config.validatePasswordRules) {
      this.validatePasswordRules = config.validatePasswordRules;
    }
  }

  public async connect(): Promise<void> {
    await super.connect();

    await this.datastore.createIndex('Account', { address: 1 }, { unique: true });
    await this.datastore.createIndex('Account', { 'authCode.code': 1 }, {});

    await this.datastore.createIndex('Session', { token: 1 }, {});
    await this.datastore.createIndex('Session', { auxId: 1 }, {});

    useDataStore(this.datastore)(Account);
    useDataStore(this.datastore)(Session);
  }

  public async disconnect(): Promise<void> {
    await super.disconnect();
    await this.datastore.close();
  }

  public useAddressAsCode(): boolean | undefined {
    return this.addressAsCode;
  }
}

export default AuthService;
