import Service, { ServiceApi, ServiceConfig, ServiceInstanceInfo } from './Service';

export interface DefaultClient {
  ping(): Promise<string>;
  rollCall(): Promise<ServiceInstanceInfo[]>;
  isConnected: boolean;
}

export interface StandaloneClient extends DefaultClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export type ClientConfig<T extends ServiceApi<T>> = Omit<ServiceConfig<T>, 'domain' | 'handlers'>;

class ServiceClient {
  public static create<T extends ServiceApi<T>>(domain: string, config: ClientConfig<T>): T & StandaloneClient {
    return new Service<T>(config).getClient(domain);
  }
}

export default ServiceClient;
