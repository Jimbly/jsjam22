import assert from 'assert';
import { ChannelWorker } from './channel_worker.js';
import { serverGlobalsHandleChannelData, serverGlobalsInit } from './server_globals';

export class ChannelServerWorker extends ChannelWorker {
  constructor(channel_server, channel_id, channel_data) {
    super(channel_server, channel_id, channel_data);
    serverGlobalsInit(this);
    channel_server.whenReady(this.subscribeOther.bind(this, 'global.global', ['*']));
  }

  // data is a { key, value } pair of what has changed
  onApplyChannelData(source, data) {
    if (source.type === 'global') {
      serverGlobalsHandleChannelData(data.key, data.value);
    }
  }

  // data is the channel's entire (public) data sent in response to a subscribe
  onChannelData(source, data) {
    if (source.type === 'global') {
      serverGlobalsHandleChannelData('', data);
    }
  }

}
// Returns a function that forwards to a method of the same name on the ChannelServer
function channelServerBroadcast(name) {
  return (ChannelServerWorker.prototype[name] = function (src, data, resp_func) {
    assert(!resp_func.expecting_response); // this is a broadcast
    this.channel_server[name](data);
  });
}
function channelServerHandler(name) {
  return (ChannelServerWorker.prototype[name] = function (src, data, resp_func) {
    this.channel_server[name](data, resp_func);
  });
}

ChannelServerWorker.prototype.no_datastore = true; // No datastore instances created here as no persistence is needed

export function channelServerWorkerInit(channel_server) {
  channel_server.registerChannelWorker('channel_server', ChannelServerWorker, {
    autocreate: false,
    subid_regex: /^[a-zA-Z0-9-]+$/,
    handlers: {
      worker_create: channelServerHandler('handleWorkerCreate'),
      master_startup: channelServerBroadcast('handleMasterStartup'),
      master_stats: channelServerBroadcast('handleMasterStats'),
      restarting: channelServerBroadcast('handleRestarting'),
      chat_broadcast: channelServerBroadcast('handleChatBroadcast'),
      ping: channelServerBroadcast('handlePing'),
      eat_cpu: channelServerHandler('handleEatCPU'),
    },
    filters: {
      // note: these do *not* override the one on ChannelWorker.prototype, both
      // would be called via `filters` (if maintain_client_list were set)
      channel_data: ChannelServerWorker.prototype.onChannelData,
      apply_channel_data: ChannelServerWorker.prototype.onApplyChannelData,
    },
  });
}
