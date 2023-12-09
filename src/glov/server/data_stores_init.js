import minimist from 'minimist';
const argv = minimist(process.argv.slice(2));
import { dataStoreCreate } from './data_store';
import { dataStoreImageCreate } from './data_store_image';
import { dataStoreLimitedCreate } from './data_store_limited';
import { dataStoreMirrorCreate } from './data_store_mirror';
import { dataStoreShieldCreate } from './data_store_shield';
import { serverConfig } from './server_config';

export function dataStoresInit(data_stores) {
  let server_config = serverConfig();

  // Meta and bulk stores
  if (!data_stores.meta) {
    data_stores.meta = dataStoreCreate('data_store');
  } else if (server_config.do_mirror) {
    if (data_stores.meta) {
      if (server_config.local_authoritative === false) {
        console.log('[DATASTORE] Mirroring meta store (cloud authoritative)');
        data_stores.meta = dataStoreMirrorCreate({
          read_check: true,
          readwrite: data_stores.meta,
          write: dataStoreCreate('data_store'),
        });
      } else {
        console.log('[DATASTORE] Mirroring meta store (local authoritative)');
        data_stores.meta = dataStoreMirrorCreate({
          read_check: true,
          readwrite: dataStoreCreate('data_store'),
          write: data_stores.meta,
        });
      }
    }
  }
  if (!data_stores.bulk) {
    data_stores.bulk = dataStoreCreate('data_store/bulk');
    if (argv.dev && argv['net-delay'] !== false) {
      data_stores.bulk = dataStoreLimitedCreate(data_stores.bulk, 1000, 1000, 250);
    }
  } else if (server_config.do_mirror) {
    if (data_stores.bulk) {
      if (server_config.local_authoritative === false) {
        console.log('[DATASTORE] Mirroring bulk store (cloud authoritative)');
        data_stores.bulk = dataStoreMirrorCreate({
          read_check: true,
          readwrite: data_stores.bulk,
          write: dataStoreCreate('data_store/bulk'),
        });
      } else {
        console.log('[DATASTORE] Mirroring bulk store (local authoritative)');
        data_stores.bulk = dataStoreMirrorCreate({
          read_check: true,
          readwrite: dataStoreCreate('data_store/bulk'),
          write: data_stores.bulk,
        });
      }
    }
  }
  if (server_config.do_shield) {
    console.log('[DATASTORE] Applying shield layer to bulk and meta stores');
    data_stores.meta = dataStoreShieldCreate(data_stores.meta, { label: 'meta' });
    data_stores.bulk = dataStoreShieldCreate(data_stores.bulk, { label: 'bulk' });
  }

  // Image data store is a different API, not supporting mirror/shield for now
  if (data_stores.image === undefined) {
    data_stores.image = dataStoreImageCreate('data_store/public', 'upload');
  }
  return data_stores;
}
