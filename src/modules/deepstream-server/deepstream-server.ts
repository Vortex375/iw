/* Deepstream Server */

import * as logging from "../../lib/logging"
import {Service, State, registerFactory} from "../../lib/registry"

import * as _ from "lodash"
import escapeRegex = require("escape-string-regexp")
import Deepstream = require("deepstream.io")

import {EventEmitter} from "events"


const log = logging.getLogger("Deepstream")
const serverLog = logging.getLogger("Deepstream", "Server")

const SERVICE_TYPE = "deepstream-server"

/* adapter to plug deepstream's logging into our logging */
class LogAdapter extends EventEmitter {
  readonly isReady = true /* required by deepstream's dependency loading mechanism */
  private readonly server

  constructor(server) {
    super()
    this.server = server
  }

  log(logLevel, event, logMessage) {
    switch (logLevel) {
      case this.server.constants.LOG_LEVEL.DEBUG:
          serverLog.debug({event: event}, event + " " + logMessage)
          break
      case this.server.constants.LOG_LEVEL.INFO:
          serverLog.info({event: event}, event + " " + logMessage)
          break
      case this.server.constants.LOG_LEVEL.WARN:
          serverLog.warn({event: event}, event + " " + logMessage)
          break
      case this.server.constants.LOG_LEVEL.ERROR:
          serverLog.error({event: event}, event + " " + logMessage)
          /* indicate that the server has thrown an error
           * as it doesn't seem to emit 'error' events */
          this.emit("error-msg", logMessage)
          break
      /* else ignore message (LOG_LEVEL.OFF) */
    }
  }
}

export interface DeepstreamConfig {
  port: number,
  persist?: boolean | [string]
}

export class DeepstreamServer extends Service {

  private readonly config: DeepstreamConfig
  private server
  private logAdapter: LogAdapter
  private port: number

  constructor(config: DeepstreamConfig) {
    super(SERVICE_TYPE)
    this.config = config
  }

  start() {
    this.setState(State.BUSY, "starting up ...")
    /* build configuration for the deepstream server*/
    const deepstreamConfig = {}
    deepstreamConfig["showLogo"] = false
    deepstreamConfig["connectionEndpoints"] = {
      websocket: {
        name: "uws",
        options: {
          port: this.config.port
        }
      }
    }

    if (this.config.persist === undefined || this.config.persist === false) {
      /* exclude everything from storage */
      deepstreamConfig["storageExclusion"] = /.*/
    } else if (this.config.persist !== true && this.config.persist.length > 0) {
      /* create regular expression that matches everything except paths listed in config.persist */
      const paths = _(this.config.persist).map((s) => `${escapeRegex(s)}`).join("|")
      const regex = new RegExp(`^(?!(${paths}))\/*.`)

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
  }

  stop() {
    this.server.stop()
  }
}

registerFactory(SERVICE_TYPE, (config: DeepstreamConfig) => new DeepstreamServer(config))
