import { ApiService, AuthApi, AuthService, ServiceClient } from '..';
import { ApiClient } from '../browser';
import { NATS_URI } from './etc/testenv';

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

  test('ping', async () => {
    expect(await authClient.ping()).toBe('pong');
  });

  describe('WebSocket Auth', () => {
    test('Auth success', async () => {
      try {
        const { identity, authenticated, error } = await authWsClient.authenticate('good-token');
        expect(identity).toBe('The User');
        expect(authenticated).toBe(true);
        expect(error).toBeUndefined();
      } catch (err) {
        fail(err);
      }
    });

    test('Auth fail', async () => {
      try {
        const { identity, authenticated, error } = await authWsClient.authenticate('bad-token');
        expect(identity).toBeUndefined();
        expect(authenticated).toBe(false);
        expect(error).toBe('not authenticated');
      } catch (err) {
        fail(err);
      }
    });
  });
});

// ========================== TEST INFRASTRUCTURE ==========================

const authService = new AuthService({
  signSalt: 'abcd1234',
  domain: 'auth',
  nats: { servers: [NATS_URI] },
  onAuthenticate: async (req: string) => {
    if (req === 'good-token') {
      return { identity: 'The User' };
    }
    throw new Error('not authenticated');
  },
});

const authClient = ServiceClient.create<AuthApi>('auth', {
  signSalt: 'abcd1234',
  nats: { servers: [NATS_URI] },
});

const apiService = new ApiService({
  port: 55778,
  signSalt: 'abcd1234',
  nats: { servers: [NATS_URI] },
});

const authWsClient = ApiClient.create<AuthApi>('auth', 'ws://localhost:55778');
