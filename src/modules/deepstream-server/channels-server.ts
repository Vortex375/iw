import { Service, State } from '../../lib/registry';
import * as logging from '../../lib/logging';
import WebSocket = require('ws');
import http = require('http');
import url = require('url');
import _ from 'lodash';
import { DeepstreamPlugin, DeepstreamServices } from '@deepstream/types';
import { registerPlugin } from '@deepstream/server/dist/src/config/config-initialiser';
import { IwMonitoring } from './monitoring';

const log = logging.getLogger('Channels');

export const CHANNELS_SERVER_PLUGIN_NAME = 'channels-server';

export interface ChannelsServerConfig {
  port: number;
}

export class ChannelsServer extends Service implements DeepstreamPlugin {
  readonly description = 'IW Channels Server';

  private wss: WebSocket.Server;
  private channels: Map<string, WebSocket[]> = new Map();

  constructor(private config: ChannelsServerConfig, private services: DeepstreamServices) {
    super(CHANNELS_SERVER_PLUGIN_NAME);
  }

  whenReady() {
    return this.start();
  }

  close() {
    return this.stop();
  }

  start() {
    if (this.wss) {
      this.stop();
    }

    this.wss = new WebSocket.Server({port: this.config.port});
    this.setState(State.BUSY, 'starting up ...');

    this.wss.on('error', (e) => {
      this.setState(State.ERROR, 'wss error');
      this.setErrorDiagnostic(e);
    });
    this.wss.on('listening', () => {
      this.setState(State.OK, `Channels server listening on :${this.config.port}`);
    });
    this.wss.on('connection', (ws: WebSocket, req?: http.IncomingMessage) => {
      /* compatibiliy with ws < 3 */
      const request = req;
      log.debug({ ws, req: request }, 'incoming connection');
      const requestUrl = url.parse(request.url);
      this.addClient(ws, requestUrl.pathname);
    });

    return Promise.resolve();
  }

  stop() {
    this.wss.close();
    this.wss = undefined;
    this.setState(State.INACTIVE, 'Channels server shut down');

    return Promise.resolve();
  }

  private addClient(ws: WebSocket, path: string) {
    const introspection = (this.services.monitoring as IwMonitoring).introspection;
    introspection.registerChannel(path);

    log.debug({channel: path}, 'adding client');
    if ( ! this.channels.has(path)) {
      this.channels.set(path, []);
    }
    this.channels.get(path).push(ws);
    ws.on('error', (e) => {
      log.error({err: e}, 'websocket error');
    });
    ws.on('close', (code, reason) => {
      log.debug({ code, channel: path }, 'client disconnected: %s', reason);
      _.pull(this.channels.get(path), ws);
      ws.removeAllListeners();
      introspection.unregisterChannel(path);
    });
    ws.on('message', (data) => {
      /* broadcast to all other sockets on the same channel */
      _.forEach(this.channels.get(path), (other: WebSocket) => {
        if (other !== ws && other.readyState === WebSocket.OPEN) {
          other.send(data);
        }
      });
    });
  }
}

registerPlugin(CHANNELS_SERVER_PLUGIN_NAME, ChannelsServer);
