export let LOAD_ESTIMATE = {
  def: 10, // 1% CPU
};

import assert from 'assert';
const { max } = Math;
import { callEach, nop, plural } from 'glov/common/util';
import { LOAD_REPORT_INTERVAL, channelServerSendNoCreate } from './channel_server';
import { ChannelWorker } from './channel_worker';
import { loadBiasMap } from './load_bias_map';
import * as metrics from './metrics';
import { readyDataCheck } from './ready_data';
import { serverConfig } from './server_config';

// Do not attempt to recreate a channel if it was created this long ago, assume
// the requester simply failed to send before the channel was created.
const CHANNEL_RECREATE_DELAY = 15000;
// Assume they have crashed if they do not report their load in this time
// JE 22/02/25: Using heavy timeout (~4 minutes) all the time, too many false timeouts during a spike
const CHANNEL_WORKER_TIMEOUT = LOAD_REPORT_INTERVAL * 15; // LOAD_REPORT_INTERVAL * 5;
// If the worker is under heavy load, use a much larger timeout
const CHANNEL_WORKER_TIMEOUT_HEAVY = LOAD_REPORT_INTERVAL * 15;
// How long between broadcasting master stats
const MASTER_STATS_PERIOD = 10000;

const ROUND_ROBIN = false;

// Bias towards starting workers on the hosts that request them, so the
//   local exchange bypass can provide a performance boost
const LOAD_BIAS_REQUESTOR = 250; // 25% CPU
// Do not try to spawn on a ChannelServer that had an error, until he has reports load again
const LOAD_BIAS_ERRORS = 50000;
// Load level considered "unavailable" (normal load should all be < 1000, exceptional cases > 10000)
const LOAD_AVAILABLE = 1000;

const RESTART_REASONS = {
  default: 'Might be a game update',
  update: 'New game update',
  bugs: 'Bug fixes',
  maint: 'Maintenance',
};
const RESTART_REASONS_HELP = Object.keys(RESTART_REASONS)
  .map((key) => `    ${key} = "${RESTART_REASONS[key]}"`)
  .join('\n');

class MasterWorker extends ChannelWorker {
  constructor(channel_server, channel_id, channel_data) {
    super(channel_server, channel_id, channel_data);
    this.known_servers = {}; // other `channel_server` workers we know about
    this.channels_creating = {};
    this.channels_locked = {};
    this.total_num_channels = {};
    this.master_stats_countdown = MASTER_STATS_PERIOD;
    this.master_startup_time = this.channel_server.server_time;
    this.deploy_ready_count = 0;
    this.deploy_ready_force = false;
    this.deploy_ready_msg_time = 0;
    // Broadcast to all ChannelServers to let them know there is a (potentially new) master worker
    // Delay until we finish startup/registration
    channel_server.whenReady(this.sendChannelMessage.bind(this, 'channel_server', 'master_startup'));
    console.log('lifecycle_master_start');
    metrics.set('server_error', 0); // "Clear" this upon deployment restart so we get new alerts if new errors happen
  }
  getChanServData(id) {
    assert(id);
    let cs = this.known_servers[id];
    if (!cs) {
      cs = this.known_servers[id] = {
        last_load: 0,
        load_new_estimate: 0, // extra load estimated from newly spawned workers
        load_new_estimate_prev: 0,
        load_value: 0,
        load_over: [],
        load: {
        },
        last_seen_time: this.channel_server.server_time,
        first_seen_time: this.channel_server.server_time,
        num_channels: {},
        spawn_errors: 0,
      };
      if (this.channel_server.restarting) {
        this.sendChannelMessage(`channel_server.${id}`, 'restarting', true);
      }
    }
    return cs;
  }
  numChannelsMod(set, delta) {
    let tnc = this.total_num_channels;
    for (let channel_type in set) {
      tnc[channel_type] = (tnc[channel_type] || 0) + delta * set[channel_type];
    }
  }
  handleLoad(src, pak, resp_func) {
    let load_cpu = pak.readInt(); // in tenths of a percent
    let load_host_cpu = pak.readInt(); // in tenths of a percent
    let load_mem = pak.readInt(); // in MB
    let free_mem = pak.readInt(); // in tenths of a percent
    let msgs_per_s = pak.readInt();
    let num_channels = pak.readJSON();
    let debug_addr = pak.readJSON();
    assert.equal(src.type, 'channel_server');
    let cs = this.getChanServData(src.id);
    cs.last_load = Date.now();
    cs.load.cpu = load_cpu;
    cs.load.host_cpu = load_host_cpu;
    cs.load.mem = load_mem;
    cs.load.free_mem = free_mem;
    cs.load.msgs_per_s = msgs_per_s;
    cs.is_master = src.id === this.channel_server.csuid;
    if (debug_addr) {
      cs.debug_addr = debug_addr;
    }

    cs.last_seen_time = this.channel_server.server_time;
    this.numChannelsMod(cs.num_channels, -1);
    cs.num_channels = num_channels;
    this.numChannelsMod(cs.num_channels, 1);

    // Calc load value, accumulate warnings
    let over = cs.load_over = [];
    cs.load_value = 0;
    // free memory: if low on os memory, critical load, otherwise we don't care
    if (free_mem < 300) { // < 30%
      // +30000 @ 25%
      cs.load_value += loadBiasMap(free_mem, 300, 250, 0, 30000, 40000);
      over.push('host_free_mem');
    }
    // process cpu usage: if over 50%, critical, otherwise directly correlated to load
    cs.load_value += load_cpu;
    if (load_cpu > 500) {
      // +20000 @ 60%
      cs.load_value += loadBiasMap(load_cpu, 500, 600, 1000, 20000, 30000);
      over.push('load_cpu');
    }
    // host cpu usage: if over 80%, critical, otherwise we don't care
    if (load_host_cpu > 750) {
      cs.load_value += loadBiasMap(load_host_cpu, 750, 800, 1000, 25000, 40000);
      over.push('host_cpu');
    }
    // process memory usage:
    //  if under 400MB, no effect
    //  if 400MB - 1.2GB: impact as 0-25% CPU usage
    //  if over 1.2GB, critical
    cs.load_value += max(0, 250 * (load_mem - 400) / 800);
    if (load_mem > 1200) {
      cs.load_value += 10000 + (load_mem - 1200) * 10;
      over.push('load_mem');
    }
    // msgs_per_s: current ignored, let's see how this compares

    // Is master? Significant bias against spawning
    if (cs.is_master) {
      over.push('master');
      cs.load_value += 25000;
    }

    // Cycle load new estimates
    cs.load_new_estimate_prev = cs.load_new_estimate;
    cs.load_new_estimate = 0;

    // Reset error counts
    cs.spawn_errors = 0;

    if (this.channel_server.load_log) {
      this.debug(`load from ${src.id}: ${cs.load_value.toFixed(0)} ` +
        `(${load_cpu}/${load_host_cpu}/${load_mem}/${free_mem}/${msgs_per_s})` +
        `${over.length ? ` (${over.join(',')})` : ''}`);
    }

    resp_func();

    if (cs.on_has_load) {
      callEach(cs.on_has_load, cs.on_has_load = null);
    }
  }
  handleWorkerCreateReq(src, pak, resp_func) {
    assert.equal(src.type, 'channel_server');
    let channel_type = pak.readAnsiString();
    let subid = pak.readAnsiString();
    this.handleWorkerCreateInternal(src, channel_type, subid, resp_func);
  }
  handleWorkerCreateInternal(src, channel_type, subid, resp_func) {
    let channel_id = `${channel_type}.${subid}`;
    let log_pre = `${channel_id} requested to be created by ${src.id}: `;

    // Flag the other server as heard from, so we don't time it out, even if it neglects sending load reports
    this.getChanServData(src.id).last_seen_time = this.channel_server.server_time;

    // If already spawning this worker somewhere, wait until that
    //   request comes back
    if (this.channels_creating[channel_id]) {
      if (this.channels_creating[channel_id].created) {
        this.debug(`${log_pre}finished <15s ago, immediately signaling success`);
        return void resp_func();
      } else {
        this.debug(`${log_pre}already in progress, deferring response`);
        this.channels_creating[channel_id].cbs.push(resp_func);
        return;
      }
    }

    // If this worker is locked for shutdown, delay responses until that is finished
    if (this.channels_locked[channel_id]) {
      this.debug(`${log_pre}locked, deferring response`);
      this.channels_locked[channel_id].cbs.push(resp_func);
      return;
    }

    if (!this.getChanServData(src.id).last_load) {
      // We've never received load from this channel server
      // Master probably just restarted
      // Delay servicing this request until we at least get a load report from this channel server
      this.debug(`${log_pre}no load from source, deferring request`);
      let cs = this.getChanServData(src.id);
      cs.on_has_load = cs.on_has_load || [];
      cs.on_has_load.push((err) => {
        if (err) {
          this.debug(`${log_pre}executing deferred request: error ${err}`);
          return void resp_func(err);
        }
        this.debug(`${log_pre}executing deferred request`);
        assert(cs.last_load);
        this.handleWorkerCreateInternal(src, channel_type, subid, resp_func);
      });
      return;
    }

    // Find best candidate
    let best = null;
    if (ROUND_ROBIN) { // for testing
      let bestv = 0;
      for (let csid in this.known_servers) {
        let cs = this.known_servers[csid];
        if (!bestv || !cs.last_spawn || cs.last_spawn < bestv) {
          best = csid;
          bestv = cs.last_spawn;
        }
      }
      if (best) {
        this.known_servers[best].last_spawn = Date.now();
      }
    } else {
      let bestv = Infinity;
      for (let csid in this.known_servers) {
        let cs = this.known_servers[csid];
        let v = cs.load_value + cs.load_new_estimate + cs.load_new_estimate_prev;
        if (csid === src.id) {
          v -= LOAD_BIAS_REQUESTOR;
        }
        if (cs.spawn_errors) {
          v += LOAD_BIAS_ERRORS;
        }
        if (v < bestv) {
          best = csid;
          bestv = v;
        }
      }
    }
    if (!best) {
      this.error(`${log_pre}No channel servers to create worker`);
      return void resp_func('ERR_NO_KNOWN_SERVERS');
    }
    let csid = best;
    this.log(`${log_pre}Requesting spawn on ${csid}`);

    let cc = this.channels_creating[channel_id] = {
      csid,
      timestamp: Date.now(),
      cbs: [resp_func],
    };

    let cs = this.known_servers[csid];
    // Register estimated load from spawning a new worker
    cs.load_new_estimate += LOAD_ESTIMATE[channel_type] || LOAD_ESTIMATE.def;
    let pak = this.pak(`channel_server.${csid}`, 'worker_create');
    pak.writeAnsiString(channel_type);
    pak.writeAnsiString(subid);
    pak.send((err) => {
      let cbs = cc.cbs;
      if (err) {
        // This can happen (with "Error: tried to subscribe to existing channel)
        // if we receive a spawn request immediately after an unlock due to an
        // aborted worker shutdown.
        // Should maybe instead just respond with an immediate error if the channel
        // was recently unlocked? Similar to `cc.created`.
        this.warn(`Error from request to spawn worker ${channel_id} on ${csid}: ${err}`);
        cs.spawn_errors++;
        // Will be returned caller(s) and they should try again
        // Do not delay the next attempt to spawn this worker, if necessary
        if (this.channels_creating[channel_id] === cc) { // Hasn't been replaced by another request?
          delete this.channels_creating[channel_id];
        }
      } else {
        cc.created = CHANNEL_RECREATE_DELAY;
        cc.cbs = null;
      }
      callEach(cbs, null, err);
    });
  }
  handleNewClient(src) {
    // Only system admin users allowed
    if (!src.sysadmin) {
      return 'ERR_ACCESS_DENIED';
    }
    return null;
  }
  handleMonitorRestart(src, data, resp_func) {
    let cs = this.getChanServData(src.id);
    cs.restart_data = data;
    resp_func();
  }
  handleMasterLock(src, pak, resp_func) {
    let channel_id = src.channel_id;
    let csid = pak.readAnsiString();
    this.log(`locking ${channel_id} on ${csid}`);
    if (!this.known_servers[csid]) {
      // Won't time out, but otherwise fine, if unexpected?
      // Probably happens if master worker restarts during another workers shutdown
      this.error(`Received master_lock for channel ${channel_id} on unknown ChannelServer ${csid}`);
    } else {
      // Flag the other server as heard from, so we don't time it out, even if it neglects sending load reports
      this.getChanServData(csid).last_seen_time = this.channel_server.server_time;
    }
    let cc = this.channels_creating[channel_id];
    if (cc) {
      if (cc.created) {
        // recently created, just clean this up
        delete this.channels_creating[channel_id];
      } else {
        // currently have an outstanding request to create this channel, but it's
        // already shutting down?
        assert(false, 'lock on non-created channel');
      }
    }
    this.channels_locked[channel_id] = {
      csid,
      timestamp: Date.now(),
      cbs: [],
    };
    resp_func();
  }
  handleMasterUnlock(src, pak, resp_func) {
    let channel_id = src.channel_id;
    this.log(`unlocking ${channel_id}`);
    assert(!this.channels_creating[channel_id]);
    let cl = this.channels_locked[channel_id];
    if (!cl) {
      // timed out, and was discarded, but was still actually around?  Bad!
      assert(false, 'unlock after timeout or without lock');
    }
    delete this.channels_locked[channel_id];
    // Callers should retry sending, if the worker is still up, they'll get
    //   there, if not, we'll get a new create request.
    callEach(cl.cbs);
    resp_func();
  }

  cmdMasterWhere(worker_id, resp_func) {
    if (!worker_id) {
      return void resp_func('Missing parameter');
    }
    channelServerSendNoCreate(this, worker_id, 'where', null, null, resp_func);
  }
  cmdMasterStats(ignored, resp_func) {
    let servers = {};
    for (let csid in this.known_servers) {
      let cs = this.known_servers[csid];
      let loadv = cs.load_value + cs.load_new_estimate + cs.load_new_estimate_prev;
      servers[csid] = {
        loadv,
        load: cs.load,
        addr: cs.debug_addr,
        channels: cs.num_channels,
      };
    }
    let stats = {
      num_channels: this.total_num_channels,
      servers,
    };
    resp_func(null, stats);
  }
  cmdMasterLoad(ignored, resp_func) {
    let lines = [];
    for (let csid in this.known_servers) {
      let cs = this.known_servers[csid];
      let loadv = cs.load_value + cs.load_new_estimate + cs.load_new_estimate_prev;
      let load = cs.load;
      lines.push({
        sort: loadv,
        msg: `  ${csid}: ${loadv} (cpu=${load.cpu/10}%, hostcpu=${load.host_cpu/10}%, mem=${load.mem}MB` +
          `, osfree=${load.free_mem/10}%, msgs/s=${load.msgs_per_s})` +
          `${cs.load_over.length ? `, over:${cs.load_over.join(',')}` : ''}`,
      });
    }
    lines.sort((a,b) => a.sort - b.sort);
    lines = lines.map((a) => a.msg);
    let cc = [];
    for (let channel_type in this.total_num_channels) {
      cc.push(`${channel_type}: ${this.total_num_channels[channel_type]}`);
    }
    lines.push(`Channel counts: ${cc.join(', ')}`);
    resp_func(null, `Load Summary:\n${lines.join('\n')}`);
  }
  monitorRestart() {
    let totals = {
      get: 0,
      set: 0,
      inflight_set: 0,
      total: 0,
      no_report: 0,
      ready: 0,
    };
    for (let csid in this.known_servers) {
      let cs = this.known_servers[csid];
      ++totals.total;
      if (!cs.restart_data) {
        ++totals.no_report;
      } else {
        totals.get += cs.restart_data.get;
        totals.set += cs.restart_data.set;
        totals.inflight_set += cs.restart_data.inflight_set;
        if (!cs.restart_data.set && !cs.restart_data.inflight_set) {
          ++totals.ready;
        }
      }
    }

    let msg;
    if (totals.ready === totals.total) {
      msg = `Ready for restart: ${totals.ready} servers ready`;
      this.deploy_ready_count++;
    } else {
      msg = `${totals.ready}/${totals.total} ready, ` +
        `${totals.no_report ? `${totals.no_report} not reporting, ` : ''}` +
        `${totals.inflight_set} inflight sets, ${totals.set} new sets, ${totals.get} new gets`;
      this.deploy_ready_count = 0;
    }
    this.sendChannelMessage('channel_server', 'chat_broadcast', {
      sysadmin: 1,
      src: 'system',
      msg
    });

    this.restart_monitor_id = setTimeout(this.monitorRestart.bind(this), 1000);
  }
  cmdMasterRestarting(value, resp_func) {
    console.log('lifecycle_master_restarting');
    let new_value = value !== '0';
    this.sendChannelMessage('channel_server', 'restarting', new_value);
    resp_func(null, `Servers now ${new_value ? '' : 'not '}shutting down`);
    if (new_value && !this.restart_monitor_id) {
      this.restart_monitor_id = setTimeout(this.monitorRestart.bind(this), 1000);
    } else if (!new_value && this.restart_monitor_id) {
      clearTimeout(this.restart_monitor_id);
    }
  }
  cmdMasterRestartCountdown(value, resp_func) {
    if (!value) {
      value = '30';
    }
    let space_idx = value.indexOf(' ');
    if (space_idx === -1) {
      value += ' default';
      space_idx = value.indexOf(' ');
    }
    let seconds = Number(value.slice(0, space_idx));
    let reason = value.slice(space_idx+1);
    if (!seconds || !isFinite(seconds)) {
      return void resp_func('Invalid SECONDS parameter');
    }
    if (reason.includes(' ')) {
      // custom message, let it through
    } else {
      if (!RESTART_REASONS[reason]) {
        return void resp_func('Invalid REASON parameter: expected one of ' +
          `${Object.keys(RESTART_REASONS)}, or to include a space`);
      }
      reason = RESTART_REASONS[reason];
    }
    this.sendChannelMessage('channel_server', 'chat_broadcast', {
      src: 'system',
      msg: `Server restarting in ${seconds} ${plural(seconds, 'second')}... (${reason})`,
    });
    if (this.restart_countdown_id) {
      clearInterval(this.restart_countdown_id);
    }
    this.restart_countdown_id = setInterval(() => {
      --seconds;
      if (seconds <= 0) {
        clearInterval(this.restart_countdown_id);
        this.cmdMasterRestarting('1', nop);
      } else if (seconds <= 5 || (seconds % 10 === 0)) {
        this.sendChannelMessage('channel_server', 'chat_broadcast', {
          src: 'system',
          msg: `Server restarting in ${seconds} ${plural(seconds, 'second')}... (${reason})`,
        });
      }
    }, 1000);
    resp_func(null, 'Restart countdown started...');
  }
  cmdMasterRestartCancel(ignored, resp_func) {
    if (this.restart_countdown_id) {
      clearInterval(this.restart_countdown_id);
      resp_func(null, 'Restart countdown canceled');
    } else {
      resp_func('No restart countdown in progress');
    }
  }
  cmdMasterDeployReadyForce(value, resp_func) {
    if (value === '0') {
      this.deploy_ready_force = false;
    } else {
      this.deploy_ready_force = true;
    }
    resp_func(null, `deploy_ready_force = ${this.deploy_ready_force}`);
  }

  handleReadyQuery(src, data, resp_func) {
    let self = this;
    function reply(value, msg) {
      let log_msg = value ? `${value} (${msg})` : `(${msg})`;
      if (log_msg !== self.ready_query_last) {
        self.ready_query_last = log_msg;
        self.debug(value ? `Master reporting NOT ready: ${log_msg}` : `Master reporting READY ${log_msg}`);
      }
      resp_func(value);
    }
    if (this.restart_monitor_id) {
      return void reply('ERR_RESTARTING', 'restarting');
    }
    let { master_ready_servers, master_ready_server_time, master_ready_timeout } = serverConfig();
    let now = this.channel_server.server_time;
    if (this.master_startup_time + master_ready_timeout <= now) {
      // It's been more than the timeout, assume everything is ready, or as ready as it's going to be
      return void reply(null, 'default');
    }
    let { known_servers } = this;
    let count = 0;
    let newly_connected = 0;
    for (let csid in known_servers) {
      let cs = known_servers[csid];
      ++count;
      if (cs.first_seen_time + master_ready_server_time > now) {
        ++newly_connected;
      }
    }
    if (count - newly_connected < master_ready_servers) {
      return void reply('ERR_STARTUP', `count: ${newly_connected},${count} of ${master_ready_servers}`);
    }
    reply(null, `count: ${newly_connected},${count} of ${master_ready_servers}`);
  }

  handleDeployReadyQuery(src, data, resp_func) {
    let now = Date.now();
    if (now - this.deploy_ready_msg_time > 30*1000) {
      this.deploy_ready_msg_time = now;
      this.sendChannelMessage('channel_server', 'chat_broadcast', {
        sysadmin: 1,
        src: 'system',
        msg: 'Build system is ready to deploy!  After pushing build live on Facebook, run /master_restart_countdown 30',
      });
    }
    if (this.deploy_ready_count >= 3 || this.deploy_ready_force) {
      return resp_func(null, null);
    }
    return resp_func('ERR_NOT_READY');
  }

  cmdAdminBroadcast(msg, resp_func) {
    // let source = this.cmd_parse_source;
    if (msg.length < 5) {
      return void resp_func('Message too short');
    }
    this.sendChannelMessage('channel_server', 'chat_broadcast', {
      src: 'system',
      msg
    });
    resp_func();
  }
  cmdChannelServerReportLoad(msg, resp_func) {
    this.channel_server.load_report_time = 1;
    resp_func();
  }
  cmdEatCPU(str, resp_func) {
    str = str.split(' ');
    if (str.length !== 2) {
      return void resp_func('Invalid parameters');
    }
    let csid = str[0];
    if (csid.startsWith('channel_server.')) {
      csid = csid.slice('channel_server.'.length);
    }
    let percent = Number(str[1]);
    if (!(percent >= 0 && percent <= 100)) {
      return void resp_func('Invalid CPU percentage');
    }
    this.log(`${this.cmd_parse_source.user_id}: /eat_cpu ${csid} ${percent}`);
    this.sendChannelMessage(`channel_server.${csid}`, 'eat_cpu', { percent }, resp_func);
  }

  tick(dt) {
    let timed_out_csids;
    let count_available = 0;
    for (let csid in this.known_servers) {
      let cs = this.known_servers[csid];
      let elapsed = this.channel_server.server_time - cs.last_seen_time;
      let timeout = cs.load.cpu >= 400 ? CHANNEL_WORKER_TIMEOUT_HEAVY : CHANNEL_WORKER_TIMEOUT;
      if (elapsed >= timeout) {
        this.error(`ChannelServer ${csid} timed out, no load received recently`);
        timed_out_csids = timed_out_csids || {};
        timed_out_csids[csid] = true;
        this.numChannelsMod(cs.num_channels, -1);
        if (cs.on_has_load) {
          callEach(cs.on_has_load, cs.on_has_load = null, 'ERR_CS_TIMEOUT');
        }
        delete this.known_servers[csid];
      } else {
        if (cs.load_value < LOAD_AVAILABLE) {
          count_available++;
        }
      }
    }
    metrics.set('master.available', count_available);
    for (let channel_id in this.channels_creating) {
      let cc = this.channels_creating[channel_id];
      if (cc.created) {
        cc.created -= dt;
        if (cc.created <= 0) {
          delete this.channels_creating[channel_id];
        }
      } else if (timed_out_csids && timed_out_csids[cc.csid]) {
        // This server was just timed out, fail all requests, steal callback list
        this.warn(`Failing request to spawn ${channel_id} on ${cc.csid} due to create timeout`);
        delete this.channels_creating[channel_id];
        callEach(cc.cbs, cc.cbs = [], 'ERR_CS_TIMEOUT');
      }
    }
    if (timed_out_csids) {
      for (let channel_id in this.channels_locked) {
        let cl = this.channels_locked[channel_id];
        if (timed_out_csids[cl.csid]) {
          delete this.channels_locked[channel_id];
          // Maybe discarding the lock is not right, or, if expected, we need to check a lock id upon unlock?
          this.error(`ChannelServer ${cl.csid} timed out while worker ${channel_id} locked, discarding lock`);
          if (cl.cbs.length) {
            // This server was just timed out, fail all requests
            callEach(cl.cbs, null, 'ERR_CS_TIMEOUT');
            this.warn(`Failing request to spawn ${channel_id} on ${cl.csid} due to lock timeout`);
          }
        }
      }
    }
    this.master_stats_countdown -= dt;
    if (this.master_stats_countdown <= 0) {
      this.master_stats_countdown = MASTER_STATS_PERIOD;
      for (let channel_type in this.total_num_channels) {
        metrics.set(`master.count.${channel_type}`, this.total_num_channels[channel_type]);
      }
      this.sendChannelMessage('channel_server', 'master_stats', {
        num_channels: this.total_num_channels
      }, null, !this.channel_server.load_log);
    }
  }
}
MasterWorker.prototype.no_datastore = true;

export function init(channel_server) {
  channel_server.registerChannelWorker('master', MasterWorker, {
    autocreate: false,
    subid_regex: /^master$/,
    cmds: [{
      cmd: 'master_where',
      help: 'Identify where a worker is located',
      access_run: ['sysadmin'],
      func: MasterWorker.prototype.cmdMasterWhere,
    }, {
      cmd: 'master_stats',
      help: 'Get stats from the master worker',
      access_run: ['sysadmin'],
      func: MasterWorker.prototype.cmdMasterStats,
    }, {
      cmd: 'master_load',
      help: 'Get load summary from the master worker',
      access_run: ['sysadmin'],
      func: MasterWorker.prototype.cmdMasterLoad,
    }, {
      cmd: 'master_restart_countdown',
      help: 'Start a countdown to server restart',
      prefix_usage_with_help: true,
      usage: 'Usage: /master_restart_countdown [SECONDS] [REASON]\n' +
        '  Defaults: /master_restart_countdown 30 default\n' +
        '  REASON can be any custom string or one of the following:\n' +
        `${RESTART_REASONS_HELP}`,
      access_run: ['sysadmin'],
      func: MasterWorker.prototype.cmdMasterRestartCountdown,
    }, {
      cmd: 'master_restart_cancel',
      help: 'Cancel a restart countdown',
      access_run: ['sysadmin'],
      func: MasterWorker.prototype.cmdMasterRestartCancel,
    }, {
      cmd: 'master_restarting',
      help: 'Toggle all servers into "restarting" mode',
      access_run: ['sysadmin'],
      func: MasterWorker.prototype.cmdMasterRestarting,
    }, {
      cmd: 'master_deploy_ready_force',
      help: 'Force master to report "ready for deployment" to the build system',
      access_run: ['sysadmin'],
      func: MasterWorker.prototype.cmdMasterDeployReadyForce,
    }, {
      cmd: 'channel_server_report_load',
      help: '(Dev / single-node only) trigger an immediate load report',
      access_run: ['sysadmin'],
      func: MasterWorker.prototype.cmdChannelServerReportLoad,
    }, {
      cmd: 'eat_cpu',
      help: 'Cause a channel server to eat CPU',
      usage: '$HELP\n/eat_cpu INSTANCE_ID PERCENT',
      access_run: ['sysadmin'],
      func: MasterWorker.prototype.cmdEatCPU,
    }, {
      cmd: 'admin_broadcast',
      help: 'Broadcast a chat message to all users',
      access_run: ['sysadmin'],
      func: MasterWorker.prototype.cmdAdminBroadcast,
    }],
    handlers: {
      load: MasterWorker.prototype.handleLoad,
      worker_create_req: MasterWorker.prototype.handleWorkerCreateReq,
      monitor_restart: MasterWorker.prototype.handleMonitorRestart,
      master_lock: MasterWorker.prototype.handleMasterLock,
      master_unlock: MasterWorker.prototype.handleMasterUnlock,
      ready_query: MasterWorker.prototype.handleReadyQuery,
      deploy_ready_query: MasterWorker.prototype.handleDeployReadyQuery,
    },
  });
}

export function masterInitApp(channel_server, app, argv) {
  let ready_cache_expires = 0;
  let ready_cache_err = argv.dev ? null : 'ERR_STARTUP';
  let ready_check_in_flight = null;
  const READY_CACHE_TIME_READY = 10000;
  const READY_CACHE_TIME_UNREADY = 1000;
  function returnReadyValue(res, err, extra_data) {
    let data = { status: err || 'OK', ...extra_data };
    res.status(err ? 503 : 200).type('json').send(data);
  }
  app.get('/api/ready', function (req, res, next) {
    // Note: not necessarily called in the same process as the master worker itself
    res.header('Cache-Control', 'no-store');

    let plat = req.query.plat ?? null;
    let ver = req.query.ver ?? null;
    if (plat === null || ver === null) {
      // old clients expect a single string as the result
      res.status(503).type('text/plain').send('ERR_PROTOCOL_VERSION_OLD');
      return;
    }

    if (channel_server.restarting) {
      return void returnReadyValue(res, 'ERR_RESTARTING');
    }

    if (Date.now() > ready_cache_expires) {
      // cache expired, return old value for now, ensure we're updating the cache
      if (!ready_check_in_flight) {
        ready_check_in_flight = true;
        channel_server.sendAsChannelServer('master.master', 'ready_query', null, function (err, data) {
          ready_cache_expires = Date.now() + (err ? READY_CACHE_TIME_UNREADY : READY_CACHE_TIME_READY);
          if (err) {
            ready_cache_err = err;
            ready_check_in_flight = false;
            return;
          }
          ready_cache_err = null;
          ready_check_in_flight = false;
        });
      }
    }

    if (ready_cache_err) {
      return void returnReadyValue(res, ready_cache_err);
    }

    let { err, extra_data } = readyDataCheck(plat, ver);
    return void returnReadyValue(res, err, extra_data);
  });
  app.get('/api/deployready', function (req, res, next) {
    let expected_secret = serverConfig().deploy_ready_secret;
    if (expected_secret && req.query.secret !== expected_secret) {
      return void returnReadyValue(res, 'ERR_ACCESS_DENIED');
    }
    channel_server.sendAsChannelServer('master.master', 'deploy_ready_query', null, function (err, data) {
      returnReadyValue(res, err);
    });
  });
}
