const isCCI = process.env['CCI'] === '1';

export const NATS_URI = `nats://localhost:${isCCI ? 4222 : 4224}`;
export const MONGO_URI = `mongodb://localhost:${isCCI ? 27017 : 27018}/authtest`;
