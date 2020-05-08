import { Service, State } from '../../lib/registry';
import { DeepstreamPlugin, DeepstreamServices, DeepstreamHTTPMeta, DeepstreamHTTPResponse } from '@deepstream/types';
import * as logging from '../../lib/logging';
import { registerPlugin } from '@deepstream/server/dist/src/config/config-initialiser';
import express from 'express';
import { Server } from 'http';


const appRoot = 'node_modules/iw-introspection';
const log = logging.getLogger('IntrospectionWebApp');

export const INTROSPECTION_WEB_APP_PLUGIN_NAME = 'introspection-web-app';

export interface IntrospectionWebAppConfig {
  port: number;
}

export class IntrospectionWebApp extends Service implements DeepstreamPlugin {
  readonly description = 'IW Introspection Web App';

  private server: Server;

  constructor(private config: IntrospectionWebAppConfig, private services: DeepstreamServices) {
    super(INTROSPECTION_WEB_APP_PLUGIN_NAME);
  }

  whenReady() {
    return this.start();
  }

  close() {
    return this.stop();
  }

  async start() {
    await new Promise<void>((resolve, reject) => {
      this.setState(State.BUSY);
      const app = express();
      app.use(express.static(appRoot));
      this.server = app.listen(this.config.port, err => err ? reject(err) : resolve());
    });
    this.setState(State.OK, `introspection web app listening on :${this.config.port}`);
  }

  async stop() {
    await new Promise<void>((resolve, reject) => {
      this.server.close( err => err ? reject(err) : resolve());
    });
    this.setState(State.INACTIVE);
  }
}

registerPlugin(INTROSPECTION_WEB_APP_PLUGIN_NAME, IntrospectionWebApp);
