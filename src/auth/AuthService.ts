import { DataStore, useDataStore } from '@phnq/model';

import Service, { ServiceConfig } from '../Service';
import authenticate from './handlers/authenticate';
import createSession from './handlers/createSession';
import destroySession from './handlers/destroySession';
import identify from './handlers/identify';
import setPassword from './handlers/setPassword';
import Account from './model/Account';
import Session from './model/Session';

interface AuthServiceConfig extends ServiceConfig {
  datastore: DataStore;
  authCodeUrl(code: string): string;
  addressAsCode?: boolean;
  validatePassword?(password: string): Promise<boolean>;
}

class AuthService extends Service {
  private datastore: DataStore;
  private addressAsCode?: boolean;
  public readonly authCodeUrl: (code: string) => string;
  public readonly validatePassword = (password: string): Promise<boolean> => Promise.resolve(password.length >= 6);

  public constructor(config: AuthServiceConfig) {
    super(config);
    this.datastore = config.datastore;
    this.authCodeUrl = config.authCodeUrl;
    this.addressAsCode = config.addressAsCode;
    if (config.validatePassword) {
      this.validatePassword = config.validatePassword;
    }
    this.addHandler('identify', identify);
    this.addHandler('createSession', createSession);
    this.addHandler('authenticate', authenticate);
    this.addHandler('destroySession', destroySession);
    this.addHandler('setPassword', setPassword);
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
