/* Discover server by sending UDP broadcast */

import * as logging from "../../lib/logging"
import {Service, State, registerFactory} from "../../lib/registry"

import dgram = require("dgram")

const log = logging.getLogger("UdpDiscovery")

const BROADCAST_INTERVAL = 5000 /* broadcast every 5s */
const ERROR_RETRY_TIMEOUT = 10000
const BROADCAST_MESSAGE = Buffer.from("iw-discovery")
const ADVERTISEMENT_MESSAGE = "iw-advertisement"

export class UdpDiscovery extends Service {

  private socket: dgram.Socket
  private port: number
  private address: string
  private broadcastTimer: NodeJS.Timer

  constructor() {
    super("udp-discovery")
  }

  start(port: number, address: string = "255.255.255.255") {
    this.port = port
    this.address = address
    this.socket = dgram.createSocket("udp4")

    this.socket.on("error", (err) => {
      log.error({err: err}, "Socket error")
      this.setState(State.ERROR, "Socket error")

      this.stop()
      setTimeout(() => this.start(port, address), ERROR_RETRY_TIMEOUT)
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

    this.socket.bind(port + 1)
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
  }
}
