import { DeepstreamPlugin, DeepstreamLogger, DeepstreamServices, DeepstreamConfig,
         LOG_LEVEL, NamespacedLogger, MetaData, LoggerPlugin } from '@deepstream/types';
import { registerPlugin } from '@deepstream/server/dist/src/config/config-initialiser';
import * as logging from '../../lib/logging';

const serverLog = logging.getLogger('Deepstream', 'Server');

class LogAdapter extends DeepstreamPlugin implements DeepstreamLogger {
  readonly description = "Adapter to plug deepstream's logging into iw logging";

  constructor(pluginConfig: any, services: DeepstreamServices, config: DeepstreamConfig) {
    super();
  }

  shouldLog(logLevel: LOG_LEVEL): boolean {
    return true;
  }

  setLogLevel(logLevel: LOG_LEVEL): void {
    /* do nothing */
  }

  getNameSpace(namespace: string): NamespacedLogger {
    return this;
  }

  info(event: string, message?: string, metaData?: MetaData): void {
    this.log(LOG_LEVEL.INFO, event, message, metaData);
  }

  debug(event: string, message?: string, metaData?: MetaData): void {
    this.log(LOG_LEVEL.DEBUG, event, message, metaData);
  }

  warn(event: string, message: string, metaData?: MetaData): void {
    this.log(LOG_LEVEL.WARN, event, message, metaData);
  }

  error(event: string, message: string, metaData?: MetaData): void {
    this.log(LOG_LEVEL.ERROR, event, message, metaData);
  }

  fatal(event: string, message: string, metaData?: MetaData): void {
    this.log(LOG_LEVEL.FATAL, event, message, metaData);
  }

  private log(level: LOG_LEVEL, event: string, message: string, metaData: MetaData = {}) {
    switch (level) {
      case LOG_LEVEL.DEBUG:
        serverLog.debug(metaData, `${event} | ${message || ''}`);
        break;
      case LOG_LEVEL.INFO:
        serverLog.info(metaData, `${event} | ${message || ''}`);
        break;
      case LOG_LEVEL.WARN:
        serverLog.warn(metaData, `${event} | ${message || ''}`);
        break;
      case LOG_LEVEL.ERROR:
        serverLog.error(metaData, `${event} | ${message || ''}`);
        break;
      case LOG_LEVEL.FATAL:
        serverLog.fatal(metaData, `${event} | ${message || ''}`);
        break;
    }
  }
}
export const LOG_ADAPTER_PLUGIN: LoggerPlugin = LogAdapter;
export const LOG_ADAPTER_PLUGIN_NAME = 'iwLogAdapter';
registerPlugin(LOG_ADAPTER_PLUGIN_NAME, LOG_ADAPTER_PLUGIN);
