/* Deploys static configuration from a config file
 * and makes it available on Deepstream.
 *
 * Intended as a way to bootstrap, distribute and save
 * the node configuration.
 */

import * as logging from '../../lib/logging';
import { Service } from '../../lib/registry';
import { IwDeepstreamClient } from '../deepstream-client';

import * as _ from 'lodash';

const log = logging.getLogger('StaticConfigProvider');

const SERVICE_TYPE = 'static-config-provider';

export interface StaticConfiguration {
  templates: {
    [key: string]: any
  };
  nodes: {
    [key: string]: StaticNodeConfiguration
  };
}

export interface StaticNodeConfiguration {
  extends?: string | string[];
  modules: {
    [key: string]: StaticModuleConfiguration
  };
}

export interface StaticModuleConfiguration {
  extends?: string | string [];
  plugin: string;
  module?: string;
  config: any;
}

export class StaticConfigProvider extends Service {

   constructor(private readonly ds: IwDeepstreamClient) {
     super(SERVICE_TYPE);
   }

   start(config: StaticConfiguration) {

     return Promise.resolve();

   }

   stop() {
     return Promise.resolve();
   }

   reconfigure(config: StaticConfiguration) {
     this.start(config);
     return Promise.resolve(true);
   }
 }
