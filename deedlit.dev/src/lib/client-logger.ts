/**
 * Client-Side Logger for Browser
 * Provides logging with styled console output
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

const LOG_STYLES = {
  debug: 'color: #888; font-size: 11px;',
  info: 'color: #2196F3; font-weight: bold;',
  warn: 'color: #FF9800; font-weight: bold;',
  error: 'color: #F44336; font-weight: bold;',
  success: 'color: #4CAF50; font-weight: bold;',
  timestamp: 'color: #999; font-size: 10px;',
  prefix: 'color: #00BCD4; font-weight: bold;',
};

class ClientLogger {
  private static instance: ClientLogger;
  private enabled: boolean = process.env.NODE_ENV === 'development';
  private logLevel: number = 0; // 0=debug, 1=info, 2=warn, 3=error
  
  private constructor() {}
  
  static getInstance(): ClientLogger {
    if (!ClientLogger.instance) {
      ClientLogger.instance = new ClientLogger();
    }
    return ClientLogger.instance;
  }
  
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
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
  
  private formatTimestamp(): string {
    const now = new Date();
    return now.toLocaleTimeString('en-US', { hour12: false });
  }
  
  private log(level: LogLevel, message: string, data?: any, prefix?: string) {
    if (!this.enabled) return;
    if (typeof window === 'undefined') return; // SSR safety
    
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
      success: 1,
    };
    
    if (levels[level] < this.logLevel) return;
    
    const icons: Record<LogLevel, string> = {
      debug: '[DEBUG]',
      info: '[INFO]',
      warn: '[WARN]',
      error: '[ERROR]',
      success: '[SUCCESS]',
    };
    
    const timestamp = this.formatTimestamp();
    const args: any[] = [];
    
    // Build styled console message
    let msg = `%c[${timestamp}] %c${icons[level]}`;
    let styles = [LOG_STYLES.timestamp, LOG_STYLES[level]];
    
    if (prefix) {
      msg += ` %c[${prefix}]`;
      styles.push(LOG_STYLES.prefix);
    }
    
    msg += ' %c' + message;
    styles.push('color: inherit;');
    
    args.push(msg, ...styles);
    
    // Log to appropriate console method
    const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[consoleMethod](...args);
    
    // Log data if provided
    if (data !== undefined) {
      console[consoleMethod](data);
    }
  }
  
  debug(message: string, data?: any, prefix?: string) {
    this.log('debug', message, data, prefix);
  }
  
  info(message: string, data?: any, prefix?: string) {
    this.log('info', message, data, prefix);
  }
  
  warn(message: string, data?: any, prefix?: string) {
    this.log('warn', message, data, prefix);
  }
  
  error(message: string, error?: any, prefix?: string) {
    this.log('error', message, error, prefix);
  }
  
  success(message: string, data?: any, prefix?: string) {
    this.log('success', message, data, prefix);
  }
  
  group(title: string, fn: () => void) {
    if (!this.enabled || typeof window === 'undefined') return;
    console.group(`%c${title}`, 'font-weight: bold; color: #00BCD4;');
    fn();
    console.groupEnd();
  }
  
  table(data: any[]) {
    if (!this.enabled || typeof window === 'undefined') return;
    console.table(data);
  }
  
  time(label: string) {
    if (!this.enabled || typeof window === 'undefined') return;
    console.time(label);
  }
  
  timeEnd(label: string) {
    if (!this.enabled || typeof window === 'undefined') return;
    console.timeEnd(label);
  }
}

// Export singleton instance
export const logger = ClientLogger.getInstance();

// Convenience exports
export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const warn = logger.warn.bind(logger);
export const error = logger.error.bind(logger);
export const success = logger.success.bind(logger);
export const group = logger.group.bind(logger);
export const table = logger.table.bind(logger);
