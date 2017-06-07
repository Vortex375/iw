"use strict"

//TODO: remove and replace with .ts version

/*
 * Logging
 *
 * Provide logging facilities using the bunyan framework.
 * Generates beautiful, colored console output and also keeps log records in memory.
 */

var bunyan  = require("bunyan"),
    process = require("process"),
    util    = require("util"),
    _       = require("lodash"),
    colors  = require("colors/safe"),
    argv    = require('minimist')(process.argv.slice(2))

const BUNYAN_CORE_FIELDS = ['v', 'level', 'name', 'hostname', 'pid', 'time', 'msg', 'src', 'tag', 'sub']
const colorForLevel = {
    '10': colors.grey,
    '20': colors.yellow,
    '30': colors.blue,
    '40': (s) => colors.bold(colors.yellow(s)),
    '50': (s) => colors.bold(colors.red(s)),
    '60': (s) => colors.inverse(colors.bold(colors.red(s)))
}

class DefaultPrettyPrintStream {
    write(rec) {
      let args = _(rec)
          .pick(_(rec).keys().reject(key => _.includes(BUNYAN_CORE_FIELDS, key)).value())
          .map((value, key) => util.format("%s=%j", key, value))
          .join(", ")

      process.stdout.write(util.format(
          "[%s]\t%s%s: \"%s\" %s\n",

          colorForLevel[rec.level](bunyan.nameFromLevel[rec.level]),
          colors.bold(colors.cyan(rec.tag || "MAIN")),
          rec.sub ? "/" + colors.cyan(rec.sub) : "",
          rec.msg,
          colors.grey("(" + args + ")")
      ))
  }
}

var ringbuffer = new bunyan.RingBuffer({limit: 500})

var streams = [{
    stream: ringbuffer,
    level: 'trace',
    type: 'raw'
  }
]

if (!argv["silent"]) {
  streams.push({
    stream: new DefaultPrettyPrintStream(),
    level: argv['log-level'] || 'debug',
    type: 'raw'
  })
}

if (argv["log"]) {
  streams.push({
    path: argv["log"]
  })
}

var rootLogger = bunyan.createLogger({
  name: 'datacollection',
  serializers: bunyan.stdSerializers,
  streams: streams
})

module.exports = {
    rootLogger: rootLogger,
    ringbuffer: ringbuffer,
    getLogger: (tag, sub) => rootLogger.child({tag: tag, sub: sub})
}
