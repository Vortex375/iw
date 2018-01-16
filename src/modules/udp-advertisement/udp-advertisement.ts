/* Respond to UDP discovery broadcasts */

import * as logging from "../../lib/logging"
import { Service, State } from "../../lib/registry"

import dgram = require("dgram")

const log = logging.getLogger("UdpAdvertisement")

const ERROR_RETRY_TIMEOUT = 10000
const RESPONSE_MESSAGE = Buffer.from("iw-advertisement")
const DISCOVERY_MESSAGE = "iw-discovery"

export interface UdpAdvertisementConfig {
  /** Port that is advertised, i.e. the port Deepstream runs on */
  advertisedPort: number
  /** The port where to listen for incoming discovery requests. */
  requestPort: number
  /** The address where to listen for incoming discovery requests.
   * @default "0.0.0.0" */
  requestAddress?: string
  /** The port where to send advertisement broadcasts.
   * @default requestPort + 1 */
  broadcastPort?: number,
  /** The broadcast address for advertisement broadcasts.
   * @default "255.255.255.255" */
  broadcastAddress?: string
}

export class UdpAdvertisement extends Service {

  private socket: dgram.Socket
  private advertisedPort: number

  constructor() {
    super("udp-advertisement")
  }

  start(config: UdpAdvertisementConfig) {
    this.advertisedPort = config.advertisedPort
    const requestPort = config.requestPort
    const requestAddress = config.requestAddress || "0.0.0.0"
    const broadcastPort = config.broadcastPort || requestPort + 1
    const broadcastAddress = config.broadcastAddress || "255.255.255.255"
    this.socket = dgram.createSocket("udp4")

    this.socket.on("error", (err) => {
      log.error({err: err}, "Socket error")
      this.setState(State.ERROR, "Socket error")

      this.stop()
      setTimeout(() => this.start(config), ERROR_RETRY_TIMEOUT)
    })

    this.socket.on("listening", () => {
      this.socket.setBroadcast(true)
      this.setState(State.OK, `Waiting for discovery messages on ${requestAddress}:${requestPort}`)
      log.info(`sending advertisement once via broadcast to ${broadcastAddress}:${broadcastPort}`)
      /* broadcast advertisement once */
      this.sendResponse({address: broadcastAddress, port: broadcastPort, family: "udp4"})
    })

    this.socket.on("message", (msg: Buffer, rinfo: dgram.RemoteInfo) => {
      if (msg.toString() === DISCOVERY_MESSAGE) {
        log.debug({rinfo: rinfo}, `Got iw-discovery message from ${rinfo.address}:${rinfo.port}`)
        /* send unicast response message */
        this.sendResponse(rinfo)
      }
    })

    this.socket.bind(requestPort, requestAddress)

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
