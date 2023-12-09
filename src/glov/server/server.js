// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

global.profilerStart = global.profilerStop = global.profilerStopStart = function () {
  // not yet profiling on server
};

let on_panic = [];

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  dataErrorOnError,
  dataErrorQueueEnable,
  dataErrorQueueGet,
} from 'glov/common/data_error';
import { packetEnableDebug } from 'glov/common/packet';
import { callEach } from 'glov/common/util';
import wscommon from 'glov/common/wscommon';
import minimist from 'minimist';
const argv = minimist(process.argv.slice(2));
import glov_channel_server from './channel_server';
import { dataStoresInit } from './data_stores_init';
import { errorReportsInit, errorReportsSetAppBuildTimestamp } from './error_reports';
import { exchangeCreate } from './exchange';
import { exchangeHashedCreate } from './exchange_hashed';
import { exchangeLocalBypassCreate } from './exchange_local_bypass';
import { idmapperWorkerInit } from './idmapper_worker';
import { ipBanInit } from './ip_ban';
import log from './log';
const { logEx } = log;
import { masterInitApp } from './master_worker';
import { metricsInit } from './metrics';
import { readyDataInit } from './ready_data';
import { serverConfig } from './server_config';
import { serverFilewatchTriggerChange } from './server_filewatch';
import { shaderStatsInit } from './shader_stats';
import glov_wsserver from './wsserver';
const { netDelaySet } = wscommon;

const STATUS_TIME = 5000;
export let ws_server;
export let channel_server;

export function getChannelServer() {
  return channel_server;
}

let last_status = '';
function displayStatus() {
  setTimeout(displayStatus, STATUS_TIME);
  let status = channel_server.getStatus();
  if (status !== last_status) {
    console.info('STATUS', new Date().toISOString(), status);
    last_status = status;
  }
}

let last_build_timestamp = {};
function updateBuildTimestamp(base_name, is_startup) {
  let version_file_name = path.join(__dirname, `../../client/${base_name}.ver.json`);
  fs.readFile(version_file_name, function (err, data) {
    if (err) {
      // ignore, probably being written to
      return;
    }
    let obj;
    try {
      obj = JSON.parse(data);
    } catch (e) {
      return;
    }
    if (!obj || !obj.ver) {
      return;
    }
    let old_timestamp = last_build_timestamp[base_name];
    if (old_timestamp === obj.ver) {
      return;
    }
    console.info(`Build timestamp for "${base_name}"${old_timestamp ? ' changed to' : ''}: ${obj.ver}`);
    last_build_timestamp[base_name] = obj.ver;
    ws_server.setAppBuildTimestamp(base_name, obj.ver);
    if (base_name === 'app') {
      errorReportsSetAppBuildTimestamp(obj.ver);
    }
    if (!is_startup) {
      if (base_name === 'app') {
        // Do a broadcast message so people get a few seconds of warning
        ws_server.broadcast('chat_broadcast', {
          src: 'system',
          msg: 'New client version deployed, reloading momentarily...'
        });
      }
      if (argv.dev) {
        // immediate
        ws_server.broadcast('build', { app: base_name, ver: last_build_timestamp.app });
      } else {
        // delay by 15 seconds, the server may also be about to be restarted
        setTimeout(function () {
          ws_server.broadcast('build', { app: base_name, ver: last_build_timestamp.app });
        }, 15000);
      }
    }
  });
}

export function sendToBuildClients(msg, data) {
  for (let client_id in ws_server.clients) {
    let client = ws_server.clients[client_id];
    if (client.gbstate_enable) {
      client.send(msg, data);
    }
  }
}

function onDataError(err) {
  sendToBuildClients('data_errors', [err]);
}

let recent_filewatch = [];
const FILEWATCH_RECENT_TIME = 10000;
function filewatchClean() {
  if (recent_filewatch.length) {
    let now = Date.now();
    while (recent_filewatch.length && recent_filewatch[0][0] < now - FILEWATCH_RECENT_TIME) {
      recent_filewatch.shift();
    }
  }
}

export function startup(params) {
  log.startup();

  let { app, data_stores, exchange, metrics_impl, on_report_load, server, server_https } = params;
  assert(app);
  assert(server);
  assert(!exchange, 'Exchange must now be registered by type and specified in default config');

  if (!data_stores) {
    data_stores = {};
  }
  let server_config = serverConfig();

  data_stores = dataStoresInit(data_stores);

  if (metrics_impl) {
    metricsInit(metrics_impl);
  }

  if (!exchange) {
    if (server_config.exchange_providers) {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      server_config.exchange_providers.map((provider) => require(path.join('../..', provider)));
    }
    if (server_config.exchanges) {
      let exchanges = server_config.exchanges.map(exchangeCreate);
      console.log(`[EXCHANGE] Hashing between ${exchanges.length} exchanges`);
      exchange = exchangeHashedCreate(exchanges);
    } else {
      exchange = exchangeCreate(server_config.exchange || {});
    }
  }

  if (!exchange.no_local_bypass && server_config.do_exchange_local_bypass) {
    console.log('[EXCHANGE] Using local bypass');
    exchange = exchangeLocalBypassCreate(exchange);
  }
  channel_server = glov_channel_server.create();
  if (argv.dev) {
    if (argv['packet-debug'] !== false) {
      console.log('PacketDebug: ON');
      packetEnableDebug(true);
    }
    if (argv['net-delay'] !== false) {
      netDelaySet();
    }
    dataErrorQueueEnable(true);
    dataErrorOnError(onDataError);
  }
  if (server_config.log && server_config.log.load_log) {
    channel_server.load_log = true;
  }

  ws_server = glov_wsserver.create(server, server_https, argv.timeout === false, argv.dev);
  ws_server.on('error', function (error, client) {
    if (client) {
      channel_server.last_worker = client.client_channel;
      logEx(client.ctx(), 'error', `Unhandled WSServer error from ${client.addr}:`, error);
    } else {
      console.error('Unhandled WSServer error:', error);
    }
    let text = String(error);
    if (
      text.includes('Invalid WebSocket frame:') || // bad data from old clients?
      text.includes('RangeError: Max payload size exceeded') // client sent too large of data, got auto-disconnected
    ) {
      // Log, but don't broadcast or write crash dump
      console.error('ERROR (no dump)', new Date().toISOString(), error);
    } else {
      channel_server.handleUncaughtError(error);
    }
  });

  ipBanInit();
  readyDataInit(channel_server, app);

  channel_server.init({
    exchange,
    data_stores,
    ws_server,
    on_report_load,
    is_master: argv.master,
  });

  process.on('SIGTERM', channel_server.forceShutdown.bind(channel_server));
  process.on('uncaughtException', channel_server.handleUncaughtError.bind(channel_server));
  ws_server.on('uncaught_exception', channel_server.handleUncaughtError.bind(channel_server));

  masterInitApp(channel_server, app, argv);
  errorReportsInit(app);
  idmapperWorkerInit(channel_server);
  if (argv.dev) {
    shaderStatsInit(app);
  }

  setTimeout(displayStatus, STATUS_TIME);

  let gbstate;
  if (argv.dev) {
    ws_server.on('client', function (client) {
      filewatchClean();
      for (let ii = 0; ii < recent_filewatch.length; ++ii) {
        client.send('filewatch', recent_filewatch[ii][1]);
      }
    });
    process.on('message', function (msg) {
      if (!msg) {
        return;
      }
      if (msg.type === 'file_change') {
        filewatchClean();
        let files = msg.paths;
        for (let ii = 0; ii < files.length; ++ii) {
          let filename = files[ii];
          console.log(`File changed: ${filename}`);
          let shortname;
          if (filename.startsWith('client/')) {
            shortname = filename.replace(/^client\//, '');
            recent_filewatch.push([Date.now(), shortname]);
            ws_server.broadcast('filewatch', shortname);
          } else {
            assert(filename.startsWith('server/'));
            shortname = filename.replace(/^server\//, '');
          }
          serverFilewatchTriggerChange(shortname);
          let m = shortname.match(/(.*)\.ver\.json$/);
          if (m) {
            let file_base_name = m[1]; // e.g. 'app' or 'worker'
            updateBuildTimestamp(file_base_name);
          }
        }
      } else if (msg.type === 'gbstate') {
        gbstate = msg.state;
        sendToBuildClients('gbstate', gbstate);
      }
    });
  }
  ws_server.onMsg('gbstate_enable', (client, pak, resp_func) => {
    client.gbstate_enable = pak.readBool();
    if (client.gbstate_enable) {
      client.send('gbstate', gbstate);
      let data_errors = dataErrorQueueGet();
      if (data_errors.length) {
        client.send('data_errors', data_errors);
      }
    }
    resp_func();
  });
  updateBuildTimestamp('app', true);
}

export function onpanic(cb) {
  on_panic.push(cb);
}

export function panic(...message) {
  if (message && message.length === 1 && message[0] instanceof Error) {
    console.error(message[0]);
  } else {
    console.error(...message); // Log all parameters
    console.error(new Error(message)); // So Stackdriver error reporting catches it
  }
  console.error('Process exiting due to panic');
  callEach(on_panic);
  process.stderr.write(String(message), () => {
    console.error('Process exiting due to panic (2)'); // May not be seen due to buffering, but useful if it is seen
    process.exit(1);
  });
  throw new Error('panic'); // ensure calling code does not continue
}
