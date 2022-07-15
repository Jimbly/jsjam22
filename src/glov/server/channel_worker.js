// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/* eslint-disable import/order */
require('./must_import.js')('channel_server.js', __filename);

export let cwstats = { msgs: 0, bytes: 0 };
export let ERR_QUIET = 'ERR_QUIET';

const AUTO_DESTROY_TIME = 90000;
// How long to wait before assuming a packet was delivered and there is a chance
//   that the next packet would be sent to a new generation of the worker, and
//   therefore should be processed immediately, ignoring OOOness
export const UNACKED_PACKET_ASSUME_GOOD = AUTO_DESTROY_TIME/2; // <= AUTO_DESTROY_TIME
// How long before discarding all packet indices for a source, must be
//   significantly greater than UNACKED_PACKET_ASSUME_GOOD
const PACKET_INDEX_EXPIRE = UNACKED_PACKET_ASSUME_GOOD * 8;
const PACKET_INDEX_CLEANUP = PACKET_INDEX_EXPIRE / 4;

const ack = require('glov/common/ack.js');
const { ackHandleMessage, ackInitReceiver, ackReadHeader } = ack;
const assert = require('assert');
const { channelServerPak, channelServerSend, PAK_HINT_NEWSEQ, PAK_ID_MASK } = require('./channel_server.js');
const dot_prop = require('glov/common/dot-prop.js');
const { ERR_NOT_FOUND } = require('./exchange.js');
const { logEx } = require('./log.js');
const { min } = Math;
const { isPacket } = require('glov/common/packet.js');
const { packetLogInit, packetLog } = require('./packet_log.js');
const { callEach, empty, logdata } = require('glov/common/util.js');

// How long to wait before failing an out of order packet and running it anyway
const OOO_PACKET_FAIL_PINGS = 15; // For testing this, disable pak_new_seq below?

// Delay subsequent writes by at least 1.5 seconds
const METADATA_COMMIT_RATELIMIT = 1500;

function throwErr(err) {
  if (err) {
    console.error(`Throwing error ${err} from`, new Error().stack);
    throw err;
  }
}

// We lose all undefineds when going to and from JSON, so strip them from in-memory
// representation.
function filterUndefineds(v) {
  assert(v !== undefined);
  if (Array.isArray(v)) {
    for (let ii = 0; ii < v.length; ++ii) {
      filterUndefineds(v[ii]);
    }
  } else if (typeof v === 'object') {
    for (let key in v) {
      let subv = v[key];
      if (subv === undefined) {
        delete v[key];
      } else {
        filterUndefineds(subv);
      }
    }
  }
}

// Some data stores (FireStore) cannot handle any undefined values
function anyUndefined(walk) {
  if (walk === undefined) {
    return true;
  }
  if (Array.isArray(walk)) {
    for (let ii = 0; ii < walk.length; ++ii) {
      if (anyUndefined(walk[ii])) {
        return true;
      }
    }
  } else if (typeof walk === 'object') {
    for (let key in walk) {
      if (anyUndefined(walk[key])) {
        return true;
      }
    }
  }
  return false;
}

export function userDataMap(mapping) {
  let ret = Object.create(null);
  ret['public.display_name'] = 'ids.display_name';
  for (let key in mapping) {
    ret[key] = mapping[key];
  }
  return ret;
}

export class ChannelWorker {
  constructor(channel_server, channel_id, channel_data) {
    this.channel_server = channel_server;
    this.channel_id = channel_id;
    let m = channel_id.match(/^([^.]*)\.(.*)$/);
    assert(m);
    this.channel_type = m[1];
    this.channel_subid = m[2];
    this.ids = null; // Any extra IDs that get send along with every packet
    this.core_ids = {
      type: this.channel_type,
      id: this.channel_subid,
      channel_id,
    };
    this.pkt_idx_last_cleanup = channel_server.server_time;
    this.pkt_idx_timestamp = {}; // for each destination, the timestamp of last communication
    this.send_pkt_idx = {}; // for each destination, the last ordering ID we sent
    this.send_pkt_ackd = {}; // for each destination, the id of the last ack'd packet
    this.send_pkt_unackd = {}; // for each destination, the id and timestamp of the last packet that did not need an ack
    this.recv_pkt_idx = {}; // for each source, the last ordering ID we received
    this.pkt_queue = {}; // for each source, any queued packets that need to be dispatched in order
    this.subscribers = {}; // map of ids to { field_map } of who is subscribed to us
    this.num_subscribers = 0;
    this.store_path = `${this.channel_type}/${this.channel_id}`;

    this.bulk_store_path = `${this.channel_type}/${this.channel_subid}`;

    this.bulk_store_paths = {};
    this.shutting_down = 0;

    // This will always be an empty object with creating local channel
    assert(channel_data);
    this.data = channel_data;
    this.data.public = this.data.public || {};
    this.data.private = this.data.private || {};

    this.batched_sets = null;
    this.batched_needs_commit = false;

    this.subscribe_counts = Object.create(null); // refcount of subscriptions to other channels
    this.is_channel_worker = true; // TODO: Remove this?
    this.registered = false;
    this.need_unregister = false;
    this.adding_client = null; // The client we're in the middle of adding, don't send them state updates yet
    this.last_msg_time = Date.now();
    ackInitReceiver(this);
    // Handle modes that can be enabled via statics on prototype
    if (this.maintain_client_list) {
      this.data.public.clients = {};
    }

    packetLogInit(this);

    // Data store optimisation checks
    this.set_in_flight = false;
    this.data_awaiting_set = null;
    this.last_saved_data = '';
    this.commit_queued = false;
  }

  shutdownFinal() {
    this.shutting_down = 1;
    // Fail before finishing setting shutting_down, so any error responses can be sent (probably to stuck packets)
    ack.failAll(this);
    // Also before setting shutting_down, so it can send if it needs to
    if (this.onShutdown) {
      this.onShutdown();
    }
    this.shutting_down = 2;
    assert(!this.numSubscribers());
    assert(empty(this.subscribe_counts));
    // TODO: this unloading should be automatic / in lower layer, as it doesn't
    // make sense when the datastore is a database?

    // This check is for local filestore usage environment
    // There will not be a filestore instance created during createChannelLocal as there is no persistence
    if (!this.no_datastore) {
      this.channel_server.ds_store_meta.unload(this.store_path);
    }

    for (let path in this.bulk_store_paths) {
      this.channel_server.ds_store_bulk.unload(path);
    }
  }

  shutdownImmediate() {
    this.channel_server.removeChannelLocal(this.channel_id, true);
    this.shutdownFinal();
    // Due to async unsubscribing from the message exchange, messages may still
    //   be delivered after this, but this.shutting_down should cause them to
    //   immediately fail.
  }

  numSubscribers() {
    return this.num_subscribers;
  }

  onWhere(src, data, resp_func) {
    resp_func(null, this.channel_server.debug_addr);
  }

  defaultGetMemoryUsage() {
    return {
      data_size: {
        public: JSON.stringify(this.data.public).length,
        private: JSON.stringify(this.data.private).length,
      },
    };
  }

  // Overrideable
  getMemoryUsage() {
    return this.defaultGetMemoryUsage();
  }

  onPerfFetch(src, data, resp_func) {
    let { fields } = data;
    let ret = {
      source: this.channel_id,
    };
    if (fields.memory) {
      ret.memory = this.getMemoryUsage();
    }
    this.channel_server.onPerfFetch(ret, data);
    resp_func(null, ret);
  }

  onSubscribe(src, field_list, resp_func) {
    let { channel_id, user_id } = src;
    let is_client = src.type === 'client';
    assert(Array.isArray(field_list));

    if (is_client && this.require_login && !user_id) {
      return resp_func('ERR_LOGIN_REQUIRED');
    }
    if (this.subscribers[channel_id]) {
      // Assume we have the same field_list
      return resp_func('ERR_ALREADY_SUBSCRIBED');
    }

    let opts = {
      field_list,
      suppress_join: false, // May be modified by handleNewClient
    };
    let err = this.handleNewClient && this.handleNewClient(src, opts);
    if (err) {
      // not allowed
      return resp_func(typeof err === 'string' ? err : 'ERR_NOT_ALLOWED_BY_WORKER');
    }

    field_list = opts.field_list; // if modify by handleNewClient
    let field_map;
    if (field_list.length === 1 && field_list[0] === '*') {
      field_map = null;
    } else {
      field_map = {};
      for (let ii = 0; ii < field_list.length; ++ii) {
        let key = field_list[ii];
        // Must be in the form `public.foo`
        assert(key.startsWith('public.'), key);
        key = key.slice(7);
        assert(key);
        assert(!key.includes('.'));
        field_map[key] = true;
      }
    }

    this.subscribers[channel_id] = { field_map };
    this.num_subscribers++;
    this.adding_client = channel_id;

    let ids;
    if ((this.emit_join_leave_events || this.maintain_client_list) && is_client) {
      // Clone, not reference, we need to know the old user id for unsubscribing!
      // Also, just need these 3 ids
      ids = {
        user_id,
        client_id: src.id,
        display_name: src.display_name,
      };
    }

    if (this.emit_join_leave_events && !opts.suppress_join && is_client) {
      this.channelEmit('join', ids);
    }

    if (this.maintain_client_list && is_client) {
      if (this.getRoles) {
        let roles = {};
        if (src.sysadmin) {
          roles.sysadmin = 1;
        }
        this.getRoles(src, roles);
        ids.roles = roles;
      }
      this.setChannelData(`public.clients.${src.id}.ids`, ids);
      if (user_id) {
        this.subscribeClientToUser(src.id, user_id);
      }
    }

    this.adding_client = null;

    // 'channel_data' is really an ack for 'subscribe' - sent exactly once
    let out = this.data.public;
    if (field_map) {
      out = {};
      for (let key in field_map) {
        let v = this.data.public[key];
        if (v !== undefined) {
          out[key] = v;
        }
      }
    }
    this.sendChannelMessage(channel_id, 'channel_data', {
      public: out,
    });
    return resp_func();
  }

  autoDestroyStart() {
    let { channel_id, channel_server } = this;
    let self = this;
    this.info('Empty time expired, starting auto-destroy, locking...');
    assert(this.registered);
    this.attempting_shutdown = true;
    function unlock(next) {
      if (next) {
        self.pak('master.master', 'master_unlock').send((err) => {
          assert(!err, err);
          self.attempting_shutdown = false;
          next();
        });
      } else {
        // do *not* expect a response, we are gone.
        self.pak('master.master', 'master_unlock').send();
        self.attempting_shutdown = false;
      }
    }

    let pak = this.pak('master.master', 'master_lock');
    pak.writeAnsiString(channel_server.csuid);
    pak.send((err) => {
      assert(!err, err);
      if (!this.shouldShutdown()) {
        this.info('locked, but no longer should shutdown, unlocking...');
        unlock(() => {
          this.info('unlocked');
          self.checkAutoDestroy(); // If we're empty again, need to check in a while
        });
        return;
      }
      this.debug('locked, unregistering from exchange...');
      channel_server.exchange.unregister(channel_id, (err) => {
        channel_server.last_worker = this;
        assert(!err, err);
        if (!this.shouldShutdown()) {
          // abort!
          this.info('unregistered from exchange, but no longer should shutdown, re-registering...');
          channel_server.exchange.register(channel_id, this.handleMessage.bind(this), (err) => {
            this.info('re-registered to exchange, unlocking...');
            assert(!err, err); // master locked, so no one else should be able to create at this time
            unlock(() => {
              this.info('unlocked');
              self.checkAutoDestroy(); // If we're empty again, need to check in a while
            });
          });
          return;
        }
        // unregistered, now actually finish shutdown and let the master know to unlock us
        this.debug('unregistered, unlocking and finalizing shutdown');
        unlock();
        channel_server.removeChannelLocal(channel_id, false);
        this.shutdownFinal();
      });
    });
  }

  isEmpty() {
    return !this.num_subscribers && empty(this.pkt_queue);
  }

  shouldShutdown() {
    return this.isEmpty() && Date.now() - this.last_msg_time > AUTO_DESTROY_TIME &&
      !this.set_in_flight && !this.commit_queued;
  }

  autoDestroyCheck() {
    assert(this.auto_destroy_check);
    if (!this.isEmpty()) {
      this.auto_destroy_check = false;
      // have a subscriber now, forget about it
      return;
    }
    if (this.shouldShutdown()) {
      this.auto_destroy_check = false;
      this.autoDestroyStart();
      return;
    }
    // Continue checking
    setTimeout(this.autoDestroyCheck.bind(this), AUTO_DESTROY_TIME);
  }

  checkAutoDestroy(skip_timestamp) {
    if (!skip_timestamp) {
      this.last_msg_time = Date.now();
    }
    if (this.auto_destroy && !this.auto_destroy_check && !this.attempting_shutdown && this.isEmpty()) {
      this.auto_destroy_check = true;
      setTimeout(this.autoDestroyCheck.bind(this), AUTO_DESTROY_TIME);
    }
  }

  onUnSubscribe(src, data, resp_func) {
    let { channel_id } = src;
    let is_client = src.type === 'client';
    if (!this.subscribers[channel_id]) {
      // This can happen if a client is unsubscribing before it got the message
      // back saying its subscription attempt failed
      return void resp_func('ERR_NOT_SUBSCRIBED');
    }
    delete this.subscribers[channel_id];
    this.num_subscribers--;
    let opts = { suppress_leave: false };
    if (this.handleClientDisconnect) {
      this.handleClientDisconnect(src, opts);
    }
    if (this.emit_join_leave_events && !opts.suppress_leave && is_client) {
      this.channelEmit('leave', src);
    }

    if (this.maintain_client_list && is_client) {
      let user_id = this.getChannelData(`public.clients.${src.id}.ids.user_id`);
      this.setChannelData(`public.clients.${src.id}`, undefined);
      if (user_id) {
        this.unsubscribeOther(`user.${user_id}`);
      }
    }
    resp_func();
  }

  isSubscribedTo(other_channel_id) {
    return this.subscribe_counts[other_channel_id];
  }

  // field_list is ['*'] or ['public.foo', 'public.bar']
  subscribeOther(other_channel_id, field_list, resp_func) {
    assert(typeof field_list !== 'function'); // old API
    this.subscribe_counts[other_channel_id] = (this.subscribe_counts[other_channel_id] || 0) + 1;
    if (this.subscribe_counts[other_channel_id] !== 1) {
      this.debug(`->${other_channel_id}: subscribe - already subscribed`);
      if (resp_func) {
        resp_func();
      }
      return;
    }
    this.sendChannelMessage(other_channel_id, 'subscribe', field_list, (err, resp_data) => {
      if (err) {
        if (err === 'ERR_ALREADY_SUBSCRIBED') {
          // Do not treat this as a critical failure, the other end thinks we're
          // already subscribed, perhaps we were restarted.
          this.warn(`->${other_channel_id} subscribe failed: ${err}, ignoring`);
          err = null;
        } else {
          this.log(`->${other_channel_id} subscribe failed: ${err}`);
        }
      }
      if (err) {
        this.had_subscribe_error = true;
        if (this.subscribe_counts[other_channel_id]) { // may have already been unsubscribed, don't go negative!
          this.subscribe_counts[other_channel_id]--;
          if (!this.subscribe_counts[other_channel_id]) {
            delete this.subscribe_counts[other_channel_id];
          }
        }
        if (resp_func) {
          resp_func(err);
        } else {
          this.onError(err);
        }
      } else {
        // succeeded, nothing special
        if (resp_func) {
          resp_func();
        }
      }
    });
  }
  unsubscribeOther(other_channel_id) {
    // Note: subscribe count will already be 0 if we called .subscribeOther and
    // it failed, and then we're trying to clean up.  Also: unreliable client
    // initiated request, such as after a force_unsub message, or a bug/timing issue.
    assert(this.channel_type === 'client' || this.subscribe_counts[other_channel_id] || this.had_subscribe_error);
    if (!this.subscribe_counts[other_channel_id]) {
      this.log(`->${other_channel_id}: unsubscribe - failed: not subscribed`);
      return;
    }
    --this.subscribe_counts[other_channel_id];
    if (this.subscribe_counts[other_channel_id]) {
      this.debug(`->${other_channel_id}: unsubscribe - still subscribed (refcount)`);
      return;
    }

    delete this.subscribe_counts[other_channel_id];
    // TODO: Disable autocreate for this call?
    this.sendChannelMessage(other_channel_id, 'unsubscribe', undefined, (err, resp_data) => {
      if (err === ERR_NOT_FOUND || err && this.shutting_down) {
        // This is fine, just ignore
        // this.debug(`->${other_channel_id} unsubscribe (silently) failed: ${err}`);
      } else if (err) {
        this[this.had_subscribe_error ? 'warn' : 'error'](`->${other_channel_id} unsubscribe failed: ${err}`);
        if (!this.had_subscribe_error) {
          this.onError(err);
        }
      } else {
        // succeeded, nothing special
      }
    });
  }
  unsubscribeAll() {
    for (let channel_id in this.subscribe_counts) {
      let count = this.subscribe_counts[channel_id];
      for (let ii = 0; ii < count; ++ii) {
        this.unsubscribeOther(channel_id);
      }
    }
  }
  pak(dest, msg, ref_pak, q) {
    return channelServerPak(this, dest, msg, ref_pak, q);
  }
  setChannelDataOnOther(channel_id, key, value, resp_func) {
    let pak = this.pak(channel_id, 'set_channel_data');
    pak.writeBool(false);
    pak.writeAnsiString(key);
    pak.writeJSON(value);
    pak.send(resp_func);
  }
  onClientChanged(src, data, resp_func) {
    let { user_id } = src;
    let client_id = src.id;
    let is_client = src.type === 'client';
    assert(is_client);
    if (this.handleClientChanged) {
      this.handleClientChanged(src);
    }
    if (this.maintain_client_list && is_client && this.data.public.clients[client_id]) {
      let old_ids = this.data.public.clients[client_id].ids || {};
      if (old_ids.user_id !== user_id) {
        if (old_ids.user_id) {
          this.unsubscribeOther(`user.${old_ids.user_id}`);
        }
        if (user_id) {
          this.subscribeClientToUser(client_id, user_id);
        }
      }
      this.setChannelData(`public.clients.${client_id}.ids`, {
        user_id,
        client_id,
        display_name: src.display_name,
      });
    }
    resp_func();
  }

  subscribeClientToUser(client_id, user_id) {
    let channel_id = `user.${user_id}`;
    let field_list = [];
    if (this.user_data_map) {
      for (let key in this.user_data_map) {
        field_list.push(key);
      }
      if (this.subscribe_counts[channel_id]) {
        // already subscribed, must be able to apply user_data_map immediately
        //   from another client's data
        let existing_client;
        for (let other_client_id in this.data.public.clients) {
          let other_client = this.data.public.clients[other_client_id];
          if (other_client_id !== client_id && other_client.ids.user_id === user_id) {
            existing_client = other_client;
            break;
          }
        }
        if (existing_client) {
          let client = this.data.public.clients[client_id];
          for (let key in this.user_data_map) {
            let mapped = this.user_data_map[key];
            let value = existing_client[mapped];
            if (value) {
              this.setChannelData(`public.clients.${client_id}.${mapped}`, value);
            } else if (client[mapped]) {
              this.setChannelData(`public.clients.${client_id}.${mapped}`, undefined);
            }
          }
        } // else, okay?
      }
    }
    this.subscribeOther(channel_id, field_list);
  }

  // data is a { key, value } pair of what has changed
  onApplyChannelData(source, data) {
    if (this.maintain_client_list) {
      let mapped = this.user_data_map && this.user_data_map[data.key];
      if (source.type === 'user' && mapped) {
        for (let client_id in this.data.public.clients) {
          let client_ids = this.data.public.clients[client_id].ids;
          if (client_ids && client_ids.user_id === source.id) {
            this.setChannelData(`public.clients.${client_id}.${mapped}`, data.value);
          }
        }
      }
    }
  }

  // data is the channel's entire (public) data sent in response to a subscribe
  onChannelData(source, data) {
    if (this.maintain_client_list) {
      if (source.type === 'user') {
        for (let client_id in this.data.public.clients) {
          let client_ids = this.data.public.clients[client_id].ids;
          if (client_ids && client_ids.user_id === source.id) {
            for (let key in this.user_data_map) {
              let value = dot_prop.get(data, key);
              if (value) {
                let mapped = this.user_data_map[key];
                this.setChannelData(`public.clients.${client_id}.${mapped}`, value);
              }
            }
          }
        }
      }
    }
  }

  onBroadcast(source, data, resp_func) {
    if (typeof data !== 'object' || typeof data.data !== 'object' || typeof data.msg !== 'string') {
      return resp_func('ERR_INVALID_DATA');
    }
    if (data.err) { // From a filter
      return resp_func(data.err);
    }
    // Replicate to all users
    data.data.client_ids = source;
    this.channelEmit(data.msg, data.data);
    return resp_func();
  }

  onCmdParse(source, data, resp_func) {
    this.cmd_parse_source = source;
    if (this.getRoles) {
      let client_id = source.id;
      this.access = this.getChannelData(`public.clients.${client_id}.ids.roles`, {});
    } else {
      this.access = source; // for cmd_parse access checking rules
    }
    this.cmd_parse.handle(this, data, resp_func);
  }

  onCmdParseAuto(source, pak, resp_func) {
    let cmd = pak.readString();
    let access = pak.readJSON();
    this.cmd_parse_source = source;
    if (access) {
      // Maybe want to use the clients.foo.ids.roles access of the initiator?
      this.access = access;
    } else if (this.getRoles) {
      let client_id = source.id;
      this.access = this.getChannelData(`public.clients.${client_id}.ids.roles`, {});
    } else {
      this.access = source; // for cmd_parse access checking rules
    }
    this.cmd_parse.handle(this, cmd, (err, resp) => {
      if (err && this.cmd_parse.was_not_found) {
        return resp_func(null, { found: 0, err });
      }
      return resp_func(err, { found: 1, resp });
    });
  }

  channelEmit(msg, data, except_client) {
    let count = 0;
    let was_q = false;
    if (data && typeof data === 'object') {
      was_q = data.q;
      data.q = 1;
    }
    for (let channel_id in this.subscribers) {
      if (channel_id === except_client) {
        continue;
      }
      ++count;
      this.sendChannelMessage(channel_id, msg, data);
    }
    if (count && !was_q) {
      this.debug(`broadcast(${count}): ${msg} ${logdata(data)}`);
    }
  }

  onSetChannelDataIf(source, pak, resp_func) {
    if (source.type === 'client') {
      // deny
      return resp_func('ERR_NOT_ALLOWED');
    }
    let q = false;
    let key = pak.readAnsiString();
    let value = pak.readJSON();
    let set_if = pak.readJSON();
    let old_value = dot_prop.get(this.data, key);
    if (old_value !== set_if) {
      return resp_func('ERR_SETIF_MISMATCH');
    }
    this.setChannelDataInternal(source, key, value, q);
    return resp_func();
  }

  onFlush(fn) {
    if (!this.on_flush) {
      this.on_flush = [];
    }
    this.on_flush.push(fn);
  }

  commitData() {
    // delay the commit until next frame, so multiple call of setChannelData get
    //   batched into a single atomic database write
    if (this.commit_queued) {
      return;
    }
    this.commit_queued = true;
    process.nextTick(() => {
      this.commit_queued = false;
      this.commitDataActual();
    });
  }

  commitDataActual() {
    const self = this;
    let data = this.data;

    if (this.maintain_client_list) {
      data = {};
      for (let key in this.data) {
        data[key] = this.data[key];
      }
      let public_data = data.public;
      assert(public_data);
      let pd = {};
      for (let key in public_data) {
        if (key !== 'clients') {
          pd[key] = public_data[key];
        }
      }
      data.public = pd;
    }

    if (anyUndefined(data)) {
      this.log('Undefined value found in channel data:', data);
      assert(false, 'Undefined value found in channel data');
    }

    // Mark this data as awaiting to be set
    this.data_awaiting_set = data;

    // Make sure no more than one write is in flight to avoid corrupted/overlapped data
    if (this.set_in_flight) {
      return;
    }

    // Set data to store along with setting checks to make sure no more than one sets are in flight
    function safeSet() {
      const incoming_data = self.data_awaiting_set;
      const data_to_compare = JSON.stringify(incoming_data);
      self.data_awaiting_set = null;

      // Do not write to datastore if nothing has changed
      if (data_to_compare === self.last_saved_data) {
        return;
      }

      self.last_saved_data = data_to_compare;
      self.set_in_flight = true;
      let on_flush;
      if (self.on_flush) {
        on_flush = self.on_flush;
        self.on_flush = null;
      }

      self.channel_server.ds_store_meta.setAsync(self.store_path, incoming_data, function (err) {
        // Delay the next write
        setTimeout(function () {
          self.set_in_flight = false;

          // data in memory was updated again in mid flight so we need to set to store again with the new data
          if (self.data_awaiting_set) {
            safeSet();
          }
        }, METADATA_COMMIT_RATELIMIT);
        if (err) {
          throwErr(err);
        }
        if (on_flush && !err) {
          // We should absolutely never get an error here, but if we do, these
          //   on_flush callbacks will never be called.
          callEach(on_flush, null, err);
        }
      });
    }

    safeSet();
  }

  emitApplyChannelData(data) {
    let { key } = data;
    assert(key);
    assert(key.startsWith('public'));
    key = key.slice(7);
    // assert(key); No - key can be === 'public'

    let count = 0;
    let was_q = false;
    if (typeof data === 'object') {
      was_q = data.q;
      data.q = 1;
    }
    for (let channel_id in this.subscribers) {
      if (channel_id === this.adding_client) {
        continue;
      }
      let { field_map } = this.subscribers[channel_id];
      if (!field_map || field_map[key]) {
        ++count;
        this.sendChannelMessage(channel_id, 'apply_channel_data', data);
      }
    }
    if (count && !was_q) {
      this.debug(`broadcast(${count}): apply_channel_data ${logdata(data)}`);
    }
  }

  onSetChannelDataPush(source, pak, resp_func) {
    let q = false;
    let key = pak.readAnsiString();
    let value = pak.readJSON();
    let err = this.handleSetChannelData ?
      this.handleSetChannelData(source, key, value) :
      this.defaultHandleSetChannelData(source, key, value);
    if (err) {
      // denied by app_worker
      if (err === ERR_QUIET) {
        this.debug(`set_channel_data_push on ${key} from ${source.channel_id}` +
          ` failed handleSetChannelData() check: ${err}`);
        return resp_func();
      } else {
        this.log(`set_channel_data_push on ${key} from ${source.channel_id}` +
          ` failed handleSetChannelData() check: ${err}`);
        return resp_func(err);
      }
    }
    assert(value);
    filterUndefineds(value);
    let arr = dot_prop.get(this.data, key);
    let need_create = !arr;
    if (need_create) {
      arr = [];
    }
    if (!Array.isArray(arr)) {
      return resp_func('ERR_NOT_ARRAY');
    }

    let idx = arr.push(value) - 1;
    if (need_create) {
      dot_prop.set(this.data, key, arr);
    } else {
      // array was modified in-place
    }
    // only send public changes
    if (key.startsWith('public.')) {
      let mod_data;
      if (need_create) {
        mod_data = { key, value: arr, q };
      } else {
        mod_data = { key: `${key}.${idx}`, value, q };
      }
      this.emitApplyChannelData(mod_data);
    }
    this.commitData();
    return resp_func();
  }

  onSetChannelData(source, pak, resp_func) {
    let q = pak.readBool();
    let key = pak.readAnsiString();
    let value = pak.readJSON();
    this.setChannelDataInternal(source, key, value, q, resp_func);
  }
  setChannelData(key, value, q) {
    this.setChannelDataInternal(this.core_ids, key, value, q);
  }

  onGetChannelData(source, data, resp_func) {
    // Do not deny this here, this is blocked by the allow_client_direct map
    // We want the client_comm functions to send this message if needed.
    // if (source.type === 'client') {
    //   // deny
    //   return resp_func('ERR_NOT_ALLOWED');
    // }
    return resp_func(null, this.getChannelData(data));
  }

  defaultHandleSetChannelData(source, key, value) {
    if (source.type !== 'client' || !source.direct) {
      // from another channel, or not directly from the user, accept it
      return null;
    }
    // Do not allow modifying of other users' client data
    if (key.startsWith('public.clients.')) {
      if (!key.startsWith(`public.clients.${source.id}.`)) {
        return 'ERR_INVALID_KEY';
      }
      // Do not allow modifying of clients that do not exist
      if (!this.data.public.clients[source.id]) {
        return 'ERR_NO_CLIENT';
      }
      return null;
    }
    // permissive_client_set default false - don't let clients change anything other than their own data
    return this.permissive_client_set ? null : 'ERR_INVALID_KEY';
  }

  sendChannelDataBatched(key, value) {
    let arr = this.batched_sets;
    if (!arr) {
      arr = this.batched_sets = [];
    }
    if (key.startsWith('public')) {
      let pair = [key.slice(7)];
      if (value !== undefined) {
        pair.push(value);
      }
      arr.push(pair);
    }
    if (!this.maintain_client_list || !key.startsWith('public.clients.')) {
      this.batched_needs_commit = true;
    }
  }

  setChannelDataBatched(key, value) {
    if (value === undefined) {
      dot_prop.delete(this.data, key);
    } else {
      filterUndefineds(value);
      dot_prop.set(this.data, key, value);
    }
    this.sendChannelDataBatched(key, value);
  }

  setChannelDataBatchedFlush() {
    assert(this.batched_sets);
    if (this.batched_needs_commit) {
      this.commitData();
    }

    let arr = this.batched_sets;
    if (arr.length) {
      let count = 0;
      for (let channel_id in this.subscribers) {
        let { field_map } = this.subscribers[channel_id];
        let to_send;
        if (!field_map) {
          to_send = arr;
        } else {
          to_send = [];
          for (let ii = 0; ii < arr.length; ++ii) {
            let pair = arr[ii];
            let key = pair[0];
            if (field_map[key]) {
              to_send.push(pair);
            }
          }
        }
        if (to_send.length) {
          arr.q = 1;
          this.sendChannelMessage(channel_id, 'batch_set', arr);
          ++count;
        }
      }
      if (count) {
        this.debug(`broadcast(${count}): batch_set ${logdata(arr)}`);
      }
    }

    this.batched_sets = null;
    this.batched_needs_commit = false;
  }

  setChannelDataInternal(source, key, value, q, resp_func) {
    assert(typeof key === 'string');
    assert(typeof source === 'object');
    let err = this.handleSetChannelData ?
      this.handleSetChannelData(source, key, value) :
      this.defaultHandleSetChannelData(source, key, value);
    if (err) {
      // denied by app_worker
      if (err === ERR_QUIET) {
        this.debug(`setChannelData on ${key} from ${source.channel_id} failed handleSetChannelData() check: ${err}`);
        if (resp_func) {
          resp_func();
        }
      } else {
        this.log(`setChannelData on ${key} from ${source.channel_id} failed handleSetChannelData() check: ${err}`);
        if (resp_func) {
          resp_func(err);
        }
      }
      return;
    }

    if (value === undefined) {
      dot_prop.delete(this.data, key);
    } else {
      filterUndefineds(value);
      dot_prop.set(this.data, key, value);
    }
    // only send public changes
    if (key.startsWith('public')) {
      let data = { key, value };
      if (q) {
        data.q = 1;
      }
      this.emitApplyChannelData(data);
    }
    if (!this.maintain_client_list || !key.startsWith('public.clients.')) {
      this.commitData();
    }
    if (resp_func) {
      resp_func();
    }
  }
  getChannelData(key, default_value) {
    return dot_prop.get(this.data, key, default_value);
  }

  getBulkChannelData(obj_name, default_value, cb) {
    let bulk_obj_name = `${this.bulk_store_path}/${obj_name}`;
    this.bulk_store_paths[bulk_obj_name] = true;
    this.channel_server.ds_store_bulk.getAsync(bulk_obj_name, default_value, cb);
  }
  getBulkChannelBuffer(obj_name, cb) {
    let bulk_obj_name = `${this.bulk_store_path}/${obj_name}`;
    this.bulk_store_paths[bulk_obj_name] = true;
    this.channel_server.ds_store_bulk.getAsyncBuffer(bulk_obj_name, cb);
  }
  setBulkChannelData(obj_name, value, cb) {
    let bulk_obj_name = `${this.bulk_store_path}/${obj_name}`;
    this.bulk_store_paths[bulk_obj_name] = true;
    this.channel_server.ds_store_bulk.setAsync(bulk_obj_name, value, cb || throwErr);
  }
  setBulkChannelBuffer(obj_name, value, cb) {
    assert(Buffer.isBuffer(value));
    let bulk_obj_name = `${this.bulk_store_path}/${obj_name}`;
    this.bulk_store_paths[bulk_obj_name] = true;
    this.channel_server.ds_store_bulk.setAsync(bulk_obj_name, value, cb || throwErr);
  }

  sendChannelMessage(dest, msg, data, resp_func, q) {
    channelServerSend(this, dest, msg, null, data, resp_func, q);
  }

  // source has at least { channel_id, type, id }, possibly also .user_id and .display_name if type === 'client'
  channelMessage(source, msg, data, resp_func) {
    function onError(err) {
      if (isPacket(data) && !data.ended()) {
        data.pool();
      }
      resp_func(err);
    }
    if (source.direct) {
      // Ensure this is allowed directly from clients
      if (!this.allow_client_direct[msg]) {
        if (!this.handlers[msg]) {
          return void onError(`No handler registered for '${msg}'`);
        } else {
          return void onError(`ERR_CLIENT_DIRECT (${msg})`);
        }
      }
      // Ensure the client was allowed to subscribe to this worker
      if (!this.subscribers[source.channel_id] && this.require_subscribe) {
        return void onError('ERR_NOT_SUBSCRIBED');
      }
    }
    let had_handler = false;
    assert(resp_func);
    if (this.filters[msg]) {
      this.filters[msg].call(this, source, data);
      had_handler = true;
    }
    if (this.handlers[msg]) {
      this.handlers[msg].call(this, source, data, resp_func);
    } else if (this.onUnhandledMessage) {
      this.onUnhandledMessage(source, msg, data, resp_func);
    } else {
      // No user handler for this message
      if (had_handler) {
        // But, we had a filter (probably something internal) that dealt with it, silently continue;
        onError();
      } else {
        onError(`No handler registered for '${msg}'`);
      }
    }
  }

  onError(msg) {
    this.error(msg);
  }

  ctx() {
    // *not* using a static `context`, as it gets merged into
    let ctx = {};
    ctx[this.channel_type] = this.channel_subid;
    return ctx;
  }

  debug(...args) {
    logEx(this.ctx(), 'debug', `${this.channel_id}:`, ...args);
  }

  info(...args) {
    logEx(this.ctx(), 'info', `${this.channel_id}:`, ...args);
  }

  log(...args) {
    logEx(this.ctx(), 'log', `${this.channel_id}:`, ...args);
  }

  warn(...args) {
    logEx(this.ctx(), 'warn', `${this.channel_id}:`, ...args);
  }

  error(...args) {
    logEx(this.ctx(), 'error', `${this.channel_id}:`, ...args);
  }


  ctxSrc(src) {
    // *not* using a static `context`, as it gets merged into
    let ctx = {};
    ctx[this.channel_type] = this.channel_subid;
    if (src.user_id) {
      ctx.user_id = src.user_id;
    }
    if (src.type && src.type !== this.channel_type) {
      ctx[src.type] = src.id;
    }
    // Also add display_name?
    return ctx;
  }

  debugSrc(src, ...args) {
    logEx(this.ctxSrc(src), 'debug', `${this.channel_id}:`, ...args);
  }

  infoSrc(src, ...args) {
    logEx(this.ctxSrc(src), 'info', `${this.channel_id}:`, ...args);
  }

  logSrc(src, ...args) {
    logEx(this.ctxSrc(src), 'log', `${this.channel_id}:`, ...args);
  }

  warnSrc(src, ...args) {
    logEx(this.ctxSrc(src), 'warn', `${this.channel_id}:`, ...args);
  }

  errorSrc(src, ...args) {
    logEx(this.ctxSrc(src), 'error', `${this.channel_id}:`, ...args);
  }

  // Wraps `resp_func` so that it logs upon completion or failure
  loggedResponse(source, resp_func, log_msg) {
    return (err, payload) => {
      if (err) {
        this.logSrc(source, `${log_msg}: failed: ${err}`);
      } else {
        this.logSrc(source, `${log_msg}: success`);
      }
      resp_func(err, payload);
    };
  }

  // Default error handler
  handleError(src, data, resp_func) {
    this.onError(`Unhandled error from ${src.type}.${src.id}: ${data}`);
    resp_func();
  }

  checkPacketQueue(source) {
    let q_data = this.pkt_queue[source];
    if (!q_data) {
      return null;
    }
    let q = q_data.pkts;
    let next_idx = ((this.recv_pkt_idx[source] || 0) + 1) & PAK_ID_MASK;
    let next = q[next_idx];
    if (next) {
      // Next one is ready to go now!
      this.info(`Delayed dispatching OOO packet with ID ${next_idx} from ${source}.`);
      delete q[next_idx];
      if (empty(q)) {
        if (q_data.tid) {
          clearTimeout(q_data.tid);
        }
        delete this.pkt_queue[source];
      }
      return [next_idx, next.source, next.pak];
    }
    return null;
  }

  startPacketQueueCheck(source) {
    let q_data = this.pkt_queue[source];
    assert(q_data);
    assert(!q_data.tid);
    q_data.start_pings = this.channel_server.exchange_pings;
    q_data.tid = setTimeout(this.checkPacketQueueTimeout.bind(this, source), (OOO_PACKET_FAIL_PINGS + 1) * 1000);
    // Could also send a ping here and fulfill this timeout when it comes back, but
    // a ping is not guaranteed to arrive after all packets, since if there
    // are multiple sources sending packets, one (that does not do the create)
    // may still be trying to resend the initial packet (waiting on their (going
    // to fail) create to finish) when the ping makes it. Could send a more
    // complicated "request for flush to target" that doesn't return until all
    // retries are sent, and that would do it.
    // Instead, now, timeout is proportional to exchange pings, should reflect any
    // delays going on, as long as the delays are affecting our processes as well.
  }

  checkPacketQueueTimeout(source) {
    let q_data = this.pkt_queue[source];
    q_data.tid = null;
    let elapsed_pings = this.channel_server.exchange_pings - q_data.start_pings;
    if (elapsed_pings < OOO_PACKET_FAIL_PINGS) {
      // timeout finished, but the expected number of pings has not occurred, delay until it does
      q_data.tid = setTimeout(this.checkPacketQueueTimeout.bind(this, source),
        (OOO_PACKET_FAIL_PINGS + 1 - elapsed_pings) * 1000);
      return;
    }

    let q = q_data.pkts;
    assert(!empty(q));
    let oldest_pkt_id = Infinity;
    for (let pkt_id in q) {
      oldest_pkt_id = min(oldest_pkt_id, Number(pkt_id));
    }
    let next_idx = oldest_pkt_id;
    let expected_idx = ((this.recv_pkt_idx[source] || 0) + 1) & PAK_ID_MASK;
    let next = q[next_idx];
    this.error(`Time expired. Running queued OOO packet with ID ${
      next_idx} (expected ${expected_idx}) from ${source}.`);
    delete q[next_idx];
    if (empty(q)) {
      delete this.pkt_queue[source];
    }
    this.dispatchPacket(next_idx, next.source, next.pak);
    // also dispatches any sequential queued up, and may clear/invalidate q_data
    if (this.pkt_queue[source]) {
      // still have remaining, non-sequential packets (untested, unexpected)
      this.error(`Still remaining packets from ${source}. Queuing...`);
      this.startPacketQueueCheck(source);
    }
  }

  dispatchPacketError(source, pak) {
    /*let ids = */pak.readJSON();
    let net_data = ackReadHeader(pak);
    let { msg, pak_id } = net_data;
    let expecting_response = Boolean(pak_id);
    if (expecting_response) {
      // Can't easily send a response - channelServerSend will assert that we're not shutting down
      // In practice this happens only incredibly rarely and ignoring the message should be
      // almost as good as responding with an error.  Maybe add a channelServerSendPostShutdown()
      // if we see this black-holed something important?
      // this.info(`received packet after shutdown, msg=${msg} from ${source}, returning ERR_TERMINATED`);
      // channelServerSend(this, source, pak_id, 'ERR_TERMINATED');
      this.warn(`received packet after shutdown, msg=${msg} (expecting response) from ${source}, ignoring`);
    } else if (typeof msg === 'number') {
      // this is a response, totally common, happens on responses to every last-moment `unsubscribe`
    } else {
      this.info(`received packet after shutdown, msg=${msg} from ${source}, ignoring`);
    }
  }

  dispatchPacketInternal(pkt_idx, source, pak) {
    let ids = pak.readJSON() || {};
    let split = source.split('.');
    assert.equal(split.length, 2);
    ids.type = split[0];
    ids.id = split[1];
    ids.channel_id = source;

    let channel_worker = this;
    let { channel_server } = channel_worker;
    channel_server.last_worker = channel_worker;
    if (pkt_idx !== -1) { // not a broadcast
      channel_worker.pkt_idx_timestamp[source] = channel_server.server_time;
      channel_worker.recv_pkt_idx[source] = pkt_idx;
    }
    try {
      ackHandleMessage(channel_worker, source, pak, function sendFunc(msg, err, data, resp_func) {
        channelServerSend(channel_worker, source, msg, err, data, resp_func);
      }, function packFunc(msg, ref_pak) {
        return channelServerPak(channel_worker, source, msg, ref_pak);
      }, function handleFunc(msg, data, resp_func) {
        channel_worker.channelMessage(ids, msg, data, resp_func);
      });
    } catch (e) {
      e.source = ids;
      this.errorSrc(ids, `Exception while handling packet from "${source}"`);
      let buf = pak.getBuffer();
      let max_len = min(pak.getBufferLen(), 4*1024*1024);
      for (let offs = 0; offs < max_len; offs+=65536) {
        let end = min(offs + 65536, max_len);
        this.errorSrc(ids, `Packet data (base64,${offs}-${end}) = ${Buffer.from(buf).toString('base64', offs, end)}`);
      }
      this.errorSrc(ids, `Packet data (utf8,1K) = ${JSON.stringify(
        Buffer.from(pak.getBuffer()).toString('utf8', 0, min(max_len, 1000)))}`);
      channel_server.handleUncaughtError(e);
    }
  }

  dispatchPacket(pkt_idx, source, pak) {
    while (true) {
      this.dispatchPacketInternal(pkt_idx, source, pak);
      if (pkt_idx === -1) {
        break;
      }
      let next = this.checkPacketQueue(source);
      if (!next) {
        break;
      }
      [pkt_idx, source, pak] = next;
    }
  }

  handleMessage(pak) {
    ++cwstats.msgs;
    cwstats.bytes += pak.totalSize();
    let channel_worker = this;
    pak.readFlags();
    // source is a string channel_id
    let pkt_idx = pak.readU32();
    let pak_new_seq = pkt_idx & PAK_HINT_NEWSEQ;
    pkt_idx &= PAK_ID_MASK;
    let source = pak.readAnsiString();

    if (this.shutting_down) {
      // We're already shut down, just still getting cleaned up, return failure
      return void this.dispatchPacketError(source, pak);
    }

    // assert(pkt_idx); not true after wrapping (doesn't look like anything cares other than this assert?)
    let expected_idx = ((this.recv_pkt_idx[source] || 0) + 1) & PAK_ID_MASK;
    function dispatch() {
      channel_worker.dispatchPacket(pkt_idx, source, pak);
    }
    if (pkt_idx === expected_idx) {
      dispatch();
    } else if (pak_new_seq) {
      // this.debug(`Received new initial packet with ID ${pkt_idx} ` +
      //   `(expected >=${expected_idx}) from ${source}, flagged as new_seq, dispatching...`);
      dispatch();
    } else {
      this.info(`Received OOO packet with ID ${pkt_idx
      } (expected ${expected_idx}) from ${source}. Queuing...`);
      let q_data = channel_worker.pkt_queue[source] = channel_worker.pkt_queue[source] || { pkts: {} };
      q_data.pkts[pkt_idx] = { source, pak };
      if (!q_data.tid) {
        this.startPacketQueueCheck(source);
      }
    }
    this.checkAutoDestroy(source === 'master.master');
  }

  cleanupPktIndices() {
    // Using relative server time (server_time) instead of absolute time
    //   (last_tick_timestamp) because otherwise any debugger stall
    //   guarantees packet ordering to get totally messed up.
    //   As a trade-off, if one server is stalling *significantly* more (more than
    //   50% of time lost) two servers may send confused packet indices to each other.
    let timestamp = this.channel_server.server_time;
    if (timestamp - this.pkt_idx_last_cleanup < PACKET_INDEX_CLEANUP) {
      return;
    }
    this.pkt_idx_last_cleanup = timestamp;
    let expire = timestamp - PACKET_INDEX_EXPIRE;
    for (let channel_id in this.pkt_idx_timestamp) {
      let other_time = this.pkt_idx_timestamp[channel_id];
      if (other_time < expire) {
        // It's been long enough that any packets in either direction will, long since, have
        // PAK_HINT_NEWSEQ, so, we have no reason to keep this tracking information
        // around.
        delete this.pkt_idx_timestamp[channel_id];
        delete this.recv_pkt_idx[channel_id];
        delete this.send_pkt_idx[channel_id];
        delete this.send_pkt_ackd[channel_id];
        delete this.send_pkt_unackd[channel_id];
      }
    }
  }

  // Like handleMessage, but does not require OOO queuing, for broadcast-queues
  //   that do not have any retransmission mechanism
  handleMessageBroadcast(pak) {
    let channel_worker = this;
    pak.readFlags();
    /*let pkt_idx = */pak.readU32();/* & PAK_ID_MASK;*/
    let source = pak.readAnsiString();
    channel_worker.dispatchPacket(-1, source, pak);
  }

  aquireResourceAsync(resource_id, callback) {
    assert(resource_id);
    assert(callback);

    if (!this.locked_resource_ids) {
      this.locked_resource_ids = Object.create(null);
    }

    let callbacks = this.locked_resource_ids[resource_id];

    let released = false;
    let release_callback = () => {
      assert(!released);
      released = true;

      if (callbacks.length === 0) {
        delete this.locked_resource_ids[resource_id];
      } else {
        this.debug(`Handling pending request to aquire resource ${resource_id}`);
        let pending_callback = callbacks.shift();
        pending_callback();
      }
    };
    // The prepared callback will call the original callback with the release callback as its argument
    let prepared_callback = callback.bind(this, release_callback);

    if (callbacks) {
      this.debug(`Queuing request to aquire resource ${resource_id}, it is currently aquired.`);
      callbacks.push(prepared_callback);
    } else {
      callbacks = this.locked_resource_ids[resource_id] = [];
      prepared_callback();
    }
  }
}
ChannelWorker.prototype.logPacketDispatch = packetLog;
// Overrideable by child class's prototype
ChannelWorker.prototype.maintain_client_list = false;
ChannelWorker.prototype.emit_join_leave_events = false;
ChannelWorker.prototype.require_login = false;
ChannelWorker.prototype.require_subscribe = true; // Clients must subscribe to send a direct message
ChannelWorker.prototype.auto_destroy = false;
ChannelWorker.prototype.permissive_client_set = false; // allow clients to set arbitrary data
ChannelWorker.prototype.allow_client_direct = {}; // default: none; but use client_handlers to more easily fill this
ChannelWorker.prototype.no_datastore = false; // always assume datastore usage
ChannelWorker.prototype.user_data_map = userDataMap({});
