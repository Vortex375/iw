import { Service, State } from "../../lib/registry"
import * as logging from "../../lib/logging"
import WebSocket = require("uws")
import http = require("http")
import url = require("url")
import * as _ from "lodash"

const log = logging.getLogger("Channels")

const SERVICE_TYPE = "channels-server"

export interface ChannelsServerConfig {
  port: number
}

export class ChannelsServer extends Service {
  private wss: WebSocket.Server
  private channels: Map<string, WebSocket[]> = new Map()

  constructor() {
    super(SERVICE_TYPE)
  }

  start(config: ChannelsServerConfig) {
    if (this.wss) {
      this.stop()
    }

    this.wss = new WebSocket.Server({port: config.port})
    this.setState(State.BUSY)

    this.wss.on("error", e => {
      this.setState(State.ERROR, "wss error")
      this.setErrorDiagnostic(e)
    })
    this.wss.on("listening", () => {
      this.setState(State.OK, `Channels server listening on :${config.port}`)
    })
    this.wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
      /* compatibiliy with ws < 3 */
      const request = req || ws.upgradeReq
      log.debug({ws: ws, req: request}, "incoming connection")
      const requestUrl = url.parse(request.url)
      this.addClient(ws, requestUrl.pathname)
    })

    return Promise.resolve()
  }

  stop() {
    this.wss.close()
    this.wss = undefined
    this.setState(State.INACTIVE, "Channels server shut down")

    return Promise.resolve()
  }

  private addClient(ws: WebSocket, path: string) {
    log.debug({channel: path}, "adding client")
    if ( ! this.channels.has(path)) {
      this.channels.set(path, [])
    }
    this.channels.get(path).push(ws)
    ws.on("error", e => {
      log.error({err: e}, "websocket error")
    })
    ws.on("close", (code, reason) => {
      log.debug({code: code, channel: path}, "client disconnected: %s", reason)
      _.pull(this.channels.get(path), ws)
      ws.removeAllListeners()
    })
    ws.on("message", (data) => {
      /* broadcast to all other sockets on the same channel */
      _.forEach(this.channels.get(path), (other: WebSocket) => {
        if (other !== ws && other.readyState == WebSocket.OPEN) {
          other.send(data)
        }
      })
    })
  }
}
