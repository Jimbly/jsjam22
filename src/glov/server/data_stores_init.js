const argv = require('minimist')(process.argv.slice(2));
const data_store = require('./data_store.js');
const data_store_image = require('./data_store_image.js');
const data_store_limited = require('./data_store_limited.js');
const data_store_mirror = require('./data_store_mirror.js');
const data_store_shield = require('./data_store_shield.js');
const { serverConfig } = require('./server_config.js');

export function dataStoresInit(data_stores) {
  let server_config = serverConfig();

  // Meta and bulk stores
  if (!data_stores.meta) {
    data_stores.meta = data_store.create('data_store');
  } else if (server_config.do_mirror) {
    if (data_stores.meta) {
      if (server_config.local_authoritative === false) {
        console.log('[DATASTORE] Mirroring meta store (cloud authoritative)');
        data_stores.meta = data_store_mirror.create({
          read_check: true,
          readwrite: data_stores.meta,
          write: data_store.create('data_store'),
        });
      } else {
        console.log('[DATASTORE] Mirroring meta store (local authoritative)');
        data_stores.meta = data_store_mirror.create({
          read_check: true,
          readwrite: data_store.create('data_store'),
          write: data_stores.meta,
        });
      }
    }
  }
  if (!data_stores.bulk) {
    data_stores.bulk = data_store.create('data_store/bulk');
    if (argv.dev) {
      data_stores.bulk = data_store_limited.create(data_stores.bulk, 1000, 1000, 250);
    }
  } else if (server_config.do_mirror) {
    if (data_stores.bulk) {
      if (server_config.local_authoritative === false) {
        console.log('[DATASTORE] Mirroring bulk store (cloud authoritative)');
        data_stores.bulk = data_store_mirror.create({
          read_check: true,
          readwrite: data_stores.bulk,
          write: data_store.create('data_store/bulk'),
        });
      } else {
        console.log('[DATASTORE] Mirroring bulk store (local authoritative)');
        data_stores.bulk = data_store_mirror.create({
          read_check: true,
          readwrite: data_store.create('data_store/bulk'),
          write: data_stores.bulk,
        });
      }
    }
  }
  if (server_config.do_shield) {
    console.log('[DATASTORE] Applying shield layer to bulk and meta stores');
    data_stores.meta = data_store_shield.create(data_stores.meta, { label: 'meta' });
    data_stores.bulk = data_store_shield.create(data_stores.bulk, { label: 'bulk' });
  }

  // Image data store is a different API, not supporting mirror/shield for now
  if (data_stores.image === undefined) {
    data_stores.image = data_store_image.create('data_store/public', 'upload');
  }
  return data_stores;
}
