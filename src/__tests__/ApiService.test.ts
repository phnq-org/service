import { Anomaly } from '@phnq/message';
import { get } from 'http';

import { ApiService, Context, Serializable, Service } from '..';
import { ApiClient } from '../browser';

const notifications: FruitNotification[] = [];

describe('ApiService', () => {
  beforeAll(async () => {
    await fruitService.connect();
    await vegService.connect();
    await apiService.start();
    await fruitWsClientWrongPort.connect();
  });

  afterAll(async () => {
    await fruitService.disconnect();
    await vegService.disconnect();
    await apiService.stop();
    await fruitWsClient.disconnect();
    await fruitWsClientWrongPort.disconnect();
  });

  beforeEach(() => {
    notifications.length = 0;
  });

  it('throws if client url port is wrong', async () => {
    let theErr: unknown;
    try {
      const resp = await fruitWsClientWrongPort.ping();
      expect(resp).not.toBe('pong');
      fail('should have thrown');
    } catch (err) {
      theErr = err;
    } finally {
      expect(theErr).toBeInstanceOf(Error);
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
    expect(notifications).toStrictEqual([{ bubba: 'gump', type: 'bubba' }]);
  });

  it('responds with a 200 status for ping path', async () => {
    const statusCode = await new Promise<number | undefined>(resolve => {
      get('http://localhost:55777', resp => {
        resolve(resp.statusCode);
      });
    });
    expect(statusCode).toBe(200);
  });
});

// ========================== TEST INFRASTRUCTURE ==========================

const apiService = new ApiService({ port: 55777 });

interface FruitNotification {
  type: 'bubba';
  bubba: string;
}

const fruitWsClient = ApiClient.create<FruitApi, FruitNotification>('fruitWs', 'ws://localhost:55777', n => {
  notifications.push(n);
});
const fruitWsClientWrongPort = ApiClient.create<FruitApi>('fruitWs', 'ws://localhost:55778');
const fruitWsClientWrongPath = ApiClient.create<FruitApi>('fruitWs', 'ws://localhost:55777/wrong-path');

interface VegApi {
  getKinds(): Promise<string[]>;
}

const getVegKinds: VegApi['getKinds'] = async () => {
  if (Context.current.get('bubba') !== 'gump') {
    throw new Error('Nope');
  }

  await Context.current.notify<FruitNotification>({ type: 'bubba', bubba: 'gump' });

  return ['carrot', 'celery', 'broccoli'];
};

const vegService = new Service('vegWs', {
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
  Context.current.set('bubba', 'gump');
  const vegClient = Context.current.getClient<VegApi>('vegWs');
  return await vegClient.getKinds();
};

const fruitService = new Service('fruitWs', {
  handlers: { getKinds, getKindsIterator, doErrors, getFromContext, getVeggies },
});
