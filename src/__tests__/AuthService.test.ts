import { Anomaly } from '@phnq/message';
import { MongoDataStore } from '@phnq/model/datastores/MongoDataStore';

import { AuthApi, AuthService, ServiceClient, WebSocketApiService } from '..';
import { AuthErrorInfo } from '../auth/AuthApi';
import Account from '../auth/model/Account';
import Session from '../auth/model/Session';
import { WebSocketApiClient } from '../browser';

describe('AuthService', () => {
  beforeAll(async () => {
    await authService.connect();
    await authClient.connect();
    await apiService.start();
    await authWsClient.connect();
  });

  afterAll(async () => {
    await authService.disconnect();
    await authClient.disconnect();
    await apiService.stop();
    await authWsClient.disconnect();
  });

  beforeEach(async () => {
    await Account.delete({});
    await Session.delete({});
  });

  test('ping', async () => {
    expect(await authClient.ping()).toBe('pong');
  });

  describe('identification', () => {
    test('identify by email address', async () => {
      const { identified } = await authClient.identify({ address: 'bubba@gump.com' });
      expect(identified).toBe(true);
    });

    test('should reject invalid email address', async () => {
      let allowedInvalidEmail: boolean;
      try {
        await authClient.identify({ address: 'bambam' });
        allowedInvalidEmail = true;
      } catch (err) {
        expect(err).toBeInstanceOf(Anomaly);
        expect(err.info).toBe(AuthErrorInfo.InvalidAddress);
        allowedInvalidEmail = false;
      }
      expect(allowedInvalidEmail).toBe(false);
    });

    test('identify by phone number', async () => {
      await authClient.identify({ address: '4165551234' });
    });
  });

  describe('session creation', () => {
    test('create a session for a no-password account and authenticate it', async () => {
      await authClient.identify({ address: 'bubba@gump.com' });

      const { accountStatus, token } = await authClient.createSession({ code: 'CODE:bubba@gump.com' });
      expect(accountStatus.state).toBe('active');
      expect(token).not.toBeUndefined();

      try {
        await authClient.authenticate({ token });
      } catch (err) {
        fail(err);
      }

      try {
        await authClient.authenticate();
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Anomaly);
        expect(err.info).toBe(AuthErrorInfo.NotAuthenticated);
      }

      await authClient.destroySession({ token });

      const token2 = (await authClient.createSession({ code: 'CODE:bubba@gump.com' })).token;

      let authenticated: boolean;
      try {
        await authClient.authenticate({ token: token2 });
        authenticated = true;
      } catch (err) {
        authenticated = false;
      }
      expect(authenticated).toBe(true);
    });
  });

  describe('session destruction', () => {
    test('destroy session, token should be rejected', async () => {
      await authClient.identify({ address: 'bubba@gump.com' });

      const { token } = await authClient.createSession({ code: 'CODE:bubba@gump.com' });
      await authClient.authenticate({ token });
      await authClient.destroySession({ token });

      let authenticated: boolean;
      try {
        await authClient.authenticate({ token });
        authenticated = true;
      } catch (err) {
        authenticated = false;
      }
      expect(authenticated).toBe(false);
    });
  });

  describe('set password', () => {
    test('set password, create a session with email/password', async () => {
      await authClient.identify({ address: 'bubba@gump.com' });

      const { token } = await authClient.createSession({ code: 'CODE:bubba@gump.com' });
      await authClient.setPassword({ token, password: 'cheese' });
      await authClient.destroySession({ token });

      const { token: token2 } = await authClient.createSession({ address: 'bubba@gump.com', password: 'cheese' });
      expect(token2).not.toBeUndefined();

      let authenticated: boolean;
      try {
        await authClient.authenticate({ token: token2 });
        authenticated = true;
      } catch (err) {
        authenticated = false;
      }
      expect(authenticated).toBe(true);

      await authClient.setPassword({ token, password: 'cheddar' });
      await authClient.destroySession({ token });

      // Old password should no longer work.
      let sessionCreated: boolean;
      try {
        await authClient.createSession({ address: 'bubba@gump.com', password: 'cheese' });
        sessionCreated = true;
      } catch (err) {
        expect(err).toBeInstanceOf(Anomaly);
        expect(err.info).toBe(AuthErrorInfo.NotAuthenticated);
        sessionCreated = false;
      }
      expect(sessionCreated).toBe(false);
    });
  });

  describe('WebSocket Auth', () => {
    test('Identify, create session, authenticate, destroy session', async () => {
      await authWsClient.identify({ address: 'bubba@gump.com' });

      await authWsClient.createSession({ code: 'CODE:bubba@gump.com' });

      try {
        await authWsClient.authenticate();
      } catch (err) {
        fail(err);
      }

      await authWsClient.destroySession();

      try {
        await authWsClient.authenticate();
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Anomaly);
        expect(err.info).toBe(AuthErrorInfo.NotAuthenticated);
      }
    });
  });
});

// ========================== TEST INFRASTRUCTURE ==========================

const authService = new AuthService({
  signSalt: 'abcd1234',
  domain: 'auth',
  nats: { servers: ['nats://localhost:4224'] },
  datastore: new MongoDataStore('mongodb://localhost:27017/authtest'),
  authCodeUrl(code) {
    return `http://test.com/code/${code}`;
  },
  addressAsCode: true,
});

const authClient = ServiceClient.create<AuthApi>('auth', {
  signSalt: 'abcd1234',
  nats: { servers: ['nats://localhost:4224'] },
});

const apiService = new WebSocketApiService({
  port: 55778,
  signSalt: 'abcd1234',
  nats: { servers: ['nats://localhost:4224'] },
  authTokenCookie: 't',
});

const authWsClient = WebSocketApiClient.create<AuthApi>('auth', 'ws://localhost:55778');
