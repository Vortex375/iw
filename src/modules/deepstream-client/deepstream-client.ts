/* Deepstream Client */

import * as logging from "../../lib/logging"
import {Service, State, registerFactory} from "../../lib/registry"

import * as _ from "lodash"
import * as deepstream from "deepstream.io-client-js"

import * as process from "process"

const log = logging.getLogger("DeepstreamClient")

const SERVICE_TYPE = "deepstream-client"
const RECONNECT_TIMEOUT = 30000 /*attempt to reconnect after 30 seconds */

interface Subscription  {
  record: deepstreamIO.Record | undefined
  subscriptions: [string | undefined, (data: any) => void][]
}

export interface DataProvider {
  provide(record: deepstreamIO.Record, recordName: string)
  stop(record: deepstreamIO.Record, recordName: string)
}

export class DeepstreamClient extends Service {

  private ds: deepstreamIO.Client | undefined
  private readonly dataProviders: Map<String, DataProvider[]> = new Map()
  private readonly rpcProviders: Map<String, Function[]> = new Map()
  private readonly subscriptions: Map<String, Subscription> = new Map()

  private url: string
  private setupComplete: boolean = false
  private reconnectTimer: NodeJS.Timer | undefined

  constructor(private readonly friendlyName: string = "unknown") {
    super(SERVICE_TYPE)

    process.on("exit", () => this.disconnect())
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
    this.ds = deepstream(url)

    this.ds.on("error", (msg, event, topic) => {
      log.error({event: event, topic: topic}, `${event}: ${msg}`)
    })

    this.ds.on("connectionStateChanged", (state) => {
      log.info({state: state}, "Connection state changed")
      switch (state) {
        case "OPEN":
          this.setState(State.OK, `connected to server at ${this.url}`)
          this.afterConnect()
          break
        case "CLOSED":
          this.setState(State.INACTIVE, "connection closed")
          break
        case "ERROR":
          this.setState(State.ERROR, "connection interrupted")
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

    this.ds.login()
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
    }
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
    // TODO
  }

  private registerOnDeviceList(firstTry = true) {
    log.info `Registering on device-list as devices/${this.getClientName()}`
    const deviceList = this.getList("device-list")
    if (firstTry) {
      deviceList.on("error", (err, msg) => {
        log.warn({err: err}, `Registration attempt failed: ${msg}`)
        this.registerOnDeviceList(false)
      })
    }
    deviceList.removeEntry("devices/" + this.getClientName())
    deviceList.addEntry("devices/" + this.getClientName())
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
        reject(err)
      })

      record.whenReady(() => process.nextTick( () => {
        const data = record.get()
        record.off()
        resolve(data)
      }))
    })
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

  getClientName(): string {
    return this.friendlyName + "-" + this.getUid()
  }

  /* this is the getUid() function copied from deepstream
   * so it can be called without having a client instance */
  getUid(): string {
    const timestamp = (new Date()).getTime().toString(36)
    const randomString = (Math.random() * 10000000000000000).toString(36).replace( ".", "" )

    return timestamp + "-" + randomString
  }
}
