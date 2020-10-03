import { NatsConnectionOptions } from 'ts-nats';

import Service from './Service';
import { DefaultClient } from './types';

export interface ClientConfig {
  nats: NatsConnectionOptions;
  signSalt: string;
}

export interface StandaloneClient extends DefaultClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

const createClient = <T>(domain: string, config: ClientConfig): T & StandaloneClient =>
  new Service(config).getClient(domain);

export default createClient;
