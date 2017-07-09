/* iw Component Registry
 * Modules can register here to allow diagnostic introspection at runtime
 */

import * as logging from "./logging"

import * as _ from "lodash"
import colors = require("colors/safe")

import {EventEmitter} from "events"


const log = logging.getLogger("Registry")

export enum State {
  OK,       /* the module is ready for operation */
  BUSY,     /* the module is actively handling a request */
  INACTIVE, /* module was loaded but is currently inactive or unused */
  PROBLEM,  /* a (possibly recoverable) problem was detected, service may be (temporarily) inhibited */
  ERROR     /* a fatal error has occured and the module can not continue providing its service */
}
export const STATE_NAMES = [
  "ok",
  "busy",
  "inactive",
  "problem",
  "error"
]

/* base class for services */
export class Service extends EventEmitter {
  constructor(type: string, initialState: State = State.INACTIVE, name: string = "") {
    super()

    registerInstance(type, initialState, name, this)
  }

  shutdown() {
    deregisterInstance(this)
  }

  setState(state: State, message?: string) {
    const updates = {
      state: state
    }
    if (message) {
      updates["message"] = message
    }
    updateInstance(this, updates)
  }

  setMessage(message: string) {
    updateInstance(this, {message: message})
  }

  setErrorDiagnostic(errorDiagnostic: any) {
    updateInstance(this, {errorDiagnostic: errorDiagnostic})
  }
}

const FACTORIES: Map<String, Function> = new Map()

export function registerFactory(type: string, factory: Function): void {
  FACTORIES.set(type, factory)
}

export function getInstanceOfType(type: string, ...args: any[]): any {
  const factory = FACTORIES.get(type)

  if (factory === undefined) {
    return undefined
  }

  return factory.apply(undefined, args)
}

/*
 * registry internal
 */

const STATE_COLORS = {
  [State.OK]: colors.green,
  [State.BUSY]: colors.magenta,
  [State.INACTIVE]: colors.grey,
  [State.PROBLEM]: colors.yellow,
  [State.ERROR]: colors.red
}

interface ServiceObject {
  index: number,
  type: string,
  name: string,
  instance: Service,
  state: State,
  message: string,
  errorDiagnostic: any
}

const INSTANCES_BY_TYPE: Map<string, ServiceObject[]> = new Map()
const INSTANCES: Map<Service, ServiceObject> = new Map()
let serviceIndex = 0

function registerInstance(type: string, state: State, name: string, instance: Service) {
  if ( ! INSTANCES_BY_TYPE.has(type)) {
    INSTANCES_BY_TYPE.set(type, [])
  }

  const serviceObject = {
    index: serviceIndex++,
    type: type,
    name: name,
    instance: instance,
    state: state,
    message: "Initial State",
    errorDiagnostic: undefined,
  }

  INSTANCES_BY_TYPE.get(type).push(serviceObject)
  INSTANCES.set(instance, serviceObject)

  log.debug({serviceType: type, name: name}, `registered a new instance ${name} of ${type}`)
}

function deregisterInstance(instance: Service) {
  const serviceObject = INSTANCES.get(instance)
  if (serviceObject !== undefined) {
    INSTANCES.delete(instance)
    _.pull(INSTANCES_BY_TYPE.get(serviceObject.type), serviceObject)
  }
}

function updateInstance(instance: Service, updates: any) {
  const serviceObject = INSTANCES.get(instance)

  /* print log message about state change */
  if (updates["state"] !== undefined) {
    let logLevel = "info"
    switch (updates["state"]) {
      case State.PROBLEM:
        logLevel = "warn"
        break
      case State.ERROR:
        logLevel = "error"
        break
    }
    log[logLevel](
      {
        sub: `${serviceObject.type}${serviceObject.name ? ` (${serviceObject.name})` : ""}`,
        oldState: STATE_NAMES[serviceObject.state],
        newState: STATE_NAMES[updates["state"]]
      },
      "%s -> %s: %s",
      STATE_COLORS[serviceObject.state](STATE_NAMES[serviceObject.state]),
      STATE_COLORS[updates["state"]](STATE_NAMES[updates["state"]]),
      updates["message"] || "")
  }

  _.assign(serviceObject, updates)
}
