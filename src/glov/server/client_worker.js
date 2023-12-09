// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/* eslint-disable import/order */
const assert = require('assert');
const { ChannelWorker } = require('./channel_worker.js');
const { chunkedSend } = require('glov/common/chunked_send.js');
const { canonical } = require('glov/common/cmd_parse.js');
const { keyMetricsAddTagged } = require('./key_metrics.js');
const { logEx } = require('./log.js');
const { isPacket } = require('glov/common/packet.js');
const { netDelayGet, netDelaySet } = require('glov/common/wscommon.js');
const { serverConfig } = require('./server_config.js');

let cmd_parse_routes = {}; // cmd string -> worker type

let repeated_disconnect = 0;
let permission_flags_map;

let permission_flags;
function applyCustomIds(ids, user_data_public) {
  delete ids.elevated;
  let perm = user_data_public?.permissions;
  for (let ii = 0; ii < permission_flags.length; ++ii) {
    let f = permission_flags[ii];
    if (perm && perm[f]) {
      ids[f] = 1;
    } else {
      delete ids[f];
    }
  }
}

export class ClientWorker extends ChannelWorker {
  constructor(channel_server, channel_id, channel_data) {
    super(channel_server, channel_id, channel_data);
    this.client_id = this.channel_subid; // 1234
    this.client = null; // WSClient filled in by channel_server
    this.ids_base = {
      direct: undefined, // so it is iterated
    };
    this.onLogoutInternal();
    this.ids_direct = new Proxy(this.ids_base, {
      get: function (target, prop) {
        if (prop === 'direct') {
          return true;
        }
        return target[prop];
      }
    });
    this.ids = this.ids_base;

    if (repeated_disconnect) {
      setTimeout(() => {
        if (this.client.connected && repeated_disconnect) {
          this.logCtx('warn', `Disconnecting client ${this.client_id} due to /ws_disconnect_repeated`);
          this.client.ws_server.disconnectClient(this.client);
        }
      }, repeated_disconnect * 1000);
    }
  }

  onLoginInternal(user_id, resp_data) {
    this.ids_base.user_id = user_id;
    this.ids_base.display_name = resp_data.public_data.display_name;
    this.log_user_id = user_id;
    applyCustomIds(this.ids_base, resp_data.public_data);
    keyMetricsAddTagged('login', this.client.client_tags, 1);
  }

  onLogoutInternal() {
    this.ids_base.user_id = undefined;
    // Just use the last value in the channel id (not unique, but relatively so)
    this.ids_base.display_name = `guest-${this.channel_subid.split('-').slice(-1)[0]}`;
    applyCustomIds(this.ids_base, null);
    this.log_user_id = null;
  }

  onLogin(resp_data) {
    // overrideable
  }

  onApplyChannelData(source, data) {
    if (!this.ids.user_id) {
      // not logged in yet
      return;
    }
    if (source.type !== 'user' || source.id !== this.ids.user_id) {
      // not about our user
      return;
    }
    if (data.key === 'public.display_name') {
      this.ids_base.display_name = data.value;
    }
    if (data.key.startsWith('public.permissions.')) {
      let f = data.key.slice('public.permissions.'.length);
      if (permission_flags_map[f]) {
        if (data.value) {
          this.ids_base[f] = 1;
        } else {
          delete this.ids_base[f];
        }
      }
    } else if (data.key === 'public.permissions') {
      for (let f in permission_flags_map) {
        if (data.value && data.value[f]) {
          this.ids_base[f] = 1;
        } else {
          delete this.ids_base[f];
        }
      }
    }
  }

  onForceKick(source, data) {
    assert(this.client.connected);
    this.logCtx('debug', `Disconnecting client ${this.client_id} due to force_kick message`);
    this.client.ws_server.disconnectClient(this.client);
  }

  recentlyForceUnsubbed(channel_id) {
    return this.recent_force_unsub === channel_id;
  }

  onForceUnsub(source, data) {
    let { channel_id } = source;
    this.logDest(channel_id, 'debug', `Unsubscribing client ${this.client_id} due to force_unsub message`);
    this.unsubscribeOther(channel_id);
    // Maybe need to let client know too?  Pretty hard since the app logic deals
    // with subscriptions normally, so expect the app to send some other message
    // immediately before this one to deal with it gracefully.

    // Note this for later, can silently ignore all messages from client to this channel
    this.recent_force_unsub = channel_id;
  }

  onUpload(source, pak, resp_func) {
    pak.ref();
    let mime_type = pak.readAnsiString();
    let max_in_flight = pak.readInt();
    let buffer = pak.readBuffer();
    this.logCtx('debug', `sending chunked upload (${mime_type}, ` +
      `${buffer.length} bytes) from ${source.channel_id}`);
    chunkedSend({
      client: this.client,
      mime_type,
      buffer,
      max_in_flight,
    }, (err, id) => {
      pak.pool();
      if (err === 'ERR_FAILALL_DISCONNECT') {
        // client disconnected while in progress, nothing unusual
        this.logCtx('info', `${err} sending chunked upload (${mime_type})` +
          ` data as file#${id} from ${source.channel_id}`);
      } else if (err) {
        // any other errors we might need to investigate
        this.logCtx('warn', `error ${err} sending chunked upload (${mime_type})` +
          ` data as file#${id} from ${source.channel_id}`);
      } else {
        this.logCtx('debug', `sent chunked upload (${mime_type})` +
          ` data as file#${id} from ${source.channel_id}`);
      }

      resp_func(err, id);
    });
  }

  onCSRUserToClientWorker(source, pak, resp_func) {
    let cmd = pak.readString();
    let access = pak.readJSON(); // also has original source info in it, but that's fine?
    // first try to run on connected client
    if (!this.client.connected) {
      return void resp_func('ERR_CLIENT_DISCONNECTED');
    }
    pak = this.client.pak('csr_to_client');
    pak.writeString(cmd);
    pak.writeJSON(access);
    pak.send((err, resp) => {
      if (err || resp && resp.found) {
        return void resp_func(err, resp ? resp.resp : null);
      }
      if (!this.client.connected) {
        return void resp_func('ERR_CLIENT_DISCONNECTED');
      }
      this.cmdParseAuto({
        cmd,
        access,
      }, (err, resp2) => {
        resp_func(err, resp2 ? resp2.resp : null);
      });
    });
  }

  onUnhandledMessage(source, msg, data, resp_func) {
    assert(this.client);
    if (!resp_func.expecting_response) {
      resp_func = null;
    }

    if (!this.client.connected) {
      if (resp_func) {
        console.debug(`ClientWorker(${this.channel_id}) received message for disconnected client:`, msg);
        return void resp_func('ERR_CLIENT_DISCONNECTED');
      }
    }

    let is_packet = isPacket(data);
    let pak = this.client.pak('channel_msg', is_packet ? data : null);
    pak.writeAnsiString(source.channel_id);
    pak.writeAnsiString(msg);
    pak.writeBool(is_packet);
    if (is_packet) {
      pak.appendRemaining(data);
    } else {
      pak.writeJSON(data);
    }
    pak.send(resp_func);
  }

  onError(msg) {
    if (this.client.connected) {
      // This will throw an exception on the client!
      this.error('Unhandled error:', msg);
      this.client.send('error', msg);
    } else {
      this.debug('Ignoring(disconnected) unhandled error:', msg);
    }
  }

  cmdParseAuto(opts, resp_func) {
    let { cmd, access } = opts;
    let space_idx = cmd.indexOf(' ');
    let cmd_base = canonical(space_idx === -1 ? cmd : cmd.slice(0, space_idx));
    let { user_id } = this.ids;

    // First try on self
    let not_found = false;
    this.cmd_parse_source = this.ids;
    this.access = access || this.ids;
    this.cmd_parse.handle(this, cmd, (err, resp) => {
      if (err && this.cmd_parse.was_not_found) {
        // this branch guaranteed to be synchronous
        not_found = true;
      } else {
        // this branch may be hit asynchronously
        resp_func(err, { found: 1, resp: resp });
      }
    });
    if (!not_found) {
      return;
    }

    let route = cmd_parse_routes[cmd_base];
    let channel_ids = Object.keys(this.subscribe_counts);
    if (!channel_ids.length) {
      return void resp_func('ERR_NO_SUBSCRIPTIONS');
    }
    channel_ids = channel_ids.filter((channel_id) => {
      if (channel_id.startsWith('user.') && channel_id !== `user.${user_id}`) {
        return false;
      }
      if (route && !channel_id.startsWith(route)) {
        return false;
      }
      return true;
    });
    // Don't send to ourself over the message exchange, super inefficient!
    // channel_ids.push(this.channel_id);
    if (!channel_ids.length) {
      // Not subscribed to any worker that can handle this command
      return void resp_func(`Unknown command: "${cmd_base}"`);
    }
    let self = this;
    let idx = 0;
    let last_err;
    function tryNext() {
      if (!self.client.connected) {
        // Disconnected while routing, silently fail; probably already had a failall_disconnect error triggered
        return void resp_func();
      }
      if (idx === channel_ids.length) {
        self.logCtx('info', 'cmd_parse_unknown', {
          cmd,
          display_name: self.ids.display_name,
        });
        return void resp_func(last_err);
      }
      let channel_id = channel_ids[idx++];
      let pak = self.pak(channel_id, 'cmdparse_auto');
      pak.writeString(cmd);
      pak.writeJSON(access);
      pak.send(function (err, resp) {
        if (!route && !cmd_parse_routes[cmd_base] && resp && resp.found) {
          let target = channel_id.split('.')[0];
          cmd_parse_routes[cmd_base] = target;
          self.debug(`Added cmdParseAuto route for ${cmd_base} to ${target}`);
        }
        if (err || resp && resp.found) {
          return void resp_func(err, resp);
        }
        // otherwise, was not found
        if (resp && resp.err) {
          last_err = resp.err;
        }
        tryNext();
      });
    }
    tryNext();
  }

  cmdNetDelayServer(str, resp_func) {
    if (str) {
      this.warnSrc(this.cmd_parse_source, `Setting NetDelay to ${str}`);
      let params = str.split(' ');
      netDelaySet(Number(params[0]), Number(params[1]) || 0);
    }
    let cur = netDelayGet();
    resp_func(null, `Server NetDelay: ${cur[0]}+${cur[1]}`);
  }
  cmdWSDisconnect(str, resp_func) {
    let time = Number(str) || 0;
    if (resp_func) {
      resp_func(null, `Disconnecting in ${time}s...`);
    }
    setTimeout(() => {
      if (this.client.connected) {
        this.logCtx('warn', `Disconnecting client ${this.client_id} due to /ws_disconnect`);
        this.client.ws_server.disconnectClient(this.client);
      }
    }, time * 1000);
  }
  cmdWSDisconnectRepeated(str, resp_func) {
    let time = Number(str);
    if (!isFinite(time)) {
      return void resp_func('Usage: /ws_disconnect_repeated SECONDS');
    }
    repeated_disconnect = time;
    if (!time) {
      return void resp_func(null, 'Repeated disconnect cleared');
    }
    this.cmdWSDisconnect(str);
    return void resp_func(`Will repeatedly disconnect all future clients after ${time}s,`+
      ' run /ws_disconnect_repeated 0 to clear');
  }

  logDest(channel_id, level, ...args) {
    let ctx = {
      client: this.client_id,
    };
    let ids = channel_id.split('.');
    ctx[ids[0]] = ids[1]; // set ctx.world: 1234, etc
    if (this.log_user_id) {
      ctx.user_id = this.log_user_id;
    }
    logEx(ctx, level, `${this.client_id}->${channel_id}:`, ...args);
  }
  logCtx(level, ...args) {
    let ctx = {
      client: this.client_id,
    };
    if (this.log_user_id) {
      ctx.user_id = this.log_user_id;
    }
    logEx(ctx, level, `${this.client_id}:`, ...args);
  }
}

ClientWorker.prototype.no_datastore = true; // No datastore instances created here as no persistence is needed

let inited = false;
let client_worker_init_data = {
  autocreate: false,
  subid_regex: /^[a-zA-Z0-9-]+$/,
  filters: {
    apply_channel_data: ClientWorker.prototype.onApplyChannelData,
  },
  handlers: {
    force_kick: ClientWorker.prototype.onForceKick,
    force_unsub: ClientWorker.prototype.onForceUnsub,
    upload: ClientWorker.prototype.onUpload,
    csr_user_to_clientworker: ClientWorker.prototype.onCSRUserToClientWorker,
  },
  cmds: [{
    cmd: 'net_delay_server',
    help: '(Admin) Sets/shows network delay values on the server for all clients',
    usage: '$HELP\n/net_delay_server time_base time_rand',
    access_run: ['sysadmin'],
    func: ClientWorker.prototype.cmdNetDelayServer,
  }, {
    cmd: 'ws_disconnect',
    help: '(Admin) Forcibly disconnect our WebSocket connection',
    access_run: ['sysadmin'],
    func: ClientWorker.prototype.cmdWSDisconnect,
  }, {
    cmd: 'ws_disconnect_repeated',
    help: '(Admin) Forcibly disconnect all WebSocket connections on a timer',
    access_run: ['sysadmin'],
    func: ClientWorker.prototype.cmdWSDisconnectRepeated,
  }],
};
let client_worker = ClientWorker;
export function overrideClientWorker(new_client_worker, extra_data) {
  assert(!inited);
  client_worker = new_client_worker || client_worker;
  for (let key in extra_data) {
    let v = extra_data[key];
    if (Array.isArray(v)) {
      let dest = client_worker_init_data[key] = client_worker_init_data[key] || [];
      for (let ii = 0; ii < v.length; ++ii) {
        dest.push(v[ii]);
      }
    } else if (typeof v === 'object') {
      let dest = client_worker_init_data[key] = client_worker_init_data[key] || {};
      for (let subkey in v) {
        dest[subkey] = v[subkey];
      }
    } else {
      client_worker_init_data[key] = v;
    }
  }
}

export function init(channel_server) {
  inited = true;
  permission_flags = serverConfig().permission_flags || [];
  permission_flags_map = {};
  for (let ii = 0; ii < permission_flags.length; ++ii) {
    permission_flags_map[permission_flags[ii]] = true;
  }
  channel_server.registerChannelWorker('client', client_worker, client_worker_init_data);
}
