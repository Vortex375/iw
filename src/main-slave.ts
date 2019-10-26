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

import { DeepstreamClient } from './modules/deepstream-client';
import { UdpDiscovery } from './modules/udp-discovery';

/* this "startup script" is for testing only */

const RECORD_PATH  = 'light-control/zone/0';
const CHANNEL_PATH = 'light-control/zone/0';

const client = new DeepstreamClient();
const discovery = new UdpDiscovery(client);

discovery.start({
  requestPort: 6030,
  broadcastPort: 6032
});

const channel = client.openChannel(CHANNEL_PATH);
channel.on('open', () => {
  readStdinData();
});

client.on('connected', () => {
  const record = client.getRecord(RECORD_PATH);
  record.set('channel', CHANNEL_PATH as any);
});

let size = -1;
let length = 0;
let buf;
let minichunk;
function readStdinData() {
  process.stdin.on('data', (chunk: Buffer) => {
    /* this avoids the (probably rare) edge case
     * that we expect to read the 2-byte size field next
     * but we receive only 1 byte */
    if (size <= 0 && chunk.byteLength < 2) {
      minichunk = chunk;
      return;
    }
    if (minichunk) {
      chunk = Buffer.concat([minichunk, chunk]);
      minichunk = undefined;
    }
    handleChunk(chunk);
  });
  process.stdin.on('end', () => {
    channel.close();
    client.stop();
  });
}

function handleChunk(chunk: Buffer) {
  let sourceOffset = 0;
  if (size <= 0) {
    size = chunk.readUInt16LE(0);
    length = 0;
    sourceOffset += 2;
    buf = Buffer.alloc(size);
  }
  const missing = size - length;
  const toCopy = Math.min(chunk.length, missing);
  chunk.copy(buf, length, sourceOffset, toCopy);
  length += toCopy;
  if (length === size) {
    channel.send(buf);
    buf = undefined;
    size = -1;
    length = 0;
    if (missing < chunk.length) {
      const nextChunk = Buffer.alloc(chunk.length - missing);
      chunk.copy(nextChunk, 0, missing);
      if (nextChunk.byteLength >= 2) {
        handleChunk(nextChunk);
      } else {
        minichunk = nextChunk;
      }
    }
  }
}
