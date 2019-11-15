/* Deepstream Client */

import { DeepstreamClient } from '@deepstream/client';
import { Options } from '@deepstream/client/dist/client-options';
import { Record } from '@deepstream/client/dist/record/record';
import { List } from '@deepstream/client/dist/record/list';
import { RPCResponse } from '@deepstream/client/dist/rpc/rpc-response';
import _ from 'lodash';
import WebSocket from 'ws';
import * as process from 'process';
import { EventEmitter } from 'events';
import * as logging from '../../lib/logging';
import { Service, State, setIntrospectionRecord } from '../../lib/registry';
import { CONNECTION_STATE } from '@deepstream/client/dist/constants';
import { NODE_ROOT } from '../deepstream-server/introspection';

const log = logging.getLogger('DeepstreamClient');

const SERVICE_TYPE = 'deepstream-client';
const RECONNECT_TIMEOUT = 30000; /*attempt to reconnect after 30 seconds */
const DEEPSTREAM_CONFIG: Partial<Options> = {

};

interface Subscription  {
  record: Record | List | undefined;
  isList: boolean;
  subscriptions: Array<[string | undefined, (data: any) => void]>;
}

interface ChannelSubscription {
  socket: WebSocket;
  proxies: ChannelProxy[];
}

interface PortConfig {
  port: number;
  httpPort: number;
  channelsPort: number;
}

export interface DataProvider {
  provide(record: Record, recordName: string): void;
  stop(record: Record, recordName: string): void;
}

export interface Channel {
  send(msg: string|Buffer|ArrayBuffer|Buffer[]): void;
  close(): void;
  isOpen(): boolean;
  on(event: 'message', handler: (msg: string|Buffer|ArrayBuffer|Buffer[]) => void): void;
  on(event: 'open' | 'close', handler: () => void): void;
  removeListener(event: 'message' | 'open' | 'close', handler: any): void;
  removeAllListeners(): void;
}

export type RpcCallback = (data: any, response: RPCResponse) => void;
export interface RpcSchema {
  args: any;
  ret: any;
}

export interface DeepstreamClientConfig {
  server: string;
  port: number;
  friendlyName?: string;
}

export class IwDeepstreamClient extends Service {

  private ds: DeepstreamClient | undefined;
  private readonly introspectionDataProvider: IntrospectionProvider = new IntrospectionProvider();

  // private readonly introspection = new Introspection();
  private readonly dataProviders: Map<string, DataProvider[]> = new Map();
  private readonly rpcProviders: Map<string, RpcCallback> = new Map();
  private readonly subscriptions: Map<string, Subscription> = new Map();
  private readonly channelSubscriptions: Map<string, ChannelSubscription> = new Map();

  private url: string;
  private friendlyName: string;
  private clientName: string;
  private server: string; /* hostname/ip of server */
  private portConfig: PortConfig;

  private setupComplete: boolean = false;
  private reconnectTimer: NodeJS.Timer | undefined;

  constructor() {
    super(SERVICE_TYPE);

    // process.on("beforeExit", () => this.disconnect())
  }

  start(config: DeepstreamClientConfig) {
    this.friendlyName = config.friendlyName || 'unknown';
    this.clientName = this.friendlyName + '-' + DeepstreamClient.prototype.getUid();
    this.server = config.server;
    this.connect(`${config.server}:${config.port}`);

    return Promise.resolve();
  }

  stop() {
    this.unprovideData(NODE_ROOT + this.clientName, this.introspectionDataProvider);
    this.disconnect();

    return Promise.resolve();
  }

  reconfigure(config: DeepstreamClientConfig) {
    this.start(config);

    return Promise.resolve(true);
  }

  private connect(url: string) {
    this.stopReconnect();

    /* close active connection */
    if (this.ds) {
      this.disconnect();
    }

    this.url = url;

    /* connect and log in anonymously */
    log.info({ url }, `Connecting to ${url}`);
    this.ds = new DeepstreamClient(url, DEEPSTREAM_CONFIG);

    this.ds.on('error', (msg: string, event: string, topic: string) => {
      log.error({ event, topic }, `${event}: ${msg}`);
    });

    this.ds.on('connectionStateChanged', (state: CONNECTION_STATE) => {
      log.debug({ state }, 'Connection state changed');
      switch (state) {
        case 'OPEN':
          this.setState(State.OK, `connected to server at ${this.url}`);
          this.stopReconnect();
          this.afterConnect();
          break;
        case 'CLOSED':
          this.setState(State.INACTIVE, 'connection closed');
          this.emit('disconnected');
          break;
        case 'ERROR':
          this.setState(State.ERROR, 'connection interrupted');
          this.emit('disconnected');
          this.reconnect();
          break;
        case 'RECONNECTING':
          this.setState(State.PROBLEM, 'reconnecting ...');
          break;
        case 'AWAITING_AUTHENTICATION':
          this.setState(State.BUSY, `connecting to server at ${this.url}`);
          break;
        case 'AUTHENTICATING':
          this.setState(State.BUSY, 'logging in ...');
          break;
      }
    });

    this.ds.login({
      username: this.clientName
    });
  }

  private disconnect() {
    this.stopReconnect();

    this.url = undefined;
    this.setupComplete = false;

    if (this.ds) {
      this.ds.close();
      this.ds.off();
      this.ds.on('error', () => {/* squelch errors from old connection */});
      this.ds = undefined;
      setIntrospectionRecord(undefined);
      // this.introspection.setClient(undefined);
      for (const [recordName, sub] of this.subscriptions) {
        /* remove record handles from old connection */
        sub.record = undefined;
      }
      for (const [channel, sub] of this.channelSubscriptions) {
        if (sub.socket) {
          sub.socket.close();
        }
      }
    }
    this.setState(State.INACTIVE, 'disconnected');
  }

  private reconnect() {
    if ( ! this.ds || this.reconnectTimer) {
      /* no connection or reconnect already in progress */
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect(this.url);
    }, RECONNECT_TIMEOUT);
  }

  private stopReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private afterConnect() {
    if (this.setupComplete) {
      this.emit('connected');
      return;
    }

    // /* restore subscriptions */
    // for (const [recordName, sub] of this.subscriptions) {
    //   /* get record handle */
    //   const record = this.ds.record.getRecord(recordName);
    //   sub.record = record;
    //   for (const [path, callback] of sub.subscriptions) {
    //     this.startSubscribe(record, callback, path, false);
    //   }
    // }

    // /* restore data providers */
    // for (const [pattern, providers] of this.dataProviders) {
    //   this.startListen(pattern);
    // }

    // /* restore rpc providers */
    // for (const [name, callback] of this.rpcProviders) {
    //   this.ds.rpc.provide(name, callback);
    // }

    /* get port configuration for channels */
    this.getData('server/portConfig').then((portConfig) => {
      this.portConfig = portConfig;
      this.afterPortConfig();
    });
  }

  /* called from afterConnect() after port config is available
   * to perform setup tasks that require port config */
  private afterPortConfig() {
    /* restore Channel connections */
    for (const [path, sub] of this.channelSubscriptions) {
      if ( ! sub.socket) {
        this.connectChannel(path, sub);
      }
    }

    this.setupComplete = true;
    this.emit('connected');

    this.provideData(NODE_ROOT + this.clientName, this.introspectionDataProvider);
  }

  getRecord(name: string, schema?: any): Record {
    const record = this.ds.record.getRecord(name);
    const deleteFunc = record.delete.bind(record);
    record.delete = () => {
      // this.introspection.unregisterRecord(name);
      deleteFunc();
    };
    // this.introspection.registerRecord(name, schema);
    return this.ds.record.getRecord(name);
  }

  getList(name: string): List {
    return this.ds.record.getList(name);
  }

  getData(recordName: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if ( ! this.ds) {
        return reject('not connected');
      }

      const record = this.getRecord(recordName);

      record.on('error', (err: any, message: string) => {
        log.error({ err, message }, `failed to get data for record ${recordName}`);
        record.off();
        reject(err);
      });

      record.whenReady(() => process.nextTick(() => {
        const data = record.get();
        record.off();
        record.discard();
        resolve(data);
      }));
    });
  }

  makeRpc(name: string, data: any, callback: (error: string, result?: any) => void) {
    if ( ! this.ds) {
      return process.nextTick(() => callback('not connected'));
    }
    this.ds.rpc.make(name, data, callback);
  }

  provideData(pattern: string, provider: DataProvider, schema?: any) {
    if ( ! this.dataProviders.has(pattern)) {
      this.dataProviders.set(pattern, []);
      if (this.setupComplete) {
        this.startListen(pattern);
      }
    }

    // this.introspection.registerRecord(pattern, schema, true);

    this.dataProviders.get(pattern).push(provider);
  }

  private startListen(pattern: string) {
    this.ds.record.listen(pattern, (match, response) => {
      const providers = this.dataProviders.get(pattern);
      if (providers === undefined || providers.length === 0) {
        response.reject();
        return;
      }

      const record = this.ds.record.getRecord(match);
      for (const provider of providers) {
        provider.provide(record, match);
      }
      response.accept();

      response.onStop(() => {
        for (const provider of providers) {
          provider.stop(record, match);
        }
        record.discard();
      });
    });
  }

  unprovideData(pattern: string, provider: DataProvider) {
    const remainingProviders = _.pull(this.dataProviders.get(pattern), provider);

    if (remainingProviders.length === 0) {
      if (this.setupComplete) {
        this.ds.record.unlisten(pattern);
      }
      this.dataProviders.delete(pattern);
    }

    // this.introspection.unregisterRecord(pattern);
  }

  openChannel(path: string): Channel {
    log.debug({channel: path}, `adding subscription for channel ${path}`);

    let sub = this.channelSubscriptions.get(path);
    if (sub === undefined) {
      sub = {
        socket: undefined,
        proxies: []
      };
      this.channelSubscriptions.set(path, sub);
      // this.introspection.registerChannel(path);
    }
    const proxy = new ChannelProxy(sub);
    sub.proxies.push(proxy);

    if (sub.socket === undefined && this.setupComplete) {
      this.connectChannel(path, sub);
    }

    proxy.on('_internalClose', () => {
      log.debug({channel: path}, `removing subscription for channel ${path}`);
      _.remove(sub.proxies, (p) => p === proxy);
      if (sub.proxies.length === 0) {
        log.debug({channel: path}, `no more subscribers for channel ${path}`);
        this.channelSubscriptions.delete(path);
        // this.introspection.unregisterChannel(path);
        if (sub.socket) {
          log.debug({channel: path}, `closing channel ${path}`);
          sub.socket.close();
        }
      }
    });
    proxy.on('_internalSendMessage', (msg) => {
      if (sub.socket) {
        sub.socket.send(msg);
      } else {
        log.warn({channel: path}, `message sent to channel ${path} while channel was not connected; message lost`);
      }
    });

    return proxy;
  }

  private connectChannel(path: string, sub: ChannelSubscription): void {
    if (sub.proxies.length === 0) {
      /* no longer interested */
      return;
    }
    if (sub.socket !== undefined) {
      /* already connected */
      return;
    }

    log.debug({ channel: path, addr: this.server, port: this.portConfig.channelsPort }, `connecting socket for channel ${path}`);
    const socket = new WebSocket(`ws://${this.server}:${this.portConfig.channelsPort}/${path || ''}`);
    socket.on('error', (err) => {
      log.error({ err, channel: path }, `error on channel ${path}`);
    });
    socket.on('open', () => {
      sub.socket = socket;
      log.debug({ channel: path }, `successfully opened channel ${path}`);
      for (const proxy of sub.proxies) {
        proxy.emit('open');
      }
    });
    socket.on('close', (code, reason) => {
      sub.socket = undefined;
      if (sub.proxies.length > 0) {
        log.debug({ channel: path, code, reason }, `channel ${path} closed unexpectedly; reconnecting ...`);
        setTimeout(() => this.connectChannel(path, sub), RECONNECT_TIMEOUT);
        for (const proxy of sub.proxies) {
          proxy.emit('close');
        }
      } else if (this.setupComplete) {
        log.debug({ channel: path, code, reason }, `channel ${path} closed`);
      }
    });
    socket.on('message', (msg) => {
      for (const proxy of sub.proxies) {
        proxy.emit('message', msg);
      }
    });
  }

  subscribe(recordName: string, callback: (data: any) => void,
            path?: string, now: boolean = true) {
    this.createSubscription(false, recordName, callback, path, now);
    // this.introspection.registerRecord(recordName);
  }

  subscribeList(recordName: string, callback: (data: any) => void, now: boolean = true) {
    this.createSubscription(true, recordName, callback, undefined, now);
  }

  private createSubscription(isList: boolean, recordName: string,
                             callback: (data: any) => void, path: string, now: boolean) {
    let sub = this.subscriptions.get(recordName);
    if (sub === undefined) {
      sub = {
        record: undefined,
        isList,
        subscriptions: []
      };
      this.subscriptions.set(recordName, sub);
    }
    sub.subscriptions.push([path, callback]);

    if (this.setupComplete) {
      const record = isList ? this.ds.record.getList(recordName) : this.ds.record.getRecord(recordName);
      sub.record = record;
      this.startSubscribe(record, callback, path, now);
    }
  }

  private startSubscribe(record: Record | List,
                         callback: (data: any) => void, path: string, now: boolean) {
    if (path) {
      (record as Record).subscribe(path, callback, now);
    } else {
      (record as Record).subscribe(undefined, callback, now);
    }
  }

  unsubscribe(recordName: string, callback: (data: any) => void) {
    /* remove callback from list of subscribers */
    const sub = this.subscriptions.get(recordName);
    if ( ! sub) {
      return;
    }
    const record = sub.record;
    _.remove(sub.subscriptions, (subscription) => {
      if (subscription[1] === callback) {
        if (record) {
          (record as Record).unsubscribe(subscription[0], callback);
        }
        return true;
      }
      return false;
    });
    if (sub.subscriptions.length === 0) {
      this.subscriptions.delete(recordName);
      if (record) {
        record.discard();
      }
    }
  }

  provideRpc(name: string, callback: RpcCallback, schema?: RpcSchema) {
    this.rpcProviders.set(name, callback);
    // this.introspection.registerRpc(name, schema);

    if (this.setupComplete) {
      this.ds.rpc.provide(name, callback);
    }
  }

  unprovideRpc(name: string) {
    this.rpcProviders.delete(name);
    // this.introspection.unregisterRpc(name);

    if (this.setupComplete) {
      this.ds.rpc.unprovide(name);
    }
  }

  getClientName(): string {
    return this.clientName;
  }

  /* this is the getUid() function copied from deepstream
   * so it can be called without having a client instance */
  static getUid(): string {
    const timestamp = (new Date()).getTime().toString(36);
    const randomString = (Math.random() * 10000000000000000).toString(36).replace( '.', '' );

    return timestamp + '-' + randomString;
  }
}

class ChannelProxy extends EventEmitter implements Channel {

  constructor(private subscription: ChannelSubscription) {
    super();
  }

  send(msg) {
    this.emit('_internalSendMessage', msg);
  }

  close() {
    this.emit('_internalClose');
  }

  isOpen() {
    return this.subscription.socket !== undefined;
  }
}

class IntrospectionProvider implements DataProvider {
  provide(record: Record, recordName: string) {
    setIntrospectionRecord(record);
  }

  stop(record: Record, recordName: string) {
    setIntrospectionRecord(undefined);
  }
}
