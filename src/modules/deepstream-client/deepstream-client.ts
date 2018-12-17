/* Deepstream Client */

/// <reference types="deepstream.io-client-js" />

import * as logging from "../../lib/logging"
import { Service, State } from "../../lib/registry"

import * as _ from "lodash"
import * as deepstream from "deepstream.io-client-js"
import WebSocket = require("ws")

import * as process from "process"
import { EventEmitter } from "events"

const log = logging.getLogger("DeepstreamClient")

const SERVICE_TYPE = "deepstream-client"
const RECONNECT_TIMEOUT = 30000 /*attempt to reconnect after 30 seconds */
const DEEPSTREAM_CONFIG = {
  transports: ["websocket"]
}

interface Subscription  {
  record: deepstreamIO.Record | deepstreamIO.List | undefined
  isList: boolean,
  subscriptions: [string | undefined, (data: any) => void][]
}

interface ChannelSubscription {
  socket: WebSocket
  proxies: ChannelProxy[]
}

interface PortConfig {
  port: number,
  httpPort: number,
  channelsPort: number
}

export interface DataProvider {
  provide(record: deepstreamIO.Record, recordName: string)
  stop(record: deepstreamIO.Record, recordName: string)
}

export interface Channel {
  send(msg : string|Buffer|ArrayBuffer|Buffer[]) : void
  close() : void
  isOpen() : boolean
  on(event: "message", handler : {(msg : string|Buffer|ArrayBuffer|Buffer[]) : any}) : void
  on(event: "open" | "close", handler: {() : any})
  removeListener(event: "message" | "open" | "close", handler: any) : void
  removeAllListeners() : void
}

export type RpcCallback = (data: any, response: deepstreamIO.RPCResponse) => void

export interface DeepstreamClientConfig {
  server: string,
  port: number,
  friendlyName?: string
}

export class DeepstreamClient extends Service {

  private ds: deepstreamIO.Client | undefined

  private readonly dataProviders: Map<string, DataProvider[]> = new Map()
  private readonly rpcProviders: Map<string, RpcCallback> = new Map()
  private readonly subscriptions: Map<string, Subscription> = new Map()
  private readonly channelSubscriptions: Map<string, ChannelSubscription> = new Map()

  private url: string
  private friendlyName: string
  private server: string /* hostname/ip of server */
  private portConfig: PortConfig

  private setupComplete: boolean = false
  private reconnectTimer: NodeJS.Timer | undefined

  constructor() {
    super(SERVICE_TYPE)

    process.on("exit", () => this.disconnect())
  }

  start(config: DeepstreamClientConfig) {
    this.friendlyName = config.friendlyName || "unknown"
    this.server = config.server
    this.connect(`${config.server}:${config.port}`)

    return Promise.resolve()
  }

  stop() {
    this.disconnect()

    return Promise.resolve()
  }

  reconfigure(config: DeepstreamClientConfig) {
    this.start(config)

    return Promise.resolve(true)
  }

  connect(url: string) {
    this.stopReconnect()

    /* close active connection */
    if (this.ds) {
      this.disconnect()
    }

    this.url = url

    /* connect and log in anonymously */
    log.info({url: url}, `Connecting to ${url}`)
    this.ds = deepstream(url, DEEPSTREAM_CONFIG)

    this.ds.on("error", (msg, event, topic) => {
      log.error({event: event, topic: topic}, `${event}: ${msg}`)
    })

    this.ds.on("connectionStateChanged", (state) => {
      log.debug({state: state}, "Connection state changed")
      switch (state) {
        case "OPEN":
          this.setState(State.OK, `connected to server at ${this.url}`)
          this.stopReconnect()
          this.afterConnect()
          break
        case "CLOSED":
          this.setState(State.INACTIVE, "connection closed")
          this.emit("disconnected")
          break
        case "ERROR":
          this.setState(State.ERROR, "connection interrupted")
          this.emit("disconnected")
          this.reconnect()
          break
        case "RECONNECTING":
          this.setState(State.PROBLEM, "reconnecting ...")
          break
        case "AWAITING_AUTHENTICATION":
          this.setState(State.BUSY, `connecting to server at ${this.url}`)
          break
        case "AUTHENTICATING":
          this.setState(State.BUSY, "logging in ...")
          break
      }
    })

    this.ds.login({
      username: this.getClientName()
    })
  }

  disconnect() {
    this.stopReconnect()

    this.url = undefined
    this.setupComplete = false

    if (this.ds) {
      this.ds.close()
      this.ds.off()
      this.ds.on("error", () => {/* squelch errors from old connection */})
      this.ds = undefined
      for (const [recordName, sub] of this.subscriptions) {
        /* remove record handles from old connection */
        sub.record = undefined
      }
      for (const [channel, sub] of this.channelSubscriptions) {
        if (sub.socket) {
          sub.socket.close()
        }
      }
    }
    this.setState(State.INACTIVE, "disconnected")
  }

  reconnect() {
    if ( ! this.ds || this.reconnectTimer) {
      /* no connection or reconnect already in progress */
      return
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.connect(this.url)
    }, RECONNECT_TIMEOUT)
  }

  stopReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
  }

  private afterConnect() {
    if (this.setupComplete) {
      this.emit("connected")
      return
    }

    /* restore subscriptions */
    for (const [recordName, sub] of this.subscriptions) {
      /* get record handle */
      const record = this.ds.record.getRecord(recordName)
      sub.record = record
      for (const [path, callback] of sub.subscriptions) {
        this.startSubscribe(record, callback, path, false)
      }
    }

    /* restore data providers */
    for (const [pattern, providers] of this.dataProviders) {
      this.startListen(pattern)
    }

    /* restore rpc providers */
    for (const [name, callback] of this.rpcProviders) {
      this.ds.rpc.provide(name, callback)
    }

    /* get port configuration for channels */
    this.getData("server/portConfig").then(portConfig => {
      this.portConfig = portConfig
      this.afterPortConfig()
    })
  }

  /* called from afterConnect() after port config is available
   * to perform setup tasks that require port config */
  private afterPortConfig() {
    /* restore Channel connections */
    for (const [path, sub] of this.channelSubscriptions) {
      if ( ! sub.socket) {
        this.connectChannel(path, sub)
      }
    }

    this.setupComplete = true
    this.emit("connected")
  }

  getRecord(name: string): deepstreamIO.Record {
    return this.ds.record.getRecord(name)
  }

  getList(name: string): deepstreamIO.List {
    return this.ds.record.getList(name)
  }

  getData(recordName: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if ( ! this.ds) {
        return reject("not connected")
      }

      const record = this.getRecord(recordName)

      record.on("error", (err, msg) => {
        log.error({err: err, message: msg}, `failed to get data for record ${recordName}`)
        record.off()
        // record.discard()
        reject(err)
      })

      record.whenReady(() => process.nextTick(() => {
        const data = record.get()
        record.off()
        // record.discard()
        resolve(data)
      }))
    })
  }

  makeRpc(name: string, data: any, callback: (error: string, result?: any) => void) {
    if ( ! this.ds) {
      return process.nextTick(() => callback("not connected"))
    }
    this.ds.rpc.make(name, data, callback)
  }

  provideData(pattern: string, provider: DataProvider) {
    if ( ! this.dataProviders.has(pattern)) {
      this.dataProviders.set(pattern, [])
      if (this.setupComplete) {
        this.startListen(pattern)
      }
    }

    this.dataProviders.get(pattern).push(provider)
  }

  private startListen(pattern: string) {
    this.ds.record.listen(pattern, (match, isSubscribed, response) => {
      const record = this.ds.record.getRecord(match)
      const providers = this.dataProviders.get(pattern)

      if (isSubscribed) {
        if (providers === undefined || providers.length == 0) {
          return response.reject()
        }
        for (const provider of providers) {
          provider.provide(record, match)
        }
        response.accept()
      } else {
        for (const provider of providers) {
          provider.stop(record, match)
        }
        record.discard()
      }
    })
  }

  unprovideData(pattern: string, provider: DataProvider) {
    const remainingProviders = _.pull(this.dataProviders.get(pattern), provider)

    if (remainingProviders.length == 0) {
      if (this.setupComplete) {
        this.ds.record.unlisten(pattern)
      }
      this.dataProviders.delete(pattern)
    }
  }

  openChannel(path: string) : Channel {
    log.debug({channel: path}, `adding subscription for channel ${path}`)

    let sub = this.channelSubscriptions.get(path)
    if (sub === undefined) {
      sub = {
        socket: undefined,
        proxies: []
      }
      this.channelSubscriptions.set(path, sub)
    }
    const proxy = new ChannelProxy(sub)
    sub.proxies.push(proxy)

    if (sub.socket === undefined && this.setupComplete) {
      this.connectChannel(path, sub)
    }
    
    proxy.on("_internalClose", () => {
      log.debug({channel: path}, `removing subscription for channel ${path}`)
      _.remove(sub.proxies, (p) => p === proxy)
      if (sub.proxies.length == 0) {
        log.debug({channel: path}, `no more subscribers for channel ${path}`)
        this.channelSubscriptions.delete(path)
        if (sub.socket) {
          log.debug({channel: path}, `closing channel ${path}`)
          sub.socket.close()
        }
      }
    })
    proxy.on("_internalSendMessage", (msg) => {
      if (sub.socket) {
        sub.socket.send(msg)
      } else {
        log.warn({channel: path}, `message sent to channel ${path} while channel was not connected; message lost`)
      }
    })

    return proxy
  }

  private connectChannel(path: string, sub: ChannelSubscription): void {
    if (sub.proxies.length == 0) {
      /* no longer interested */
      return
    }
    if (sub.socket !== undefined) {
      /* already connected */
      return
    }
    
    log.debug({channel: path, addr: this.server, port: this.portConfig.channelsPort}, `connecting socket for channel ${path}`)
    let socket = new WebSocket(`ws://${this.server}:${this.portConfig.channelsPort}/${path || ""}`)
    socket.on("error", (err) => {
      log.error({err: err, channel: path}, `error on channel ${path}`)
    })
    socket.on("open", () => {
      sub.socket = socket
      log.debug({channel: path}, `successfully opened channel ${path}`)
      for (const proxy of sub.proxies) {
        proxy.emit("open")
      }
    })
    socket.on("close", (code, reason) => {
      sub.socket = undefined
      if (sub.proxies.length > 0) {
        log.debug({channel: path, code: code, reason: reason}, `channel ${path} closed unexpectedly; reconnecting ...`)
        setTimeout(() => this.connectChannel(path, sub), RECONNECT_TIMEOUT)
        for (const proxy of sub.proxies) {
          proxy.emit("close")
        }
      } else if (this.setupComplete) {
        log.debug({channel: path, code: code, reason: reason}, `channel ${path} closed`)
      }
    })
    socket.on("message", (msg) => {
      for (const proxy of sub.proxies) {
        proxy.emit("message", msg)
      }
    })
  }

  subscribe(recordName: string, callback: (data: any) => void,
      path: string = undefined, now: boolean = true) {
    this.createSubscription(false, recordName, callback, path, now)
  }

  subscribeList(recordName: string, callback: (data: any) => void, now: boolean = true) {
    this.createSubscription(true, recordName, callback, undefined, now)
  }

  private createSubscription(isList: boolean, recordName: string,
      callback: (data: any) => void, path: string, now: boolean) {
    let sub = this.subscriptions.get(recordName)
    if (sub === undefined) {
      sub = {
        record: undefined,
        isList: isList,
        subscriptions: []
      }
      this.subscriptions.set(recordName, sub)
    }
    sub.subscriptions.push([path, callback])

    if (this.setupComplete) {
      const record = isList ? this.ds.record.getList(recordName) : this.ds.record.getRecord(recordName)
      sub.record = record
      this.startSubscribe(record, callback, path, now)
    }
  }

  private startSubscribe(record: deepstreamIO.Record | deepstreamIO.List,
      callback: (data: any) => void, path: string, now: boolean) {
    if (path) {
      (<deepstreamIO.Record> record).subscribe(path, callback, now)
    } else {
      (<deepstreamIO.Record> record).subscribe(callback, now)
    }
  }

  unsubscribe(recordName: string, callback: (data: any) => void) {
    /* remove callback from list of subscribers */
    const sub = this.subscriptions.get(recordName)
    if ( ! sub) {
      return
    }
    _.remove(sub.subscriptions, (sub) => sub[1] === callback)
    const record = sub.record
    if (record) {
      (<deepstreamIO.Record> record).unsubscribe(callback)
    }
    if (sub.subscriptions.length == 0) {
      this.subscriptions.delete(recordName)
      if (record) {
        record.discard()
      }
    }
  }

  provideRpc(name: string, callback: RpcCallback) {
    this.rpcProviders.set(name, callback)

    if (this.setupComplete) {
      this.ds.rpc.provide(name, callback)
    }
  }

  unprovideRpc(name: string) {
    this.rpcProviders.delete(name)

    if (this.setupComplete) {
      this.ds.rpc.unprovide(name)
    }
  }

  getClientName(): string {
    return this.friendlyName + "-" + DeepstreamClient.getUid()
  }

  /* this is the getUid() function copied from deepstream
   * so it can be called without having a client instance */
  static getUid(): string {
    const timestamp = (new Date()).getTime().toString(36)
    const randomString = (Math.random() * 10000000000000000).toString(36).replace( ".", "" )

    return timestamp + "-" + randomString
  }
}

class ChannelProxy extends EventEmitter implements Channel {

  constructor(private subscription: ChannelSubscription) {
    super()
  }

  send(msg) {
    this.emit("_internalSendMessage", msg)
  }

  close() {
    this.emit("_internalClose")
  }

  isOpen() {
    return this.subscription.socket !== undefined
  }
}