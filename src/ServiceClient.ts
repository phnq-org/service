import Service, { ServiceConfig } from './Service';

export interface DefaultClient {
  ping(): Promise<string>;
  isConnected: boolean;
}

export interface StandaloneClient extends DefaultClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export type ClientConfig = Omit<ServiceConfig, 'domain' | 'handlers'>;

class ServiceClient {
  public static create<T>(domain: string, config: ClientConfig): T & StandaloneClient {
    return new Service(config).getClient(domain);
  }
}

export default ServiceClient;
