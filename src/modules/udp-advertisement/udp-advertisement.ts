/* Respond to UDP discovery broadcasts */

import * as logging from "../../lib/logging"
import {Service, State, registerFactory} from "../../lib/registry"

import dgram = require("dgram")

const log = logging.getLogger("UdpAdvertisement")

const ERROR_RETRY_TIMEOUT = 10000
const RESPONSE_MESSAGE = Buffer.from("iw-advertisement")
const DISCOVERY_MESSAGE = "iw-discovery"

export class UdpAdvertisement extends Service {

  private socket: dgram.Socket

  constructor(private advertisedPort: number) {
    super("udp-advertisement")
  }

  start(port: number, address = "0.0.0.0", broadcastTo = "255.255.255.255") {
    this.socket = dgram.createSocket("udp4")

    this.socket.on("error", (err) => {
      log.error({err: err}, "Socket error")
      this.setState(State.ERROR, "Socket error")

      this.stop()
      setTimeout(() => this.start(port, address), ERROR_RETRY_TIMEOUT)
    })

    this.socket.on("listening", () => {
      this.socket.setBroadcast(true)
      this.setState(State.OK, `Waiting for discovery messages on ${address}:${port}`)
      log.info(`sending advertisement once via broadcast to ${broadcastTo}:${port}`)
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
  }

  private sendResponse(rinfo: dgram.RemoteInfo) {
    const responseBuffer = Buffer.alloc(RESPONSE_MESSAGE.length + 2)
    RESPONSE_MESSAGE.copy(responseBuffer)
    responseBuffer.writeUInt16LE(this.advertisedPort, responseBuffer.length - 2)
    this.socket.send(responseBuffer, rinfo.port, rinfo.address)
  }

  stop() {
    this.socket.close()
    this.socket.removeAllListeners()
    this.socket.on("error", () => {/* ignore errors from closed socket */})
    this.socket = undefined
    this.setState(State.INACTIVE, `Advertisement stopped`)
  }
}
