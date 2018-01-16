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
  /** The port where to send discovery requests. */
  requestPort: number
  /** The address where to send discovery requests.
   * @default "255.255.255.255" */
  requestAddress?: string
  /** The port where to listen for advertisement broadcasts.
   * @default requestPort + 1 */
  broadcastPort?: number,
  broadcastAddress?: string
  /** Configuration used when automatically starting the deepstream client.
   * Only relevant when passing a client to the constructor.
   * @default {} */
  clientConfig?: any
}

export class UdpDiscovery extends Service {

  private socket: dgram.Socket
  private requestPort: number
  private requestAddress: string
  private broadcastPort: number
  private requestTimer: NodeJS.Timer

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
    this.requestPort = config.requestPort
    this.broadcastPort = config.broadcastPort || config.requestPort + 1
    this.requestAddress = config.requestAddress || "255.255.255.255"
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

    this.socket.bind(this.broadcastPort)

    return Promise.resolve()
  }

  private doBroadcast() {
    this.socket.send(BROADCAST_MESSAGE, this.requestPort, this.requestAddress)
  }

  private parseResponse(msg: Buffer, rinfo: dgram.RemoteInfo) {
    const port = msg.readUInt16LE(16)
    log.info({address: rinfo.address, port: port}, "discovered service")
    this.emit("discovered", {address: rinfo.address, port: port})
  }

  pause() {
    if (this.requestTimer) {
      clearInterval(this.requestTimer)
      this.requestTimer = undefined
    }
    this.setState(State.INACTIVE, `Discovery suspended`)
  }

  resume() {
    if (this.requestTimer) {
      return
    }
    this.requestTimer = setInterval(() => this.doBroadcast(), BROADCAST_INTERVAL)
    this.setState(State.OK, `Discovering server via UDP broadcast to ${this.requestAddress}:${this.requestPort}`)
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
