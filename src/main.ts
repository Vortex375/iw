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
import {MongoDBQueryProvider} from "./modules/mongodb-query"
import {DeepstreamHttpBridge} from "./modules/deepstream-http-bridge"

import minimist = require("minimist")

const argv = minimist(process.argv.slice(2))

/* this "startup script" is for testing only */

if (argv["server"]) {
  const server = new DeepstreamServer({
    port: 6020,
    persist: ["light-control"],
/*plugins: {
      storage: {
        name: "mongodb",
        options: {
          connectionString: "mongodb://localhost:27017/iw-deepstream"
        }
      }
    }*/
  })
  server.start()

  const advertisement = new UdpAdvertisement(6020)
  advertisement.start(6021)

  const client = new DeepstreamClient("server")
  client.connect("localhost:6020")

//  const mongodb = new MongoDBQueryProvider(client)
//  mongodb.connect("mongodb://localhost:27017/iw-db")

} else if (argv["client"]) {
  const client = new DeepstreamClient("test")
  const discovery = new UdpDiscovery()

  client.on("connected", () => discovery.pause())
  client.on("disconnected", () => discovery.resume())
  discovery.on("discovered", (addr) => {
    discovery.pause()
    client.connect(`${addr.address}:${addr.port}`)
  })

  discovery.start(6021)
}
