import { z } from 'zod';

const envSchema = z.object({
    PORT: z.coerce.number().default(8181),
    PEM_CERT: z.string().min(1).optional(),
    PEM_KEY: z.string().min(1).optional(),
    INTERVAL_ROOM_UPDATE: z.coerce.number().default(30000),
    PING_INTERVAL: z.coerce.number().default(30000),
    MAX_CONNECTIONS: z.coerce.number().default(10000),
    MAX_CONNECTIONS_PER_IP: z.coerce.number().default(10),
    LOG_LEVEL: z.string().default('info'),
    NODE_ENV: z.string().default('development'),
});

const env = envSchema.parse(process.env);

export const PORT = env.PORT;
export const PEM_CERT = env.PEM_CERT;
export const PEM_KEY = env.PEM_KEY;
export const INTERVAL_ROOM_UPDATE = env.INTERVAL_ROOM_UPDATE;
export const PING_INTERVAL = env.PING_INTERVAL;
export const MAX_CONNECTIONS = env.MAX_CONNECTIONS;
export const MAX_CONNECTIONS_PER_IP = env.MAX_CONNECTIONS_PER_IP;
export const LOG_LEVEL = env.LOG_LEVEL;
export const USE_TLS = !!(PEM_CERT && PEM_KEY);
export const IS_PRODUCTION = env.NODE_ENV === 'production';
