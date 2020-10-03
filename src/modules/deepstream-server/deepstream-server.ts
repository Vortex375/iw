/* Deepstream Server */

import { Deepstream } from '@deepstream/server';
import { DeepstreamClient } from '@deepstream/client';
import _ from 'lodash';
import { Service, State, setIntrospectionRecord } from '../../lib/registry';
import { LOG_ADAPTER_PLUGIN_NAME } from './log-adapter';
import { CHANNELS_SERVER_PLUGIN_NAME } from './channels-server';
import { MONITORING_PLUGIN_NAME, IwMonitoring } from './monitoring';
import { PartialDeepstreamConfig } from '@deepstream/types';
import { NODE_ROOT } from './introspection';
import { WEB_SERVER_PLUGIN_NAME } from './web-server';
import { Component } from 'iw-ioc';

const SERVICE_TYPE = 'deepstream-server';
export const DEFAULT_DEEPSTREAM_PORT = 6020;
export const DEFAULT_WS_PATH = '/deepstream';
export const DEFAULT_HTTP_PATH = '/http';
export const DEFAULT_HTTP_PORT = 6080;
export const DEFAULT_CHANNELS_PORT = 6081;

const DEEPSTREAM_CONFIG: PartialDeepstreamConfig = {
  showLogo: false,
  logger: {
    name: LOG_ADAPTER_PLUGIN_NAME
  },
  monitoring: {
    name: MONITORING_PLUGIN_NAME
  },
  cache: {
    name: 'redis'
  },
  httpServer: {
    type: 'default',
    options: {
      healthCheckPath: '/health-check',
      port: DEFAULT_DEEPSTREAM_PORT,
      allowAllOrigins: true
    }
  },
  connectionEndpoints: [
    {
      type: 'ws-binary',
      options: {
        // urlPath: DEFAULT_WS_PATH
      }
    },
    {
      type: 'http',
      options: {
        authPath: DEFAULT_HTTP_PATH + '-auth',
        getPath: DEFAULT_HTTP_PATH,
        postPath: DEFAULT_HTTP_PATH
      }
    }
  ],
  plugins: {
    channelsServer: {
      name: CHANNELS_SERVER_PLUGIN_NAME,
      options: {
        port: DEFAULT_CHANNELS_PORT
      }
    },
    introspectionWebApp: {
      name: WEB_SERVER_PLUGIN_NAME,
      options: {
        port: DEFAULT_HTTP_PORT,
        apps: {
          '/': 'node_modules/iw-introspection'
        }
      }
    }
  },
  /* set less aggressive timeout values
   * to allow running on weak IoT hardware */
  rpc: {
    ackTimeout: 5000,
    responseTimeout: 60000
  },
  record: {
    cacheRetrievalTimeout: 5000,
    storageRetrievalTimeout: 10000
  },
  listen: {
    responseTimeout: 5000
  },
  dependencyInitializationTimeout: 20000
};

export interface DeepstreamServerConfig {
  port?: number;
  channelsPort?: number;
  persist?: boolean | [string];
}

@Component(SERVICE_TYPE)
export class DeepstreamServer extends Service {

  private server: Deepstream;
  private ds: DeepstreamClient;

  constructor() {
    super(SERVICE_TYPE);
  }

  start(config: DeepstreamServerConfig) {
    this.setState(State.BUSY, 'starting up ...');
    /* build configuration for the deepstream server*/
    const deepstreamConfig: PartialDeepstreamConfig = _.assign({}, DEEPSTREAM_CONFIG);
    if (config.port !== undefined) {
      deepstreamConfig.httpServer.options.port = config.port;
    }
    if (config.channelsPort !== undefined) {
      deepstreamConfig.plugins.channelsServer.options.port = config.channelsPort;
    }

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

    this.server.on('started', async () => {
      this.ds = new DeepstreamClient(`localhost:${config.port}`);
      await this.ds.login({
        username: 'server'
      });

      const iwMonitoring: IwMonitoring = this.server.getServices().monitoring as unknown as IwMonitoring;
      iwMonitoring.setClient(this.ds);

      const portConfigRecord = this.ds.record.getRecord('server/portConfig');
      portConfigRecord.whenReady(() => {
        portConfigRecord.set({
          port: config.port || DEFAULT_DEEPSTREAM_PORT,
          channelsPort: config.channelsPort || DEFAULT_CHANNELS_PORT
        });
      });
      const introspectionRecord = this.ds.record.getRecord(NODE_ROOT + 'server');
      introspectionRecord.whenReady(() => {
        setIntrospectionRecord(introspectionRecord);
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

    return Promise.resolve();
  }
}
