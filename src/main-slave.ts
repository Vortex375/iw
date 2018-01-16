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

import { DeepstreamClient } from "./modules/deepstream-client"
import { UdpDiscovery } from "./modules/udp-discovery"

import minimist = require("minimist")
import fs = require("fs")

const argv = minimist(process.argv.slice(2))

/* this "startup script" is for testing only */

const CHANNEL_PATH = "light-control/zone/0"

const client = new DeepstreamClient()
const discovery = new UdpDiscovery(client)

discovery.start({
  requestPort: 6030,
  broadcastPort: 6032
})

client.on("connected", () => {
  const channel = client.openChannel(CHANNEL_PATH)
  
  channel.on("open", () => {
    channel.send(Buffer.from([0xFF, 0xFF, 0xFF]))
  })
})
