/*
  iw - Intelligent Wiring for Home Automation and other uses.
  Copyright (C) 2017-2020 Benjamin Schmitz

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

import minimist from 'minimist';
import { IOC } from 'iw-ioc';
import { IwApplication } from './modules/application';
import { readFileSync } from 'fs';
import { jsonc } from 'jsonc';

const argv = minimist(process.argv.slice(2));

if (argv.config) {
  const config = jsonc.parse(readFileSync(argv.config, 'utf8'));
  const app = IOC.get(IwApplication);
  process.once('SIGINT', async () => {
    process.on('SIGINT', () => process.exit(-20));
    await app.stop();
    process.nextTick(() => process.exit(0));
  });
  app.start(config);
} else {
  process.stdout.write('Please specify the startup configuration with the --config option.\n');
  process.exit(-1);
}
