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

export type ClientConfig<T extends ServiceApi<D>, D extends string = T['domain']> = Omit<ServiceConfig<T>, 'handlers'>;

const clientCache = new Map<string, StandaloneClient>();

class ServiceClient {
  /**
   * Create a client for the given service domain.
   *
   * @param domain
   * @param config
   * @returns
   */
  public static create<T extends ServiceApi<D>, D extends string = T['domain']>(
    domain: D,
    config?: ClientConfig<T>,
  ): T['handlers'] & StandaloneClient {
    return new Service<T>(domain, config).getClient() as T['handlers'] & StandaloneClient;
  }

  /**
   * Get a cached client for the given service domain. Create it if it doesn't exist.
   *
   * @param domain
   * @param config
   * @returns
   */
  public static get<T extends ServiceApi<D>, D extends string = T['domain']>(
    domain: D,
    config?: ClientConfig<T>,
  ): T['handlers'] & StandaloneClient {
    const key = `${domain}:${JSON.stringify(config)}`;
    if (!clientCache.has(key)) {
      clientCache.set(key, new Service<T>(domain, config).getClient() as T['handlers'] & StandaloneClient);
    }
    return clientCache.get(key) as T['handlers'] & StandaloneClient;
  }
}

export default ServiceClient;
