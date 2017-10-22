/* HTTP access to Deepstream
 *
 * Deepstream >= 3.0 now comes with this functionality built-in,
 * so this module is obsolete.
 */

import * as logging from "../../lib/logging"
import { Service, State } from "../../lib/registry"
import { DeepstreamClient } from "../deepstream-client"

import * as _ from "lodash"

import * as process from "process"
import * as http from "http"
import * as url from "url"

const log = logging.getLogger("HttpBridge")

const SERVICE_TYPE = "deepstream-http-bridge"

export interface DeepstreamHttpBridgeConfig {
  port: number
}

export class DeepstreamHttpBridge extends Service {

  private server: http.Server

  constructor(private readonly ds: DeepstreamClient) {
    super(SERVICE_TYPE)

    process.on("exit", () => this.stop())
  }

  start(config: DeepstreamHttpBridgeConfig) {
    if (this.server) {
      this.stop()
    }

    this.server = http.createServer((req, res) => {
      let chunks = []
      req.on("data", (chunk) => {
        chunks.push(chunk)
      })
      req.on("end", () => {
        const reqData = Buffer.concat(chunks)
        chunks = []
        let body
        try {
          body = JSON.parse(reqData.toString())
        } catch (err) {
          body = undefined
        }
        this.handleRequest(req, body, res)
      })
      req.on("error", (err) => {
        chunks = []
      })
    })

    this.server.on("listening", () => {
      this.setState(State.OK, `HTTP Server listening on port ${config.port}`)
    })
    this.server.on("error", (err) => {
      log.error({err: err}, "HTTP Server Error")
      this.setState(State.ERROR, "HTTP Server Error")
    })
    this.server.listen(config.port)

    return Promise.resolve()
  }

  stop() {
    if (this.server) {
      this.server.close()
      this.server = undefined
    }
    this.setState(State.INACTIVE, "HTTP Server closed")

    return Promise.resolve()
  }

  private handleRequest(req: http.IncomingMessage, body: any, res: http.ServerResponse) {
    const path = _(url.parse(req.url).pathname)
        .split("/")
        .reject(s => s === "")
        .value()
    log.debug({path: path, method: req.method}, "handling HTTP request")
    if (path.length == 0) {
      res.statusCode = 404
      return res.end("Use either /record or /rpc")
    }

    const name = path.slice(1).join("/")
    if (name === "") {
      res.statusCode = 404
      return res.end("Please specify record or rpc name")
    }

    switch (path[0]) {
      case "record":
        switch (req.method) {
          case "GET": { /* get contents of record */
            this.ds.getData(name)
            .then(data => {
              res.writeHead(200, {"Content-Type": "application/json"})
              res.end(JSON.stringify(data))
            })
            .catch(err => {
              res.statusCode = 500
              return res.end(err)
            })
            break
          }
          case "POST": { /* update record */
            const record = this.ds.getRecord(name)
            if (body) {
              _.forEach(body, (value: any, key: string) => {
                record.set(key, value)
              })
            }
            res.writeHead(200, {"Content-Type": "application/json"})
            record.whenReady(() => res.end(JSON.stringify(record.get())))
            break
          }
          case "PUT": { /* replace record */
            const record = this.ds.getRecord(name)
            if (body) {
              record.set(body)
            }
            res.writeHead(200, {"Content-Type": "application/json"})
            record.whenReady(() => res.end(JSON.stringify(record.get())))
            break
          }
        }
        break
      case "rpc":
        this.ds.makeRpc(name, body, (err, data) => {
          if (err) {
            res.statusCode = 500
            return res.end(err)
          }
          res.writeHead(200, {"Content-Type": "application/json"})
          res.end(JSON.stringify(data))
        })
        break
      default:
        res.statusCode = 404
        return res.end("Use either /record or /rpc")
    }
  }
}
