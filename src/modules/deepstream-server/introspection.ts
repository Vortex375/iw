import { DeepstreamClient } from '@deepstream/client';
import _ from 'lodash';
import * as path_ from 'path';
import { RpcSchema } from '../deepstream-client/deepstream-client';
import * as logging from '../../lib/logging';
import { Component } from 'iw-ioc';

export const INTROSPECTION_ROOT = 'iw-introspection/';
export const NODE_ROOT = INTROSPECTION_ROOT + 'nodes/';
export const RECORD_ROOT = INTROSPECTION_ROOT + 'records/';
export const RPC_ROOT = INTROSPECTION_ROOT + 'rpcs/';
export const CHANNEL_ROOT = INTROSPECTION_ROOT + 'channels/';
export const INDEX_RECORD = '.iw-index';

const log = logging.getLogger('Introspection');

@Component()
export class Introspection {

  private readonly records: Map<string, any> = new Map();
  private readonly deletedPaths: Set<string> = new Set();
  private client: DeepstreamClient;

  setClient(client: DeepstreamClient) {
    this.client = client;
    if (client !== undefined) {
      this.restore();
    }
  }

  registerRecord(recordName: string, schema?: any, dynamic = false) {
    const record = {
      name: recordName,
      schema,
      dynamic
    };
    const path = path_.posix.join(RECORD_ROOT, recordName);
    this.create(path, record);
  }

  unregisterRecord(recordName: string) {
    const path = path_.posix.join(RECORD_ROOT, recordName);
    this.rm(path);
  }

  registerRpc(rpcName: string, schema?: RpcSchema) {
    const record = {
      name: rpcName,
      schema
    };
    const path = path_.posix.join(RPC_ROOT, rpcName);
    this.create(path, record);
  }

  unregisterRpc(rpcName: string) {
    const path = path_.posix.join(RPC_ROOT, rpcName);
    this.rm(path);
  }

  registerChannel(channelName: string) {
    const record = {
      name: channelName
    };
    const path = path_.posix.join(CHANNEL_ROOT, channelName);
    this.create(path, record);
  }

  unregisterChannel(channelName: string) {
    const path = path_.posix.join(CHANNEL_ROOT, channelName);
    this.rm(path);
  }

  clear() {
    this.rmRecursive(NODE_ROOT);
    this.rmRecursive(RECORD_ROOT);
    this.rmRecursive(RPC_ROOT);
    this.rmRecursive(CHANNEL_ROOT);
  }

  private restore() {
    for (const path of this.deletedPaths.values()) {
      this.doRm(path);
    }
    for (const [path, record] of this.records.entries()) {
      this.doCreate(path, record);
    }
  }

  private create(path: string, record: any) {
    this.deletedPaths.delete(path);
    this.records.set(path, record);
    if (this.client !== undefined) {
      this.doCreate(path, record);
    }
  }

  private doCreate(path: string, record: any) {
    const dirName = path_.posix.dirname(path);
    const basename = path_.posix.basename(path);
    this.mkdirs(dirName);
    const dir = this.client.record.getList(path_.posix.join(dirName, INDEX_RECORD));
    dir.whenReady(() => {
      if ( ! _.includes(dir.getEntries(), basename)) {
        dir.addEntry(basename);
      }
      dir.discard();
    });
    const dsRecord = this.client.record.getRecord(path);
    dsRecord.whenReady(() => {
      dsRecord.set(record);
      log.debug({ path }, `created record ${path}`);
      dsRecord.discard();
    });
  }

  private rm(path: string) {
    this.records.delete(path);
    if (this.client === undefined) {
      this.deletedPaths.add(path);
    } else {
      this.doRm(path);
    }
  }

  private doRm(path: string) {
    this.client.record.getRecord(path).delete();
    const dirName = path_.posix.dirname(path);
    const dir = this.client.record.getList(path_.posix.join(dirName, INDEX_RECORD));
    dir.whenReady(() => {
      dir.removeEntry(path_.posix.basename(path), undefined, (err) => {
        if (err) {
          log.error({ err, path }, `error while deleting ${path}`);
        } else {
          log.debug({ path }, `deleted record ${path}`);
          if (dir.isEmpty()) {
            this.rmdir(dirName);
          }
        }
        dir.discard();
      });
    });
  }

  private rmRecursive(path: string) {
    // TODO
  }

  private rmdir(path: string) {
    const dir = this.client.record.getList(path_.posix.join(path, INDEX_RECORD));
    dir.whenReady(() => {
      if ( ! dir.isEmpty()) {
        log.error({ path }, 'unable to rmdir: directory not empty');
        dir.discard();
        return;
      }
      dir.delete();
      log.debug({ path }, `deleted directory ${path}`);
      const parentDirName = path_.posix.dirname(path);
      if (path_.posix.dirname(parentDirName) + '/' === INTROSPECTION_ROOT) {
        /* reached top level */
        return;
      }
      const parentDir = this.client.record.getList(path_.posix.join(parentDirName, INDEX_RECORD));
      parentDir.whenReady(() => {
        parentDir.removeEntry(path_.posix.basename(path) + '/');
        if (parentDir.isEmpty()) {
          this.rmdir(parentDirName);
        }
        parentDir.discard();
      });
    });
  }

  private mkdirs(path: string) {
    if ( ! path.startsWith(INTROSPECTION_ROOT)) {
      log.error({ path }, `invalid path: ${path}. Must begin with iw-introspection/`);
      throw Error(path + ' is invalid. Must begin with iw-introspection/');
    }
    let p = path;
    while (path_.posix.dirname(p) + '/' !== INTROSPECTION_ROOT) {
      this.mkdir(p);
      p = path_.posix.dirname(p);
    }
  }

  private mkdir(path: string) {
    const dirName = path_.posix.join(path_.posix.dirname(path), INDEX_RECORD);
    const dir = this.client.record.getList(dirName);
    const basename = path_.posix.basename(path);
    dir.whenReady(() => {
      if ( ! _.includes(dir.getEntries(), basename + '/')) {
        dir.addEntry(basename + '/');
        log.debug({ path }, `created directory ${path}`);
      }
      dir.discard();
    });
  }

}
