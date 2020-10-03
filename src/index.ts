import theCreateClient from './createClient';
import TheService from './Service';

export const Service = TheService;
export { ServiceConfig } from './Service';

export const createClient = theCreateClient;
export { ClientConfig } from './createClient';

export * from './types';
