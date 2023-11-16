import { matchCategory } from '@phnq/log';

import Service, { ServiceApiImpl } from '../Service';
import ServiceClient from '../ServiceClient';

if (process.env.PHNQ_MESSAGE_LOG_NATS === '1') {
  matchCategory(/.+/);
}

describe('Load Balancing', () => {
  let numHandled = 0;

  beforeAll(async () => {
    numHandled = 0;
    for await (const s of cheeseServices) {
      await s.connect();
    }
  });

  afterAll(async () => {
    await Promise.all(cheeseServices.map(s => s.disconnect()));
    await cheeseClient.disconnect();
  });

  it('routes requests to services in a round-robin manner', async () => {
    const serviceOrigins = cheeseServices.map(s => s.origin);

    const originResponses: string[] = [];
    for (let i = 0; i < cheeseServices.length; i++) {
      originResponses.push(await cheeseClient.getOrigin());
    }

    expect(originResponses.every(o => serviceOrigins.includes(o))).toBe(true);
    expect(originResponses.length).toBe(numHandled);
    expect(numHandled).toBe(cheeseServices.length);
  });

  // ========================== TEST INFRASTRUCTURE ==========================

  interface CheeseApi {
    getOrigin(): Promise<string>;
  }

  const getOrigin: ServiceApiImpl<CheeseApi>['getOrigin'] = async (_, service) => {
    numHandled += 1;
    return service.origin;
  };

  const cheeseServices = Array(3)
    .fill(0)
    .map(
      () =>
        new Service<CheeseApi>('cheese', {
          handlers: {
            getOrigin,
          },
        }),
    );

  const cheeseClient = ServiceClient.create<CheeseApi>('cheese');
});
