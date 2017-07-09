"use strict"

/*
 * Logging
 *
 * Provides logging facilities using the bunyan framework.
 * Generates beautiful, colored console output and also keeps log records in memory.
 */

/// <reference types="node" />

import bunyan   = require("bunyan")
import process  = require("process")
import util     = require("util")
import _        = require("lodash")
import colors   = require("colors/safe")
import minimist = require("minimist")

const argv = minimist((process.argv.slice(2)))

const BUNYAN_CORE_FIELDS = ["v", "level", "name", "hostname", "pid", "time", "msg", "src", "tag", "sub"]
const colorForLevel = {
    "10": colors.grey,
    "20": colors.yellow,
    "30": colors.blue,
    "40": (s) => colors.bold(colors.yellow(s)),
    "50": (s) => colors.bold(colors.red(s)),
    "60": (s) => colors.inverse(colors.bold(colors.red(s)))
}

class DefaultPrettyPrintStream {
    write(rec) {
      let stack = undefined
      if (rec.err && rec.err.stack && typeof rec.err.stack === "string") {
        stack = rec.err.stack
        rec.err = _.omit(rec.err, "stack")
      }
      const args = _(rec)
          .pick(_(rec).keys().reject(key => _.includes(BUNYAN_CORE_FIELDS, key)).value())
          .map((value, key) => util.format("%s=%j", key, value))
          .join(", ")

      process.stdout.write(util.format(
          "[%s]\t%s%s: \"%s\" %s\n",
          // TODO: <any> cast required here because type is broken
          colorForLevel[rec.level]((<any> bunyan).nameFromLevel[rec.level]),
          colors.bold(colors.cyan(rec.tag || "MAIN")),
          rec.sub ? "/" + colors.cyan(rec.sub) : "",
          rec.msg,
          colors.grey("(" + args + ")")
      ))
      if (stack) {
        process.stdout.write(`${colors.inverse(colors.bold(colors.red(("stack"))))} `)
        process.stdout.write(stack)
        process.stdout.write("\n")
      }
  }
}

const ringbuffer = new bunyan.RingBuffer({limit: 500})

const streams: bunyan.Stream[] = [{
    stream: ringbuffer,
    level: "trace",
    type: "raw"
  }
]

if (!argv["silent"]) {
  streams.push({
    stream: new DefaultPrettyPrintStream(),
    level: argv["log-level"] || "debug",
    type: "raw"
  })
}

if (argv["log"]) {
  streams.push({
    path: argv["log"]
  })
}

export const rootLogger = bunyan.createLogger({
  name: "datacollection",
  serializers: bunyan.stdSerializers,
  streams: streams
})

export function getLogger(tag: string, sub?: string): bunyan {
  return rootLogger.child({tag: tag, sub: sub})
}
