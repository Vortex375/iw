/* Deepstream Server */

import { Deepstream } from '@deepstream/server';
import fuckthis, { Client } from '@deepstream/client';
import { PartialDeepstreamConfig } from '@deepstream/types';
import { Options } from '@deepstream/client/dist/client-options';
import _ from 'lodash';
import { Service, State } from '../../lib/registry';
import { LOG_ADAPTER_PLUGIN_NAME } from './log-adapter';
import { ChannelsServer } from './channels-server';
import { MONITORING_PLUGIN_NAME, IwMonitoring } from './monitoring';

const deepstream: (url: string, options?: Partial<Options>) => Client = fuckthis as any;

const SERVICE_TYPE = 'deepstream-server';
export const DEFAULT_DEEPSTREAM_PORT = 6020;
export const DEFAULT_HTTP_PORT = 6080;
export const DEFAULT_CHANNELS_PORT = 6081;

const DEEPSTREAM_CONFIG: PartialDeepstreamConfig = {
  showLogo: false,
  logger: {
    type: 'custom',
    name: LOG_ADAPTER_PLUGIN_NAME
  },
  monitoring: {
    type: 'custom',
    name: MONITORING_PLUGIN_NAME
  },
  cache: {
    name: 'redis'
  },
  connectionEndpoints: [
    {
      name: 'ws',
      type: 'uws-websocket',
      options: {
        port: DEFAULT_DEEPSTREAM_PORT
      }
    },
    {
      name: 'http',
      type: 'node-http',
      options: {
        port: DEFAULT_HTTP_PORT
      }
    }
  ],
  /* set less aggressive timeout values
   * to allow running on weak IoT hardware */
  rpc: {
    ackTimeout: 5000,
    responseTimeout: 60000,
  },
  record: {
    cacheRetrievalTimeout: 5000,
    storageRetrievalTimeout: 10000
  },
  listen: {
    responseTimeout: 5000
  },
  dependencyInitialisationTimeout: 20000
};

export interface DeepstreamServerConfig {
  port?: number;
  httpPort?: number;
  channelsPort?: number;
  persist?: boolean | [string];
  plugins?: any;
}

export class DeepstreamServer extends Service {

  private server: Deepstream;
  private ds: Client;
  private channels: ChannelsServer;
  private port: number;

  constructor() {
    super(SERVICE_TYPE);
  }

  start(config: DeepstreamServerConfig) {
    this.setState(State.BUSY, 'starting up ...');
    /* build configuration for the deepstream server*/
    const deepstreamConfig: PartialDeepstreamConfig = _.assign({}, DEEPSTREAM_CONFIG);
    if (config.port !== undefined) {
      deepstreamConfig.connectionEndpoints[0].options.port = config.port;
    }
    if (config.httpPort !== undefined) {
      deepstreamConfig.connectionEndpoints[1].options.port = config.port;
    }

    deepstreamConfig.plugins = config.plugins;

    // if (config.persist === undefined || config.persist === false) {
    //   /* exclude everything from storage */
    //   deepstreamConfig.record.storageExclusionPrefixes = [""]
    // } else if (config.persist !== true && config.persist.length > 0) {
    //   /* create regular expression that matches everything except paths listed in config.persist */
    //   const paths = _(config.persist).map((s) => `${escapeRegex(s)}`).join("|")
    //   const regex = new RegExp(`^(?!(${paths}))\/.*`)

    //   deepstreamConfig["storageExclusion"] = regex
    // } /* else persist everything (deepstream default behavior) */

    this.server = new Deepstream(deepstreamConfig);

    // this.logAdapter.on("error-msg", (logMessage) => {
    //   this.setState(State.ERROR, logMessage)
    // })
    this.server.on('started', () => {
      this.setState(State.OK, `Deepstream server listening on :${config.port}`);
    });
    this.server.on('stopped', () => {
      this.setState(State.INACTIVE, 'Deepstream server shut down');
    });

    this.server.start();

    this.channels = new ChannelsServer();
    this.channels.start({port: config.channelsPort || DEFAULT_CHANNELS_PORT});

    this.server.on('started', () => {
      this.ds = deepstream(`localhost:${config.port}`);
      this.ds.login({
        username: 'server-internal'
      });

      const iwMonitoring: IwMonitoring = this.server.getServices().monitoring as unknown as IwMonitoring;
      iwMonitoring.setClient(this.ds);

      const serverRecord = this.ds.record.getRecord('server/portConfig');
      serverRecord.whenReady(() => {
        serverRecord.set({
          port: config.port || DEFAULT_DEEPSTREAM_PORT,
          httpPort: config.httpPort || DEFAULT_HTTP_PORT,
          channelsPort: config.channelsPort || DEFAULT_CHANNELS_PORT
        });
      });
    });

    return Promise.resolve();
  }

  stop() {
    if (this.ds) {
      this.ds.close();
      this.ds = undefined;
    }
    this.server.stop();
    this.channels.stop();

    return Promise.resolve();
  }
}
