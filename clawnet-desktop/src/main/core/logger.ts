import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerConfig {
  logsDir: string;
  subsystem: string;
  category: string;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): Promise<void>;
  info(message: string, fields?: Record<string, unknown>): Promise<void>;
  warn(message: string, fields?: Record<string, unknown>): Promise<void>;
  error(message: string, fields?: Record<string, unknown>): Promise<void>;
}

function fileForToday(dir: string): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return join(dir, `app-${yyyy}-${mm}-${dd}.jsonl`);
}

export function createLogger(config: LoggerConfig): Logger {
  mkdirSync(config.logsDir, { recursive: true });

  const write = async (level: LogLevel, message: string, fields?: Record<string, unknown>) => {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      subsystem: config.subsystem,
      category: config.category,
      message,
      fields: fields ?? {},
    });
    appendFileSync(fileForToday(config.logsDir), line + '\n', 'utf-8');
  };

  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
  };
}
