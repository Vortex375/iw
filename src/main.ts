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

import { DeepstreamServer } from './modules/deepstream-server';
import { DeepstreamClient } from './modules/deepstream-client';
import { UdpDiscovery } from './modules/udp-discovery';
import { UdpAdvertisement } from './modules/udp-advertisement';
import minimist from 'minimist';

import fuckthis, { Client } from '@deepstream/client';
import { Options } from '@deepstream/client/dist/client-options';
import { Record } from '@deepstream/client/dist/record/record';
const deepstream: (url: string, options?: Partial<Options>) => Client = fuckthis as any;

const argv = minimist(process.argv.slice(2));

/* this "startup script" is for testing only */

if (argv.server) {
  const server = new DeepstreamServer();
  server.start({
    port: 6020,
    persist: ['light-control'],
    plugins: {
      // storage: {
      //   name: "mongodb",
      //   options: {
      //     connectionString: "mongodb://localhost:27017/iw-deepstream"
      //   }
      // }
      // cache: {
      //   name: "redis",
      //   options: {
      //     host: "localhost",
      //     port: 6379
      //   }
      // }
    }
  });

  const advertisement = new UdpAdvertisement();
  advertisement.start({ requestPort: 6031 });

//  const mongodb = new MongoDBQueryProvider(client)
//  mongodb.connect("mongodb://localhost:27017/iw-db")

} else if (argv.client) {
  const client = new DeepstreamClient();
  const discovery = new UdpDiscovery(client);

  discovery.start({ requestPort: 6031 });
} else if (argv.test) {
  (async () => {
    const client = deepstream('localhost:6020');
    await client.login({ username: 'test' });
    client.record.listen('test', async (match, response) => {
      const record = client.record.getRecord(match);
      await record.whenReady();
      record.set({foo: 'bar'})
      response.accept();
    });
    const record = client.record.getRecord('test');
    record.subscribe(undefined, (data) => console.log(data));
  })();
}
