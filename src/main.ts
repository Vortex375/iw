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

import {DeepstreamServer} from "./modules/deepstream-server"
import {DeepstreamClient} from "./modules/deepstream-client"
import {UdpDiscovery} from "./modules/udp-discovery"
import {UdpAdvertisement} from "./modules/udp-advertisement"

import minimist = require("minimist")

const argv = minimist(process.argv.slice(2))

if (argv["server"]) {
  const server = new DeepstreamServer({port: 6020})
  server.start()

  const advertisement = new UdpAdvertisement(6020)
  advertisement.start(6021, "0.0.0.0", "127.0.0.1")

} else if (argv["client"]) {
  const client = new DeepstreamClient("test")

  const discovery = new UdpDiscovery()

  client.on("connected", () => discovery.pause())
  client.on("disconnected", () => discovery.resume())
  discovery.on("discovered", (addr) => {
    discovery.pause()
    client.connect(`${addr.address}:${addr.port}`)
  })

  discovery.start(6021, "127.0.0.1")
}
