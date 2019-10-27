import { registerPlugin } from '@deepstream/server/dist/src/config/config-initialiser';
import * as logging from '../../lib/logging';
import { DeepstreamMonitoring, DeepstreamPlugin, LOG_LEVEL, EVENT, MetaData, MonitoringPlugin } from '@deepstream/types';
import { Message, TOPIC, RECORD_ACTION } from '@deepstream/client/dist/constants';
import { Client } from '@deepstream/client';
import { Introspection, INTROSPECTION_ROOT } from './introspection';
import _ from 'lodash';

const log = logging.getLogger('Deepstream', 'Monitoring');

export class IwMonitoring extends DeepstreamPlugin implements DeepstreamMonitoring {
  readonly description = 'Iw Monitoring for logging and introspection';

  private readonly introspection = new Introspection();

  setClient(client: Client) {
    this.introspection.setClient(client);
  }

  onErrorLog(loglevel: LOG_LEVEL, event: EVENT, logMessage: string, metaData: MetaData): void {
    /* do nothing */
  }

  onLogin(allowed: boolean, endpointType: string): void {
    log.trace({ allowed, endpointType }, 'login');
  }

  onMessageRecieved(message: Message): void {
    log.trace({ message }, 'message received');
    if (message.topic === TOPIC.RECORD) {
      if (message.action === RECORD_ACTION.CREATE
          || message.action === RECORD_ACTION.CREATEANDPATCH
          || message.action === RECORD_ACTION.CREATEANDUPDATE
          || message.action === RECORD_ACTION.SUBSCRIBECREATEANDREAD
          || message.action === RECORD_ACTION.SUBSCRIBECREATEANDUPDATE) {

        _.forEach(_.compact([message.name, ... message.names || []]), (name) => {
          if ( ! name.startsWith(INTROSPECTION_ROOT)) {
            log.debug('record created', name);
            this.introspection.registerRecord(name);
          }
        });
      } else if (message.action === RECORD_ACTION.DELETE
          || message.action === RECORD_ACTION.DELETE_BULK) {
        _.forEach(_.compact([message.name, ... message.names || []]), (name) => {
          if ( ! name.startsWith(INTROSPECTION_ROOT)) {
            log.debug({ name }, 'record deleted');
            this.introspection.unregisterRecord(name);
          }
        });
      }
    }
  }

  onMessageSend(message: Message): void {
    log.trace({ message }, 'message sent');
  }

  onBroadcast(message: Message, count: number): void {
    log.trace({ message }, 'broadcast');
  }

}

export const MONITORING_PLUGIN: MonitoringPlugin = IwMonitoring;
export const MONITORING_PLUGIN_NAME = 'iwMonitoring';
registerPlugin(MONITORING_PLUGIN_NAME, MONITORING_PLUGIN);
