/**
 * Logging Utility
 * Provides consistent logging across the application with timestamps and colors
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

interface LogOptions {
  timestamp?: boolean;
  prefix?: string;
}

const LOG_COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

class Logger {
  private static instance: Logger;
  private enabled: boolean = true;
  private logLevel: number = 0; // 0=debug, 1=info, 2=warn, 3=error
  
  private constructor() {}
  
  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }
  
  setLogLevel(level: LogLevel) {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
      success: 1,
    };
    this.logLevel = levels[level] || 0;
  }
  
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }
  
  private formatTimestamp(): string {
    const now = new Date();
    return `${LOG_COLORS.dim}[${now.toLocaleTimeString()}]${LOG_COLORS.reset}`;
  }
  
  private log(level: LogLevel, message: string, data?: any, options: LogOptions = {}) {
    if (!this.enabled) return;
    
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
      success: 1,
    };
    
    if (levels[level] < this.logLevel) return;
    
    const colors: Record<LogLevel, string> = {
      debug: LOG_COLORS.gray,
      info: LOG_COLORS.blue,
      warn: LOG_COLORS.yellow,
      error: LOG_COLORS.red,
      success: LOG_COLORS.green,
    };
    
    const icons: Record<LogLevel, string> = {
      debug: '[DEBUG]',
      info: '[INFO]',
      warn: '[WARN]',
      error: '[ERROR]',
      success: '[SUCCESS]',
    };
    
    const parts: string[] = [];
    
    // Timestamp
    if (options.timestamp !== false) {
      parts.push(this.formatTimestamp());
    }
    
    // Level indicator
    parts.push(`${colors[level]}${icons[level]}${LOG_COLORS.reset}`);
    
    // Prefix
    if (options.prefix) {
      parts.push(`${LOG_COLORS.cyan}[${options.prefix}]${LOG_COLORS.reset}`);
    }
    
    // Message
    parts.push(message);
    
    console.log(parts.join(' '));
    
    // Data payload
    if (data !== undefined) {
      if (typeof data === 'object') {
        console.log(LOG_COLORS.dim + JSON.stringify(data, null, 2) + LOG_COLORS.reset);
      } else {
        console.log(LOG_COLORS.dim + String(data) + LOG_COLORS.reset);
      }
    }
  }
  
  debug(message: string, data?: any, options?: LogOptions) {
    this.log('debug', message, data, options);
  }
  
  info(message: string, data?: any, options?: LogOptions) {
    this.log('info', message, data, options);
  }
  
  warn(message: string, data?: any, options?: LogOptions) {
    this.log('warn', message, data, options);
  }
  
  error(message: string, error?: any, options?: LogOptions) {
    this.log('error', message, error, options);
    if (error instanceof Error) {
      console.error(LOG_COLORS.red + error.stack + LOG_COLORS.reset);
    }
  }
  
  success(message: string, data?: any, options?: LogOptions) {
    this.log('success', message, data, options);
  }
  
  separator(char: string = '=', length: number = 60) {
    console.log(LOG_COLORS.dim + char.repeat(length) + LOG_COLORS.reset);
  }
  
  section(title: string) {
    this.separator();
    console.log(`${LOG_COLORS.bright}${LOG_COLORS.cyan}${title}${LOG_COLORS.reset}`);
    this.separator();
  }
  
  group(title: string, fn: () => void | Promise<void>) {
    console.group(`${LOG_COLORS.cyan}${title}${LOG_COLORS.reset}`);
    const result = fn();
    if (result instanceof Promise) {
      return result.finally(() => console.groupEnd());
    }
    console.groupEnd();
    return result;
  }
  
  table(data: any[]) {
    console.table(data);
  }
  
  progress(current: number, total: number, message?: string) {
    const percentage = Math.round((current / total) * 100);
    const bar = '█'.repeat(Math.floor(percentage / 5)) + '░'.repeat(20 - Math.floor(percentage / 5));
    const msg = message ? ` - ${message}` : '';
    console.log(`${LOG_COLORS.cyan}[${bar}] ${percentage}%${LOG_COLORS.reset}${msg}`);
  }
}

// Export singleton instance
export const logger = Logger.getInstance();

// Convenience exports
export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const warn = logger.warn.bind(logger);
export const error = logger.error.bind(logger);
export const success = logger.success.bind(logger);
export const separator = logger.separator.bind(logger);
export const section = logger.section.bind(logger);
export const group = logger.group.bind(logger);
export const table = logger.table.bind(logger);
export const progress = logger.progress.bind(logger);
