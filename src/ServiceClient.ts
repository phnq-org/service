import { NatsConnectionOptions } from 'ts-nats';

import Service from './Service';

export interface DefaultClient {
  ping(): Promise<string>;
  isConnected: boolean;
}

export interface StandaloneClient extends DefaultClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface ClientConfig {
  nats: NatsConnectionOptions;
  signSalt: string;
}

class ServiceClient {
  public static create<T>(domain: string, config: ClientConfig): T & StandaloneClient {
    return new Service(config).getClient(domain);
  }
}

export default ServiceClient;
