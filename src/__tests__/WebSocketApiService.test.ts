import { Anomaly } from '@phnq/message';

import { Context, Serializable, Service, WebSocketApiService } from '..';
import { WebSocketApiClient } from '../browser';
import { NATS_URI } from './etc/testenv';

describe('WebSocketApiService', () => {
  beforeAll(async () => {
    await fruitService.connect();
    await vegService.connect();
    await apiService.start();
  });

  afterAll(async () => {
    await fruitService.disconnect();
    await vegService.disconnect();
    await apiService.stop();
    await fruitWsClient.disconnect();
  });

  it('throws if client url port is wrong', async () => {
    try {
      await fruitWsClientWrongPort.ping();
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('throws if client url path is wrong', async () => {
    try {
      await fruitWsClientWrongPath.ping();
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('does ping from client', async () => {
    expect(await fruitWsClient.ping()).toBe('pong');
  });

  it('calls service method from another service', async () => {
    expect(await fruitWsClient.getKinds()).toStrictEqual(['apple', 'orange', 'pear']);
  });

  it('calls service iterator method from another service', async () => {
    const responses: string[] = [];
    for await (const response of await fruitWsClient.getKindsIterator()) {
      responses.push(response);
    }
    expect(responses).toStrictEqual(['apple', 'orange', 'pear']);
  });

  it('handles anomalies', async () => {
    try {
      await fruitWsClient.doErrors('anomaly');
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Anomaly);
    }
  });

  it('handles errors', async () => {
    try {
      await fruitWsClient.doErrors('error');
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('uses client from service handler', async () => {
    expect(await fruitWsClient.getVeggies()).toStrictEqual(['carrot', 'celery', 'broccoli']);
  });
});

// ========================== TEST INFRASTRUCTURE ==========================

const apiService = new WebSocketApiService({
  port: 55777,
  signSalt: 'abcd1234',
  nats: { servers: [NATS_URI] },
  authTokenCookie: 't',
});

const fruitWsClient = WebSocketApiClient.create<FruitApi>('fruitWs', 'ws://localhost:55777');
const fruitWsClientWrongPort = WebSocketApiClient.create<FruitApi>('fruitWs', 'ws://localhost:55778');
const fruitWsClientWrongPath = WebSocketApiClient.create<FruitApi>('fruitWs', 'ws://localhost:55777/wrong-path');

interface VegApi {
  getKinds(): Promise<string[]>;
}

const getVegKinds: VegApi['getKinds'] = async () => {
  if (Context.current.get('bubba') !== 'gump') {
    throw new Error('Nope');
  }

  return ['carrot', 'celery', 'broccoli'];
};

const vegService = new Service({
  signSalt: 'abcd1234',
  domain: 'vegWs',
  nats: { servers: [NATS_URI] },
  handlers: { getKinds: getVegKinds },
});

interface FruitApi {
  getKinds(): Promise<string[]>;
  getKindsIterator(): Promise<AsyncIterableIterator<string>>;
  doErrors(type: 'error' | 'anomaly' | 'none'): Promise<void>;
  getFromContext(key: string): Promise<Serializable | undefined>;
  getVeggies(): Promise<string[]>;
}

const getKinds: FruitApi['getKinds'] = async () => ['apple', 'orange', 'pear'];

const getKindsIterator: FruitApi['getKindsIterator'] = async () =>
  (async function* () {
    yield 'apple';
    yield 'orange';
    yield 'pear';
  })();

const doErrors: FruitApi['doErrors'] = async type => {
  switch (type) {
    case 'anomaly':
      throw new Anomaly('the anomaly');

    case 'error':
      throw new Error('the error');
  }
};

const getFromContext: FruitApi['getFromContext'] = async key => {
  Context.current.set('private', 'only4me');

  if (getMyData() !== 'only4me') {
    throw new Error('Did not get private data');
  }

  return Context.current.get(key);
};

const getMyData = (): string | undefined => {
  return Context.current.get<string>('private');
};

const getVeggies: FruitApi['getVeggies'] = async () => {
  if (Context.current.getClient) {
    Context.current.set('bubba', 'gump');
    const vegClient = Context.current.getClient<VegApi>('vegWs');
    return await vegClient.getKinds();
  }
  throw new Error('getClient not defined');
};

const fruitService = new Service({
  signSalt: 'abcd1234',
  domain: 'fruitWs',
  nats: { servers: [NATS_URI] },
  handlers: { getKinds, getKindsIterator, doErrors, getFromContext, getVeggies },
});
