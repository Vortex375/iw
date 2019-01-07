/* Deepstream Server */

import * as logging from "../../lib/logging"
import { Service, State } from "../../lib/registry"
import * as _ from "lodash"
import escapeRegex = require("escape-string-regexp")
import Deepstream = require("deepstream.io")
import * as deepstreamClient from "deepstream.io-client-js"
import { EventEmitter } from "events"
import { ChannelsServer } from "./channels-server"

const log = logging.getLogger("Deepstream")
const serverLog = logging.getLogger("Deepstream", "Server")

const SERVICE_TYPE = "deepstream-server"
export const DEFAULT_DEEPSTREAM_PORT = 6020
export const DEFAULT_HTTP_PORT = 6080
export const DEFAULT_CHANNELS_PORT = 6081

const DEEPSTREAM_CONFIG = {
  showLogo: false,
  connectionEndpoints: {
    websocket: {
      name: "ws",
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
  },
  /* less aggressive timeout values */
  rpcAckTimeout: 5000,
  rpcTimeout: 60000,
  cacheRetrievalTimeout: 5000,
  storageRetrievalTimeout: 10000,
  dependencyInitialisationTimeout: 20000
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

export interface DeepstreamServerConfig {
  port?: number,
  httpPort?: number,
  channelsPort?: number,
  persist?: boolean | [string]
  plugins?: any
}

export class DeepstreamServer extends Service {

  private server
  private ds: deepstreamIO.Client
  private channels: ChannelsServer
  private logAdapter: LogAdapter
  private port: number

  constructor() {
    super(SERVICE_TYPE)
  }

  start(config: DeepstreamServerConfig) {
    this.setState(State.BUSY, "starting up ...")
    /* build configuration for the deepstream server*/
    const deepstreamConfig = _.assign({}, DEEPSTREAM_CONFIG)
    if (config.port !== undefined) {
      deepstreamConfig.connectionEndpoints.websocket.options.port = config.port
    }
    if (config.httpPort !== undefined) {
      deepstreamConfig.connectionEndpoints.http.options.port = config.port
    }

    deepstreamConfig["plugins"] = config.plugins

    if (config.persist === undefined || config.persist === false) {
      /* exclude everything from storage */
      deepstreamConfig["storageExclusion"] = /.*/
    } else if (config.persist !== true && config.persist.length > 0) {
      /* create regular expression that matches everything except paths listed in config.persist */
      const paths = _(config.persist).map((s) => `${escapeRegex(s)}`).join("|")
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
      this.setState(State.OK, `Deepstream server listening on :${config.port}`)
    })
    this.server.on("stopped", () => {
      this.setState(State.INACTIVE, "Deepstream server shut down")
    })

    this.server.start()

    this.channels = new ChannelsServer()
    this.channels.start({port: config.channelsPort || DEFAULT_CHANNELS_PORT})

    this.server.on("started", () => {
      this.ds = deepstreamClient(`localhost:${config.port}`)
      this.ds.login({
        username: "server-internal"
      })
      const serverRecord = this.ds.record.getRecord("server/portConfig")
      serverRecord.whenReady(() => {
        serverRecord.set({
          port: config.port || DEFAULT_DEEPSTREAM_PORT,
          httpPort: config.httpPort || DEFAULT_HTTP_PORT,
          channelsPort: config.channelsPort || DEFAULT_CHANNELS_PORT
        })
      })
    })

    return Promise.resolve()
  }

  stop() {
    if (this.ds) {
      this.ds.close()
      this.ds = undefined
    }
    this.server.stop()
    this.channels.stop()

    return Promise.resolve()
  }
}
