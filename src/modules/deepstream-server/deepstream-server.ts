/* Deepstream Server */

import * as logging from "../../lib/logging"
import {Service, State, registerFactory} from "../../lib/registry"
import * as _ from "lodash"
import escapeRegex = require("escape-string-regexp")
import Deepstream = require("deepstream.io")
import {EventEmitter} from "events"
import {ChannelsServer} from "./channels-server"

const log = logging.getLogger("Deepstream")
const serverLog = logging.getLogger("Deepstream", "Server")

const SERVICE_TYPE = "deepstream-server"
const DEFAULT_DEEPSTREAM_PORT = 6020
const DEFAULT_HTTP_PORT = 6080
const DEFAULT_CHANNELS_PORT = 6081

const DEEPSTREAM_CONFIG = {
  showLogo: false,
  connectionEndpoints: {
    websocket: {
      name: "uws",
      options: {
        port: DEFAULT_DEEPSTREAM_PORT /* set in the start() method */
      }
    },
    http: {
      name: "http",
      options: {
        port: DEFAULT_HTTP_PORT /* set in the start() method */
      }
    }
  }
}

/* adapter to plug deepstream's logging into our logging */
class LogAdapter extends EventEmitter {
  readonly isReady = true /* required by deepstream's dependency loading mechanism */
  private readonly server

  constructor(server) {
    super()
    this.server = server
  }

  debug(event, logMessage) {
    this.log(this.server.constants.LOG_LEVEL.DEBUG, event, logMessage)
  }

  info(event, logMessage) {
    this.log(this.server.constants.LOG_LEVEL.INFO, event, logMessage)
  }

  warn(event, logMessage) {
    this.log(this.server.constants.LOG_LEVEL.WARN, event, logMessage)
  }

  error(event, logMessage) {
    this.log(this.server.constants.LOG_LEVEL.ERROR, event, logMessage)
  }

  log(logLevel, event, logMessage) {
    switch (logLevel) {
      case this.server.constants.LOG_LEVEL.DEBUG:
          serverLog.debug(event + " " + logMessage)
          break
      case this.server.constants.LOG_LEVEL.INFO:
          serverLog.info(event + " " + logMessage)
          break
      case this.server.constants.LOG_LEVEL.WARN:
          serverLog.warn(event + " " + logMessage)
          break
      case this.server.constants.LOG_LEVEL.ERROR:
          serverLog.error(event + " " + logMessage)
          /* indicate that the server has thrown an error
           * as it doesn't seem to emit 'error' events */
          this.emit("error-msg", logMessage)
          break
      /* else ignore message (LOG_LEVEL.OFF) */
    }
  }
}

export interface DeepstreamConfig {
  port?: number,
  httpPort?: number,
  channelsPort?: number,
  persist?: boolean | [string]
  plugins?: any
}

export class DeepstreamServer extends Service {

  private readonly config: DeepstreamConfig
  private server
  private channels: ChannelsServer
  private logAdapter: LogAdapter
  private port: number

  constructor(config: DeepstreamConfig) {
    super(SERVICE_TYPE)
    this.config = config
  }

  start() {
    this.setState(State.BUSY, "starting up ...")
    /* build configuration for the deepstream server*/
    const deepstreamConfig = _.assign({}, DEEPSTREAM_CONFIG)
    if (this.config.port !== undefined) {
      deepstreamConfig.connectionEndpoints.websocket.options.port = this.config.port
    }
    if (this.config.httpPort !== undefined) {
      deepstreamConfig.connectionEndpoints.http.options.port = this.config.port
    }

    deepstreamConfig["plugins"] = this.config.plugins

    if (this.config.persist === undefined || this.config.persist === false) {
      /* exclude everything from storage */
      deepstreamConfig["storageExclusion"] = /.*/
    } else if (this.config.persist !== true && this.config.persist.length > 0) {
      /* create regular expression that matches everything except paths listed in config.persist */
      const paths = _(this.config.persist).map((s) => `${escapeRegex(s)}`).join("|")
      const regex = new RegExp(`^(?!(${paths}))\/.*`)

      deepstreamConfig["storageExclusion"] = regex
    } /* else persist everything (deepstream default behavior) */

    this.server = new Deepstream(deepstreamConfig)
    this.logAdapter = new LogAdapter(this.server)
    this.server.set("logger", this.logAdapter)

    this.logAdapter.on("error-msg", (logMessage) => {
      this.setState(State.ERROR, logMessage)
    })
    this.server.on("started", () => {
      this.setState(State.OK, `Deepstream server listening on :${this.config.port}`)
    })
    this.server.on("stopped", () => {
      this.setState(State.INACTIVE, "Deepstream server shut down")
    })

    this.server.start()

    this.channels = new ChannelsServer()
    this.channels.start(this.config.channelsPort || DEFAULT_CHANNELS_PORT)
  }

  stop() {
    this.server.stop()
    this.channels.stop()
  }
}

registerFactory(SERVICE_TYPE, (config: DeepstreamConfig) => new DeepstreamServer(config))
