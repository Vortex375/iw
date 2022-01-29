import { Service, State } from '../../lib/registry';
import * as logging from '../../lib/logging';
import express from 'express';
import { Server } from 'http';
import _ from 'lodash';
import { Component, Scoped } from 'iw-ioc';
import vhost from 'vhost';

const log = logging.getLogger('WebServer');

const SERVICE_NAME = 'web-server';

export interface WebServerConfig {
  port: number;
  host: string;
  app?: string | express.Router;
  apps?: { [virtualHost: string]: string | express.Router };
}

@Component(SERVICE_NAME)
@Scoped()
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

      if (config.app) {
        log.debug({ app: config.app }, 'configuring web app');
        if (typeof config.app === 'string') {
          app.use(express.static(config.app));
          app.use((req, res) => res.sendStatus(404));
        } else {
          app.use(config.app);
        }
      } else if (config.apps) {
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
      } else {
        this.setState(State.ERROR, 'no web applications configured');
      }

      this.server = app.listen(config.port, resolve);
      this.server.on('error', (err) => {
        log.error(err, 'http server failed');
        this.setState(State.ERROR, `http server failed: ${err.name} ${err.message}`);
      });
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
