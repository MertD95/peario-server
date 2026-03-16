import pino from 'pino';
import { LOG_LEVEL, IS_PRODUCTION } from './config';

const logger = pino({
    level: LOG_LEVEL,
    ...(IS_PRODUCTION ? {} : {
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
            },
        },
    }),
});

export default logger;
