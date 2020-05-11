import { Service, State } from '../../lib/registry';
import { DeepstreamPlugin, DeepstreamServices } from '@deepstream/types';
import * as logging from '../../lib/logging';
import { registerPlugin } from '@deepstream/server/dist/src/config/config-initialiser';
import express from 'express';
import { Server } from 'http';
import _ from 'lodash';

const log = logging.getLogger('WebServer');

export const WEB_SERVER_PLUGIN_NAME = 'web-server';

export interface WebServerConfig {
  port: number;
  apps: { [path: string]: string | express.Router };
}

export class WebServer extends Service implements DeepstreamPlugin {
  readonly description = 'IW Web Apps';

  private server: Server;

  constructor(private config: WebServerConfig, private services: DeepstreamServices) {
    super(WEB_SERVER_PLUGIN_NAME);
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

      _.forEach(this.config.apps, (webApp, path) => {
        if (typeof webApp === 'string') {
          app.use(path, express.static(webApp));
          app.use(path, (req, res) => res.sendStatus(404));
        } else {
          app.use(path, webApp);
        }
      });
      app.use('/', this.welcomePage.bind(this));

      this.server = app.listen(this.config.port, err => err ? reject(err) : resolve());
    });
    this.setState(State.OK, `web app server listening on :${this.config.port}`);
  }

  async stop() {
    await new Promise<void>((resolve, reject) => {
      this.server.close( err => err ? reject(err) : resolve());
    });
    this.setState(State.INACTIVE);
  }

  private welcomePage(req: express.Request, res: express.Response) {
    const webAppLinks = _.map(this.config.apps, (webApp, path) => `<li><a href="${path}">${path}</a></li>`);
    res.header('Content-Type', 'text/html');
    res.send(`
      <html>
        <head>
          <title>IW Web Apps</title>
        </head>
        <body>
          <ul>${webAppLinks}</ul>
        </body>
      </html>
    `);
  }
}

registerPlugin(WEB_SERVER_PLUGIN_NAME, WebServer);
