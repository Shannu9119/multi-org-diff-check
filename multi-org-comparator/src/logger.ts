export class Logger {
  static info(...args: any[]) {
    console.log('[multi-org-comparator]', ...args);
  }
  static error(...args: any[]) {
    console.error('[multi-org-comparator]', ...args);
  }
}
