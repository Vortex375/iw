import * as logging from '../../lib/logging';
import { Component, IOC } from 'iw-ioc';
import { Service, State } from '../../lib/registry';
import { forEach, groupBy, keys, map, sortBy, zip } from 'lodash';

const log = logging.getLogger('IwApplication');

export interface ApplicationConfig {
  load?: string[];
  modules?: ModuleConfig[];
}

export interface ModuleConfig {
  component: string;
  name?: string;
  priority?: number;
  await?: string;
  config?: any;
}

interface ServiceAndModuleConfig {
  service: Service;
  moduleConfig: ModuleConfig;
}

@Component()
export class IwApplication extends Service {

  private readonly modules: ServiceAndModuleConfig[] = [];

  constructor() {
    super('iw-application');
  }

  async start(config: ApplicationConfig = {}): Promise<void> {
    forEach(config.load, module => this.load(module));
    forEach(config.modules, module => this.loadModule(module));

    this.setState(State.BUSY, 'starting services ...');
    const modulesByPriority = groupBy(this.modules, module => module.moduleConfig.priority ?? 0);
    const priorities = sortBy(keys(modulesByPriority), k => +k);
    let chain: Promise<any> = Promise.resolve();
    forEach(priorities, prio => {
      const modules = modulesByPriority[prio];
      chain = chain.then(() => Promise.all(map(modules, ({service, moduleConfig}) => service.start(moduleConfig.config))));
      forEach(modules, module => {
        if (module.moduleConfig.await) {
          chain = chain.then(() => new Promise(resolve => {
            module.service.once(module.moduleConfig.await, resolve);
          }));
        }
      });
    });
    await chain;
    this.setState(State.OK, 'all services started successfully.');
  }

  async stop(): Promise<void> {
    this.setState(State.BUSY, 'stopping services ...');
    await Promise.all(this.modules.map(module => module.service.stop()));
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
    this.modules.push({ service: component, moduleConfig });
    log.debug(`done loading ${moduleConfig.component}`);
  }
}