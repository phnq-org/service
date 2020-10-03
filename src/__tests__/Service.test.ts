import { matchCategory } from '@phnq/log';
import { Anomaly } from '@phnq/message';

import createClient from '../createClient';
import Service from '../Service';

if (process.env.PHNQ_MESSAGE_LOG_NATS === '1') {
  matchCategory(/.+/);
}

const wait = (millis = 0): Promise<void> =>
  new Promise((resolve): void => {
    setTimeout(resolve, millis);
  });

const fruitService = new Service({
  signSalt: 'abcd1234',
  domain: 'fruit',
  nats: { servers: ['nats://localhost:4224'] },
});

interface FruitApi {
  getKinds(): Promise<string[]>;
  getKindsIterator(): Promise<AsyncIterableIterator<string>>;
  doErrors(type: 'error' | 'anomaly' | 'none'): Promise<void>;
}

const getKinds: FruitApi['getKinds'] = async () => ['apple', 'orange', 'pear'];

const getKindsIterator: FruitApi['getKindsIterator'] = async () =>
  (async function* () {
    await wait(200);
    yield 'apple';
    await wait(200);
    yield 'orange';
    await wait(200);
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

fruitService.setHandler('getKinds', getKinds);
fruitService.setHandler('getKindsIterator', getKindsIterator);
fruitService.setHandler('doErrors', doErrors);

const fruitClient = createClient<FruitApi>('fruit', {
  signSalt: 'abcd1234',
  nats: { servers: ['nats://localhost:4224'] },
});

describe('Service', () => {
  beforeAll(async () => {
    await fruitService.connect();
  });

  afterAll(async () => {
    await fruitService.disconnect();
    await fruitClient.disconnect();
  });

  it('does latency test', async () => {
    expect(typeof (await fruitService.testLatency())).toBe('number');
  });

  it('does ping from client', async () => {
    expect(await fruitClient.ping()).toBe('pong');
  });

  it('calls service method from another service', async () => {
    expect(await fruitClient.getKinds()).toStrictEqual(['apple', 'orange', 'pear']);
  });

  it('calls service iterator method from another service', async () => {
    const responses: string[] = [];
    for await (const response of await fruitClient.getKindsIterator()) {
      responses.push(response);
    }
    expect(responses).toStrictEqual(['apple', 'orange', 'pear']);
  });

  it('should throw if connection fails', async () => {
    try {
      await createClient<FruitApi>('fruit', {
        signSalt: 'abcd1234',
        nats: { servers: ['nats://localhost:4225'] }, // wrong port
      }).connect();
      fail('should have thrown');
    } catch (err) {
      // do nothing
    }
  });

  it('should handle anomalies', async () => {
    try {
      await fruitClient.doErrors('anomaly');
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Anomaly);
    }
  });

  it('should handle errors', async () => {
    try {
      await fruitClient.doErrors('error');
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('should throw when setting a handler without a domain', () => {
    const anonService = new Service({
      signSalt: 'abcd1234',
      nats: { servers: ['nats://localhost:4224'] },
    });

    expect(() => {
      anonService.setHandler('nope', () => Promise.resolve('yo'));
    }).toThrow();
  });

  it('should throw when testing latency without a domain', async () => {
    const anonService = new Service({
      signSalt: 'abcd1234',
      nats: { servers: ['nats://localhost:4224'] },
    });

    try {
      await anonService.testLatency();
      fail('should have thrown');
    } catch (err) {
      // nothing
    }

    await anonService.disconnect();
  });

  it('should return client connected state', async () => {
    const client = createClient<FruitApi>('fruit', {
      signSalt: 'abcd1234',
      nats: { servers: ['nats://localhost:4224'] },
    });
    expect(client.isConnected).toBe(false);
    await client.connect();
    expect(client.isConnected).toBe(true);
    await client.disconnect();
    expect(client.isConnected).toBe(false);
  });

  it('should return service connected state', async () => {
    const service = new Service({
      signSalt: 'abcd1234',
      domain: 'some-service',
      nats: { servers: ['nats://localhost:4224'] },
    });
    expect(service.isConnected).toBe(false);
    await service.connect();
    expect(service.isConnected).toBe(true);
    await service.disconnect();
    expect(service.isConnected).toBe(false);
  });

  it('should throw if no handler is found', async () => {
    const fruitClientBadApi = createClient<{ nope(): Promise<void> }>('fruit', {
      signSalt: 'abcd1234',
      nats: { servers: ['nats://localhost:4224'] },
    });

    try {
      await fruitClientBadApi.nope();
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Anomaly);
      expect((err as Anomaly).message).toBe('No handler for method: nope');
    }

    fruitClientBadApi.disconnect();
  });

  // it('should throw on sign verification error', async () => {
  //   const client = createClient<FruitApi>('fruit', {
  //     signSalt: 'abcd12345', // wrong salt
  //     nats: { servers: ['nats://localhost:4224'] },
  //   });
  //   try {
  //     await client.ping();
  //     fail('should have thrown');
  //   } catch (err) {
  //     // do nothing
  //   }
  // });
});
