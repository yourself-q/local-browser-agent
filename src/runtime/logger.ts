import pino from 'pino';

// ─── Logger factory ───────────────────────────────────────────────────────────

let _logLevel: string = process.env['LOG_LEVEL'] ?? 'info';
let _pretty: boolean = (process.env['LOG_PRETTY'] ?? 'true') === 'true';

export function createLogger(name: string): pino.Logger {
  const transport =
    _pretty && process.stdout.isTTY
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined;

  return pino(
    {
      name,
      level: _logLevel,
    },
    transport ? pino.transport(transport) : undefined,
  );
}

/** Override log level at runtime (useful for CLI flags) */
export function setLogLevel(level: string): void {
  _logLevel = level;
}

export function setPretty(pretty: boolean): void {
  _pretty = pretty;
}

/** Shared root logger */
export const rootLogger = createLogger('agent');
