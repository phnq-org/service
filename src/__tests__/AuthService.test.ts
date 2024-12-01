import { ApiService, AuthService } from '..';
import AuthClient from '../auth/AuthClient';
import { ApiClient } from '../browser';

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
      const { identity, authenticated, error, authResponse } = await authWsClient.authenticate('good-token');
      expect(identity).toBe('The User');
      expect(authResponse).toBe('The Response');
      expect(authenticated).toBe(true);
      expect(error).toBeUndefined();
    });

    test('Auth fail', async () => {
      const { identity, authenticated, error } = await authWsClient.authenticate('bad-token');
      expect(identity).toBeUndefined();
      expect(authenticated).toBe(false);
      expect(error).toBe('not authenticated');
    });
  });
});

// ========================== TEST INFRASTRUCTURE ==========================

const authService = new AuthService({
  onAuthenticate: async (req: string) => {
    if (req === 'good-token') {
      return { identity: 'The User', authResponse: 'The Response' };
    }
    throw new Error('not authenticated');
  },
});

const authClient = AuthClient.create();

const apiService = new ApiService({ port: 55778 });

const authWsClient = ApiClient.createAuthClient('ws://localhost:55778');
