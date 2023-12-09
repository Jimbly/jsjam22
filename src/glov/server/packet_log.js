const { perfCounterAdd } = require('glov/common/perfcounters.js');
const { min } = Math;

const PKT_LOG_SIZE = 16;
const PKT_LOG_BUF_SIZE = 32;

export function packetLogInit(receiver) {
  receiver.pkt_log_idx = 0;
  receiver.pkt_log = new Array(PKT_LOG_SIZE);
}

export function packetLog(source, pak, buf_offs, msg) {
  let receiver = this; // eslint-disable-line @typescript-eslint/no-invalid-this
  let ple = receiver.pkt_log[receiver.pkt_log_idx];
  if (!ple) {
    ple = receiver.pkt_log[receiver.pkt_log_idx] = { data: Buffer.alloc(PKT_LOG_BUF_SIZE) };
  }
  // Copy first PKT_LOG_BUF_SIZE bytes for logging
  let buf = pak.getBuffer();
  let buf_len = pak.getBufferLen();
  let total_data_len = buf_len - buf_offs;
  let data_len = min(PKT_LOG_BUF_SIZE, total_data_len);
  ple.ts = Date.now();
  ple.source = source;
  Buffer.prototype.copy.call(buf, ple.data, 0, buf_offs, buf_offs + data_len);
  ple.data_len = data_len;
  receiver.pkt_log_idx = (receiver.pkt_log_idx + 1) % PKT_LOG_SIZE;

  perfCounterAdd(`${receiver.perf_prefix}${msg}`);

  receiver.pkg_log_last_size = total_data_len;
}
