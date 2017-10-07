/*
  iw - Intelligent Wiring for Home Automation and other uses.
  Copyright (C) 2017 Benjamin Schmitz

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

import {DeepstreamClient} from "./modules/deepstream-client"
import {UdpDiscovery} from "./modules/udp-discovery"

import minimist = require("minimist")
import readline = require("readline")

const argv = minimist(process.argv.slice(2))

/* this "startup script" is for testing only */

const RECORD_PATH = "light-control/zone/0"

const client = new DeepstreamClient("test")
const discovery = new UdpDiscovery()

process.stdin.setEncoding("utf8")
const rl = readline.createInterface({
  input: process.stdin
})

client.on("connected", () => discovery.pause())
client.on("disconnected", () => discovery.resume())
discovery.on("discovered", (addr) => {
  discovery.pause()
  client.connect(`${addr.address}:${addr.port}`)
})

discovery.start(6021)

client.on("connected", () => {
  const record = client.getRecord(RECORD_PATH)
  record.set("brightness", undefined)

  rl.on("line", (line) => {
    if (line === "") {
      rl.close()
      client.disconnect()
      process.exit(0)
    }

    const split = line.split(",")
    record.set("value", {
      r: parseInt(split[0]),
      g: parseInt(split[1]),
      b: parseInt(split[2])
    })
  })
  rl.on("close", () => {
    client.disconnect()
    process.exit(0)
  })
})
