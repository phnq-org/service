import Service, { ServiceApi, ServiceConfig } from './Service';
import { HandlerStatsReport, Stats } from './ServiceStats';

export interface DefaultClient {
  ping(): Promise<string>;
  /**
   * Retrieve stats for the service, and any clients that it uses.
   * Note: if there are multiple instances of the service (load balanced),
   * then the stats will be for a random instance.
   */
  getStats(): Promise<Stats>;
  stats: Record<string, HandlerStatsReport>;
  isConnected: boolean;
}

export interface StandaloneClient extends DefaultClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export type ClientConfig<T extends ServiceApi<T>> = Omit<ServiceConfig<T>, 'handlers'>;

class ServiceClient {
  public static create<T extends ServiceApi<T>>(domain: string, config?: ClientConfig<T>): T & StandaloneClient {
    return new Service<T>(null, config).getClient(domain);
  }
}

export default ServiceClient;
