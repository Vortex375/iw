/* Respond to UDP discovery broadcasts */

import * as logging from "../../lib/logging"
import { Service, State } from "../../lib/registry"

import dgram = require("dgram")

const log = logging.getLogger("UdpAdvertisement")

const ERROR_RETRY_TIMEOUT = 10000
const RESPONSE_MESSAGE = Buffer.from("iw-advertisement")
const DISCOVERY_MESSAGE = "iw-discovery"

export interface UdpAdvertisementConfig {
  advertisedPort: number
  listenPort: number
  listenAddress?: string
  broadcastTo?: string
}

export class UdpAdvertisement extends Service {

  private socket: dgram.Socket
  private advertisedPort: number

  constructor() {
    super("udp-advertisement")
  }

  start(config: UdpAdvertisementConfig) {
    this.advertisedPort = config.advertisedPort
    const port = config.listenPort
    const address = config.listenAddress || "0.0.0.0"
    const broadcastTo = config.broadcastTo || "255.255.255.255"
    this.socket = dgram.createSocket("udp4")

    this.socket.on("error", (err) => {
      log.error({err: err}, "Socket error")
      this.setState(State.ERROR, "Socket error")

      this.stop()
      setTimeout(() => this.start(config), ERROR_RETRY_TIMEOUT)
    })

    this.socket.on("listening", () => {
      this.socket.setBroadcast(true)
      this.setState(State.OK, `Waiting for discovery messages on ${address}:${port}`)
      log.info(`sending advertisement once via broadcast to ${broadcastTo}:${port + 1}`)
      /* broadcast advertisement once */
      this.sendResponse({address: broadcastTo, port: port + 1, family: "udp4"})
    })

    this.socket.on("message", (msg: Buffer, rinfo: dgram.RemoteInfo) => {
      if (msg.toString() === DISCOVERY_MESSAGE) {
        log.debug({rinfo: rinfo}, `Got iw-discovery message from ${rinfo.address}:${rinfo.port}`)
        /* send unicast response message */
        this.sendResponse(rinfo)
      }
    })

    this.socket.bind(port, address)

    return Promise.resolve()
  }

  private sendResponse(rinfo: dgram.RemoteInfo) {
    const responseBuffer = Buffer.alloc(RESPONSE_MESSAGE.length + 2)
    RESPONSE_MESSAGE.copy(responseBuffer)
    responseBuffer.writeUInt16LE(this.advertisedPort, responseBuffer.length - 2)
    this.socket.send(responseBuffer, rinfo.port, rinfo.address)
  }

  stop() {
    if (this.socket) {
      this.socket.close()
      this.socket.removeAllListeners()
      this.socket.on("error", () => {/* ignore errors from closed socket */})
      this.socket = undefined
      this.setState(State.INACTIVE, `Advertisement stopped`)
    }

    return Promise.resolve()
  }
}
