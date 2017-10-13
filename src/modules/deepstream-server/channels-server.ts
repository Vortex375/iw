import {Service, State} from "../../lib/registry"
import * as logging from "../../lib/logging"
import WebSocket = require("uws")
import http = require("http")
import url = require("url")
import * as _ from "lodash"

const log = logging.getLogger("Channels")

const SERVICE_TYPE = "channels-server"

export class ChannelsServer extends Service {
  private wss: WebSocket.Server
  private channels: Map<string, WebSocket[]> = new Map()

  constructor() {
    super(SERVICE_TYPE)
  }

  start(port: number) {
    if (this.wss) {
      this.stop()
    }

    this.wss = new WebSocket.Server({port: port})
    this.setState(State.BUSY)

    this.wss.on("error", e => {
      this.setState(State.ERROR, "wss error")
      this.setErrorDiagnostic(e)
    })
    this.wss.on("listening", () => {
      this.setState(State.OK, `Channels server listening on :${port}`)
    })
    this.wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
      const requestUrl = url.parse(req.url)
      this.addClient(ws, requestUrl.pathname)
    })
  }

  stop() {
    this.wss.close()
    this.wss = undefined
    this.setState(State.INACTIVE, "Channels server shut down")
  }

  private addClient(ws: WebSocket, path: string) {
    if ( ! this.channels.has(path)) {
      this.channels.set(path, [])
    }
    this.channels.get(path).push(ws)
    ws.on("error", e => {
      log.error({err: e}, "websocket error")
    })
    ws.on("close", (code, reason) => {
      log.debug({code: code}, "client disconnected")
      _.pull(this.channels.get(path), ws)
    })
    ws.on("message", (data) => {
      const others = _.reject(this.channels.get(path), other => other == ws)
      _.forEach(others, other => other.send(data))
    })
  }
}
