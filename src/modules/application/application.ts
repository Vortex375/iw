import * as logging from '../../lib/logging';
import { Component, IOC } from 'iw-ioc';
import { Service, State } from '../../lib/registry';
import { forEach, map, zip } from 'lodash';

const log = logging.getLogger('IwApplication');

export interface ApplicationConfig {
  load?: string[];
  modules?: ModuleConfig[];
}

export interface ModuleConfig {
  component: string;
  name?: string;
  config?: any;
}

@Component()
export class IwApplication extends Service {

  private readonly modules: Service[] = [];

  constructor() {
    super('iw-application');
  }

  async start(config: ApplicationConfig = {}): Promise<void> {
    forEach(config.load, module => this.load(module));
    forEach(config.modules, module => this.loadModule(module));

    this.setState(State.BUSY, 'starting services ...');
    await Promise.all(map(zip(this.modules, config.modules), ([module, moduleConfig]) => module.start(moduleConfig.config)));
    this.setState(State.OK, 'all services started successfully.');
  }

  async stop(): Promise<void> {
    this.setState(State.BUSY, 'stopping services ...');
    await Promise.all(this.modules.map(module => module.stop()));
    this.modules.length = 0;
    this.setState(State.INACTIVE, 'all services stopped successfully.');
  }

  load(module: string) {
    require.main.require(module);
  }

  loadModule(moduleConfig: ModuleConfig) {
    log.debug(moduleConfig, `loading module ${moduleConfig.component}`);
    const container = IOC.getRootContainer().createScope();
    const component = IOC.get(moduleConfig.component, container);
    if ( ! (component instanceof Service)) {
      throw new Error(`Expected ${moduleConfig.component} to be a Service but it was ${component}`);
    }
    component.setServiceName(moduleConfig.name);
    this.modules.push(component);
    log.debug(`done loading ${moduleConfig.component}`);
  }
}