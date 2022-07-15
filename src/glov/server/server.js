// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/* eslint-disable import/order */
const argv = require('minimist')(process.argv.slice(2));
const assert = require('assert');
const { dataStoresInit } = require('./data_stores_init.js');
const glov_exchange = require('./exchange.js');
const exchange_local_bypass = require('./exchange_local_bypass.js');
const { errorReportsInit, errorReportsSetAppBuildTimestamp } = require('./error_reports.js');
const glov_channel_server = require('./channel_server.js');
const fs = require('fs');
const { idmapperWorkerInit } = require('./idmapper_worker.js');
const log = require('./log.js');
const { logEx } = log;
const { masterInitApp } = require('./master_worker.js');
const metrics = require('./metrics.js');
const path = require('path');
const packet = require('glov/common/packet.js');
const { serverConfig } = require('./server_config.js');
const { shaderStatsInit } = require('./shader_stats.js');
const glov_wsserver = require('./wsserver.js');
const wscommon = require('glov/common/wscommon.js');
const { netDelaySet } = wscommon;

const STATUS_TIME = 5000;
export let ws_server;
export let channel_server;

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
    if (base_name === 'app') {
      errorReportsSetAppBuildTimestamp(obj.ver);
      ws_server.setAppBuildTimestamp(obj.ver);
      if (!is_startup) {
        // Do a broadcast message so people get a few seconds of warning
        ws_server.broadcast('chat_broadcast', {
          src: 'system',
          msg: 'New client version deployed, reloading momentarily...'
        });
        if (argv.dev) {
          // immediate
          ws_server.broadcast('build', last_build_timestamp.app);
        } else {
          // delay by 15 seconds, the server may also be about to be restarted
          setTimeout(function () {
            ws_server.broadcast('build', last_build_timestamp.app);
          }, 15000);
        }
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

export function startup(params) {
  log.startup();

  let { app, data_stores, exchange, metrics_impl, on_report_load, server, server_https } = params;
  assert(app);
  assert(server);

  if (!data_stores) {
    data_stores = {};
  }
  let server_config = serverConfig();

  data_stores = dataStoresInit(data_stores);

  if (metrics_impl) {
    metrics.init(metrics_impl);
  }

  if (exchange) {
    if (server_config.do_exchange_local_bypass) {
      console.log('[EXCHANGE] Using local bypass');
      exchange = exchange_local_bypass.create(exchange);
    }
  } else {
    exchange = glov_exchange.create();
  }
  channel_server = glov_channel_server.create();
  if (argv.dev) {
    console.log('PacketDebug: ON');
    packet.default_flags = packet.PACKET_DEBUG;
    if (argv['net-delay'] !== false) {
      netDelaySet();
    }
  }
  if (server_config.log && server_config.log.load_log) {
    channel_server.load_log = true;
  }

  ws_server = glov_wsserver.create(server, server_https, argv.timeout === false);
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
    process.on('message', function (msg) {
      if (!msg) {
        return;
      }
      if (msg.type === 'file_change') {
        let files = msg.paths;
        for (let ii = 0; ii < files.length; ++ii) {
          let filename = files[ii];
          console.log(`File changed: ${filename}`);
          ws_server.broadcast('filewatch', filename);
          let m = filename.match(/(.*)\.ver\.json$/);
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
    }
    resp_func();
  });
  updateBuildTimestamp('app', true);
}

export function panic(...message) {
  if (message && message.length === 1 && message[0] instanceof Error) {
    console.error(message[0]);
  } else {
    console.error(...message); // Log all parameters
    console.error(new Error(message)); // So Stackdriver error reporting catches it
  }
  console.error('Process exiting due to panic');
  process.stderr.write(String(message), () => {
    console.error('Process exiting due to panic (2)'); // May not be seen due to buffering, but useful if it is seen
    process.exit(1);
  });
  throw new Error('panic'); // ensure calling code does not continue
}
