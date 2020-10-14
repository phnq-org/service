import { Anomaly } from '@phnq/message';
import { MongoDataStore } from '@phnq/model/datastores/MongoDataStore';

import AuthApi from '../auth/AuthApi';
import AuthService from '../auth/AuthService';
import Account from '../auth/model/Account';
import Session from '../auth/model/Session';
import ServiceClient from '../ServiceClient';

describe('AuthService', () => {
  beforeAll(async () => {
    await authService.connect();
    await authClient.connect();
  });

  afterAll(async () => {
    await authService.disconnect();
    await authClient.disconnect();
  });

  beforeEach(async () => {
    await Account.delete({});
    await Session.delete({});
  });

  test('ping', async () => {
    expect(await authClient.ping()).toBe('pong');
  });

  describe('account creation', () => {
    test('create an account with an email address, prevent duplicate email', async () => {
      const { accountStatus } = await authClient.createAccount({ email: 'bubba@gump.com' });
      expect(accountStatus.state).toBe('created');

      let createdAccountWithSameEmail = false;
      try {
        await authClient.createAccount({ email: 'bubba@gump.com' });
        createdAccountWithSameEmail = true;
      } catch (err) {
        expect(err).toBeInstanceOf(Anomaly);
        createdAccountWithSameEmail = false;
      }
      expect(createdAccountWithSameEmail).toBe(false);
    });

    test('should reject invalid email address', async () => {
      let allowedInvalidEmail: boolean;
      try {
        await authClient.createAccount({ email: 'bambam' });
        allowedInvalidEmail = true;
      } catch (err) {
        expect(err).toBeInstanceOf(Anomaly);
        allowedInvalidEmail = false;
      }
      expect(allowedInvalidEmail).toBe(false);
    });

    test('create an account with an email address and password', async () => {
      const { accountStatus } = await authClient.createAccount({ email: 'bubba@gump.com', password: 'abcd1234' });
      expect(accountStatus.state).toBe('created');
    });
  });

  describe('session creation', () => {
    test('create a session for a no-password account and authenticate it', async () => {
      expect((await authClient.createAccount({ email: 'bubba@gump.com' })).accountStatus.state).toBe('created');

      const { accountStatus, token } = await authClient.createSession({ code: 'bubba@gump.com' });
      expect(accountStatus.state).toBe('active');
      expect(token).not.toBeUndefined();

      let authenticated: boolean;
      try {
        await authClient.authenticate({ token });
        authenticated = true;
      } catch (err) {
        authenticated = false;
      }
      expect(authenticated).toBe(true);
    });

    test("should not allow session to be created with email/password for an account in 'created' state.", async () => {
      expect(
        (await authClient.createAccount({ email: 'bubba@gump.com', password: 'abcd1234' })).accountStatus.state,
      ).toBe('created');

      let sessionCreated: boolean;
      try {
        await authClient.createSession({ email: 'bubba@gump.com', password: 'abcd1234' });
        sessionCreated = true;
      } catch (err) {
        expect(err).toBeInstanceOf(Anomaly);
        sessionCreated = false;
      }
      expect(sessionCreated).toBe(false);
    });

    test('create a session with email/password and authenticate it', async () => {
      expect(
        (await authClient.createAccount({ email: 'bubba@gump.com', password: 'abcd1234' })).accountStatus.state,
      ).toBe('created');

      const { accountStatus } = await authClient.createSession({ code: 'bubba@gump.com' });
      expect(accountStatus.state).toBe('active');

      const { token } = await authClient.createSession({
        email: 'bubba@gump.com',
        password: 'abcd1234',
      });
      expect(token).not.toBeUndefined();

      let authenticated: boolean;
      try {
        await authClient.authenticate({ token });
        authenticated = true;
      } catch (err) {
        authenticated = false;
      }
      expect(authenticated).toBe(true);
    });
  });

  describe('session destruction', () => {
    test('destroy session, token should be rejected', async () => {
      expect((await authClient.createAccount({ email: 'bubba@gump.com' })).accountStatus.state).toBe('created');

      const { token } = await authClient.createSession({ code: 'bubba@gump.com' });
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
      expect((await authClient.createAccount({ email: 'bubba@gump.com' })).accountStatus.state).toBe('created');

      const { token } = await authClient.createSession({ code: 'bubba@gump.com' });
      await authClient.setPassword({ token, password: 'cheese' });
      await authClient.destroySession({ token });

      const { token: token2 } = await authClient.createSession({ email: 'bubba@gump.com', password: 'cheese' });
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
        await authClient.createSession({ email: 'bubba@gump.com', password: 'cheese' });
        sessionCreated = true;
      } catch (err) {
        expect(err).toBeInstanceOf(Anomaly);
        sessionCreated = false;
      }
      expect(sessionCreated).toBe(false);
    });
  });
});

// ========================== TEST INFRASTRUCTURE ==========================

const authService = new AuthService({
  signSalt: 'abcd1234',
  domain: 'auth',
  nats: { servers: ['nats://localhost:4224'] },
  datastore: new MongoDataStore('mongodb://localhost:27017/authtest'),
  emailAsCode: true,
});

const authClient = ServiceClient.create<AuthApi>('auth', {
  signSalt: 'abcd1234',
  nats: { servers: ['nats://localhost:4224'] },
});
