// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/* eslint-disable import/order */
const argv = require('minimist')(process.argv.slice(2));
const assert = require('assert');
const fs = require('fs');
const metrics = require('./metrics.js');
const path = require('path');
const { processUID, serverConfig } = require('./server_config.js');
const { inspect } = require('util');
const { ridx } = require('glov/common/util.js');
const winston = require('winston');
const { format } = winston;
const Transport = require('winston-transport');
require('winston-daily-rotate-file');

let log_dump_to_logger = true;
let log_dir = './logs/';
let last_uid = 0;
let pid = process.pid;
let puid = processUID();
let logger = {};
let raw_console = {};
if (pid < 100 && process.env.PODNAME) {
  pid = process.env.PODNAME;
  let split = pid.split('-');
  let tail = split.pop();
  if (split.includes('worker')) {
    // test-worker-foo-1234
    pid = `w${tail}`;
  } else if (split.includes('master')) {
    // test-master-foo-1234
    // master-instance-foo-1234
    pid = `m${tail}`;
  } else if (split.length > 2) {
    // instance-foo-1234
    pid = `${split[0][0]}${tail}`;
  }
  if (process.pid !== 1) {
    pid += `-${process.pid}`;
  }
  console.log(`Using fake logging PID of ${pid}`);
}

const LOG_LEVELS = {
  debug: 'debug',
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

let level_map = {};

export function logDowngradeErrors(do_downgrade) {
  if (do_downgrade) {
    level_map.error = 'warn';
  } else {
    delete level_map.error;
  }
}

let last_external_uid = 0;
export function getUID() {
  return ++last_external_uid;
}

export function logDumpJSON(prefix, data, ext) {
  let filename = path.join(log_dir, `${prefix}-${pid}-${getUID()}.${ext || 'log'}`);
  fs.writeFile(filename, JSON.stringify(data), function (err) {
    if (err) {
      console.error(`Error writing to log file ${filename}`, err);
    }
  });

  if (!log_dump_to_logger) {
    return filename;
  }
  let level = prefix === 'crash' || prefix === 'error' ? 'error' : 'warn';
  let pre_log_uid = ++last_uid;
  let crash_uid = ++last_uid;
  let crash_id = `${prefix}-${crash_uid}`;
  logger.log(level, `Writing dump to log with crash_id=${crash_id}, also saved to ${filename}`, { uid: pre_log_uid });
  data.uid = crash_uid;
  logger.log(level, crash_id, data);
  return `LOG:${crash_id},FILE:${filename}`;
}

function argProcessor(arg) {
  if (typeof arg === 'object') {
    return inspect(arg, { breakLength: Infinity, compact: true });
  }
  return arg;
}


// Note: modifies `context`
export function logEx(context, level, ...args) {
  assert(typeof context !== 'string');
  context = context || {};
  level = LOG_LEVELS[level];
  assert(level);
  level = level_map[level] || level;
  metrics.add(`log.${level}`, 1);
  context.level = level;
  // If 2 or more arguments and the last argument is an object, assume it is
  //   per-call metadata, and merge with context metadata
  let arg_len = args.length;
  let meta_arg = args[arg_len - 1];
  if (meta_arg && typeof meta_arg === 'object' && !Array.isArray(meta_arg) && !(meta_arg instanceof Error)) {
    // last parameter is an object pass as a payload
    if (typeof meta_arg.toJSON === 'function') {
      meta_arg = meta_arg.toJSON();
    }
    context.payload = meta_arg;
    --arg_len;
  }
  let message = [];
  for (let ii = 0; ii < arg_len; ++ii) {
    message.push(argProcessor(args[ii]));
  }
  message = message.join(' ');
  if (!message) {
    message = 'NO_MESSAGE';
  }
  context.message = message;
  context.uid = ++last_uid;
  logger.log(context);
}

// export function debug(...args) {
//   logEx(null, 'debug', ...args);
// }
// export function info(...args) {
//   logEx(null, 'info', ...args);
// }
// export function warn(...args) {
//   logEx(null, 'warn', ...args);
// }
// export function error(...args) {
//   logEx(null, 'error', ...args);
// }


const { MESSAGE, LEVEL } = require('triple-beam');

class SimpleConsoleTransport extends Transport {
  log(linfo, callback) {
    raw_console[linfo[LEVEL]](linfo[MESSAGE]);

    if (callback) {
      callback();
    }
    this.emit('logged', linfo);
  }
}


const subscribed_clients = [];
export function logSubscribeClient(client) {
  subscribed_clients.push(client);
}
export function logUnsubscribeClient(client) {
  for (let ii = subscribed_clients.length - 1; ii >= 0; --ii) {
    if (subscribed_clients[ii] === client) {
      ridx(subscribed_clients, ii);
    }
  }
}

class SubscribedClientsTransport extends Transport {
  log(linfo, callback) {
    for (let ii = subscribed_clients.length - 1; ii >= 0; --ii) {
      let client = subscribed_clients[ii];
      if (!client.connected) {
        ridx(subscribed_clients, ii);
        continue;
      }
      client.send('log_echo', linfo);
    }
    if (callback) {
      callback();
    }
    this.emit('logged', linfo);
  }
}

const STACKDRIVER_SEVERITY = {
  // silly: 'DEFAULT',
  // verbose: 'DEBUG',
  debug: 'DEBUG',
  // default: 'INFO',
  // http: 'INFO',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
};

// add severity level to work on GCP stackdriver
// reference: https://gist.github.com/jasperkuperus/9df894041e3d5216ce25af03d38ec3f1
const stackdriverFormat = format((data) => {
  data.pid = pid;
  if (!data.uid) {
    data.uid = ++last_uid;
  }
  data.severity = STACKDRIVER_SEVERITY[data[LEVEL]] || STACKDRIVER_SEVERITY.info;
  data.puid = puid;
  return data;
});

// Simulate an output similar to stackdriver for comparable local logs
const stackdriverLocalFormat = format((data) => {
  data.pid = pid;
  if (!data.uid) {
    data.uid = ++last_uid;
  }
  // data.puid = puid;
  return {
    severity: STACKDRIVER_SEVERITY[data[LEVEL]] || STACKDRIVER_SEVERITY.info,
    timestamp: new Date().toISOString(),
    jsonPayload: data,
  };
});

let inited = false;
export function startup(params) {
  if (inited) {
    return;
  }
  params = params || {};
  inited = true;
  let options = { transports: [] };

  let server_config = serverConfig();
  let config_log = server_config.log || {};
  let level = config_log.level || 'debug';
  if (params.transports) {
    options.transports = options.transports.concat(params.transports);
  } else {
    let args = [];
    let stderrLevels;
    if (config_log.stackdriver) {
      // Structured logging for Stackdriver through the console
      stderrLevels = ['error'];
      //args.push(format.timestamp()); // doesn't seem to be needed
      args.push(stackdriverFormat());
      args.push(format.json());
    } else {
      if (config_log.local_log) {
        // Structured logging to disk in rotating files for local debugging
        let local_format = format.combine(
          stackdriverLocalFormat(),
          format.json(),
        );
        options.transports.push(new winston.transports.DailyRotateFile({
          level,
          filename: 'server-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          dirname: 'logs',
          maxFiles: 7,
          eol: '\n',
          format: local_format,
        }));
        options.transports.push(new SubscribedClientsTransport({
          level,
          format: local_format,
        }));
      }
      // Human-readable/grep-able console logger
      log_dump_to_logger = false;
      args.push(format.metadata());
      if (config_log.timestamp_format === 'long') {
        // implicitly toISOString, can get local time with {format: 'YYYY-MM-DDTHH:mm:ss.SSSZZ'}
        args.push(format.timestamp());
      } else {
        args.push(format.timestamp({ format: 'HH:mm:ss' }));
      }
      if (config_log.pad_levels) {
        args.push(format.padLevels());
      }
      if (config_log.format === 'dev') {
        args.push(format.colorize());
        args.push(
          // Just the payload
          format.printf(function (data) {
            let payload = data.metadata && data.metadata.payload;
            let meta = payload ?
              ` | ${inspect(payload, { breakLength: Infinity, compact: true })}` :
              '';
            return `[${data.timestamp}] ${data.level} ${data.message}${meta}`;
          })
        );
      } else {
        args.push(
          format.printf(function (data) {
            let meta = Object.keys(data.metadata).length !== 0 ?
              ` | ${inspect(data.metadata, { breakLength: Infinity, compact: true })}` :
              '';
            return `[${data.timestamp} ${pid} ${++last_uid}] ${data.level} ${data.message}${meta}`;
          })
        );
      }
    }
    let format_param = format.combine(...args);
    if (argv.dev) {
      // DOES forward to debugger
      options.transports.push(
        new SimpleConsoleTransport({
          level,
          format: format_param,
        })
      );
    } else {
      // Does NOT forward to an interactive debugger (due to bug? useful, though)
      options.transports.push(
        new winston.transports.Console({
          level,
          format: format_param,
          stderrLevels,
        })
      );
    }
  }

  logger = winston.createLogger(options);
  //debug('TESTING DEBUG LEVEL');
  //info('TESTING INFO LEVEL');
  //warn('TESTING WARN LEVEL', { foo: 'bar' });
  //error('TESTING ERROR LEVEL', { foo: 'bar' }, { baaz: 'quux' });

  if (!fs.existsSync(log_dir)) {
    console.info(`Creating ${log_dir}...`);
    fs.mkdirSync(log_dir);
  }

  Object.keys(LOG_LEVELS).forEach(function (fn) {
    let log_level = LOG_LEVELS[fn];
    raw_console[fn] = console[fn];
    console[fn] = logEx.bind(null, null, log_level);
  });

  // console.debug('TESTING DEBUG LEVEL');
  // console.info('TESTING INFO LEVEL');
  // console.warn('TESTING WARN LEVEL', { foo: 'bar' });
  // console.error('TESTING ERROR LEVEL', { foo: 'bar' }, { baaz: 'quux' });
  // console.error('TESTING ERROR LEVEL', new Error('error param'));
  // console.error(new Error('raw error'));
  // console.info({ testing: 'info object' });
  // console.info('testing object param', { testing: 'info object' });
}
