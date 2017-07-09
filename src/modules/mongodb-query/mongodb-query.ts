/* MongoDB Query RPC Provider */

import * as logging from "../../lib/logging"
import {Service, State, registerFactory} from "../../lib/registry"
import {DeepstreamClient, RpcCallback} from "../deepstream-client"

import * as _ from "lodash"
import {MongoClient, Db, Collection} from "mongodb"

import * as process from "process"

const log = logging.getLogger("MongodbQuery")

const SERVICE_TYPE = "mongodb-query"
const RPC_NAME = "mongodb-query"

export class MongoDBQuery {
  collection: string
  query: any
}

export class MongoDBQueryProvider extends Service {

  private db: Db
  private readonly rpcCallback: RpcCallback

  constructor(private readonly ds: DeepstreamClient) {
    super(SERVICE_TYPE)
    this.rpcCallback = this.handleRpc.bind(this)

    process.on("exit", () => this.disconnect())
  }

  connect(url: string) {
    this.setState(State.BUSY, `connecting to ${url}`)
    new MongoClient().connect(url)
    .then(db => {
      this.db = db
      this.setState(State.OK, "connected to MongoDB")

      this.ds.provideRpc(RPC_NAME, this.rpcCallback)
    })
    .catch(err => {
      log.error({err: err}, "connection failed")
      this.setErrorDiagnostic(err)
      this.setState(State.ERROR, "connection failed")
    })
  }

  private disconnect() {
    if (this.db) {
      this.db.close()
      this.db = undefined

      this.ds.unprovideRpc(RPC_NAME)
    }
  }

  private handleRpc(query: MongoDBQuery, response: deepstreamIO.RPCResponse) {
    log.debug({query: query}, "handling query")
    if (query === undefined) {
      return response.error("specify a query")
    }
    const collection = this.db.collection(query.collection)
    const cursor = collection.find(query.query)
    cursor.toArray()
    .then(data => {
      log.debug("query complete, sending response")
      response.send(data)
    })
    .catch(err => {
      log.error({err: err}, "query failed")
      response.error(err.message)
    })
  }
}
