const { ChannelWorker } = require('glov/server/channel_worker.js');
const { handleChat, handleChatGet } = require('glov/server/chattable_worker.js');

class TestWorker extends ChannelWorker {
  // constructor(channel_server, channel_id, channel_data) {
  //   super(channel_server, channel_id, channel_data);
  // }
  handleBinGet(src, pak, resp_func) {
    let resp = resp_func.pak();
    resp.writeBuffer(this.test_bin || new Uint8Array(0));
    resp.send();
  }
  handleBinSet(src, pak, resp_func) {
    let buf = pak.readBuffer(false);
    if (buf.length > 100) {
      return void resp_func('Too big');
    }
    this.test_bin = buf;
    resp_func();
  }
}
TestWorker.prototype.maintain_client_list = true;
TestWorker.prototype.emit_join_leave_events = true;
TestWorker.prototype.require_login = false;
TestWorker.prototype.auto_destroy = true;

export function init(channel_server) {
  channel_server.registerChannelWorker('test', TestWorker, {
    autocreate: true,
    subid_regex: /^.+$/,
    client_handlers: {
      bin_get: TestWorker.prototype.handleBinGet,
      bin_set: TestWorker.prototype.handleBinSet,
      chat: handleChat,
      chat_get: handleChatGet,
    },
  });
}
