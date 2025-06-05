export const NATS_URI = process.env.PHNQ_SERVICE_NATS; // e.g 'nats://localhost:4222';

export const NATS_MONITOR_URI = process.env.PHNQ_SERVICE_NATS_MONITOR; // e.g. 'nats://localhost:8222';

export const SIGN_SALT = process.env.PHNQ_SERVICE_SIGN_SALT ?? 'absd1234';
