import { Service, State } from '../../lib/registry';
import * as logging from '../../lib/logging';
import express from 'express';
import { Server } from 'http';
import _ from 'lodash';
import { Component } from 'iw-ioc';
import vhost from 'vhost';

const log = logging.getLogger('WebServer');

const SERVICE_NAME = 'web-server';

export interface WebServerConfig {
  port: number;
  host: string;
  apps: { [virtualHost: string]: string | express.Router };
}

@Component(SERVICE_NAME)
export class WebServer extends Service {

  private server: Server;
  private config: WebServerConfig;

  constructor() {
    super(SERVICE_NAME);
  }

  async start(config: WebServerConfig) {
    this.config = config;
    await new Promise<void>((resolve, reject) => {
      this.setState(State.BUSY, 'setting up...');
      const app = express();

      log.debug(config.apps, 'configuring web apps');
      _.forEach(config.apps, (webApp, virtualHost) => {
        if (typeof webApp === 'string') {
          const appRouter = express.Router();
          appRouter.use(express.static(webApp));
          appRouter.use((req, res) => res.sendStatus(404));
          app.use(vhost(`${virtualHost}.${config.host}`, appRouter));
        } else {
          app.use(vhost(`${virtualHost}.${config.host}`, webApp));
        }
      });
      app.use(this.welcomePage.bind(this));

      this.server = app.listen(config.port, err => err ? reject(err) : resolve());
    });
    this.setState(State.OK, `web app server listening on :${config.port}`);
  }

  async stop() {
    await new Promise<void>((resolve, reject) => {
      this.server.close(err => err ? reject(err) : resolve());
    });
    this.setState(State.INACTIVE);
  }

  private welcomePage(req: express.Request, res: express.Response) {
    const webAppLinks = _.map(this.config.apps, (webApp, virtualHost) =>
        `<li><a href="http://${virtualHost}.${this.config.host}:${this.config.port}">${virtualHost}</a></li>`);
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
