/* Discover server by sending UDP broadcast */

import * as logging from "../../lib/logging"
import { Service, State } from "../../lib/registry"
import { DeepstreamClient, DeepstreamClientConfig } from "../deepstream-client"

import * as _ from "lodash"
import dgram = require("dgram")

const log = logging.getLogger("UdpDiscovery")

const BROADCAST_INTERVAL = 5000 /* broadcast every 5s */
const ERROR_RETRY_TIMEOUT = 10000
const BROADCAST_MESSAGE = Buffer.from("iw-discovery")
const ADVERTISEMENT_MESSAGE = "iw-advertisement"

export interface UdpDiscoveryConfig {
  port: number,
  listenPort?: number,
  address?: string,
  clientConfig?: DeepstreamClientConfig
}

export class UdpDiscovery extends Service {

  private socket: dgram.Socket
  private port: number
  private listenPort: number
  private address: string
  private broadcastTimer: NodeJS.Timer

  private clientConfig: DeepstreamClientConfig

  constructor(private client?: DeepstreamClient) {
    super("udp-discovery")

    if (this.client) {
      client.on("connected", () => this.pause())
      client.on("disconnected", () => this.resume())
      this.on("discovered", (addr) => {
        this.pause()
        const clientConfig = _.assign(this.clientConfig || {}, {
          server: addr.address,
          port: addr.port
        })
        client.start(clientConfig)
      })
    }
  }

  start(config: UdpDiscoveryConfig) {
    this.port = config.port
    this.listenPort = config.listenPort || config.port + 1
    this.address = config.address || "255.255.255.255"
    this.socket = dgram.createSocket("udp4")
    this.clientConfig = config.clientConfig

    this.socket.on("error", (err) => {
      log.error({err: err}, "Socket error")
      this.setState(State.ERROR, "Socket error")

      this.stop()
      setTimeout(() => this.start(config), ERROR_RETRY_TIMEOUT)
    })

    this.socket.on("listening", () => {
      this.socket.setBroadcast(true)
      this.resume()
    })

    this.socket.on("message", (msg: Buffer, rinfo: dgram.RemoteInfo) => {
      if (msg.toString().startsWith(ADVERTISEMENT_MESSAGE)) {
        log.debug({rinfo: rinfo}, `Got iw-advertisement message from ${rinfo.address}:${rinfo.port}`)
        this.parseResponse(msg, rinfo)
      }
    })

    this.socket.bind(this.listenPort)

    return Promise.resolve()
  }

  private doBroadcast() {
    this.socket.send(BROADCAST_MESSAGE, this.port, this.address)
  }

  private parseResponse(msg: Buffer, rinfo: dgram.RemoteInfo) {
    const port = msg.readUInt16LE(16)
    log.info({address: rinfo.address, port: port}, "discovered service")
    this.emit("discovered", {address: rinfo.address, port: port})
  }

  pause() {
    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer)
      this.broadcastTimer = undefined
    }
    this.setState(State.INACTIVE, `Discovery suspended`)
  }

  resume() {
    if (this.broadcastTimer) {
      return
    }
    this.broadcastTimer = setInterval(() => this.doBroadcast(), BROADCAST_INTERVAL)
    this.setState(State.OK, `Discovering server via UDP broadcast to ${this.address}:${this.port}`)
    this.doBroadcast()
  }

  stop() {
    this.pause()
    this.socket.close()
    this.socket.removeAllListeners()
    this.socket.on("error", () => {/* ignore errors from closed socket */})
    this.socket = undefined
    this.setState(State.INACTIVE, `Discovery stopped`)

    return Promise.resolve()
  }
}
