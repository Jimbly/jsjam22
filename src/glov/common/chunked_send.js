// Portions Copyright 2020 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');
const { asyncParallelLimit, asyncSeries } = require('glov-async');
const crc32 = require('./crc32.js');
const { ceil, min } = Math;
const { packetBufPoolAlloc, packetBufPoolFree } = require('./packet.js');

// combined size of all chunked sends at any given time
export const MAX_CLIENT_UPLOAD_SIZE = 2*1024*1024;

const CHUNK_SIZE = 8192 - 100; // Should fit in a 8kb packet after headers and such; used by sender only

function cleanupFile(state, file_id, pool) {
  let file_data = state.files[file_id];
  if (file_data.dv) {
    // Pool?
    packetBufPoolFree(file_data.dv);
    delete file_data.dv;
  }
  state.buffer_size -= file_data.length;
  assert(state.buffer_size >= 0);
  delete state.files[file_id];
}

export function chunkedReceiverInit(name, max_buffer_size) {
  return {
    name,
    max_buffer_size,
    last_file_id: 0,
    buffer_size: 0,
    files: {},
  };
}

export function chunkedReceiverCleanup(state) {
  if (!state || !state.files) {
    return;
  }
  for (let file_id in state.files) {
    cleanupFile(state, file_id);
  }
}

export function chunkedReceiverFreeFile(container) {
  let { buffer, dv } = container;
  assert(buffer);
  assert(dv);
  packetBufPoolFree(dv);
  delete container.buffer;
}

export function chunkedReceiverGetFile(state, file_id) {
  if (!state) {
    return { err: 'ERR_NOT_INITIALIZED' };
  }
  function err(msg) {
    console.error(`${state.name}: chunkedReceiverGetFile(${file_id}): ${msg}`);
    return { err: msg };
  }
  if (!state.files) {
    return err('ERR_FILE_NOT_FOUND');
  }
  let file_data = state.files[file_id];
  if (!file_data) {
    return err('ERR_FILE_NOT_FOUND');
  }
  if (!file_data.finished) {
    cleanupFile(state, file_id);
    return err('ERR_UPLOAD_UNFINISHED');
  }
  let { dv, mime_type, length } = file_data;
  file_data.buffer = null;
  file_data.dv = null;
  cleanupFile(state, file_id);
  let buffer = new Uint8Array(dv.buffer, dv.byteOffset, length);
  return {
    dv,
    mime_type,
    buffer,
  };
}

export function chunkedReceiverStart(state, pak, resp_func) {
  assert(state);
  let length = pak.readInt();
  let crc = pak.readU32();
  let mime_type = pak.readAnsiString();
  let log = `${state.name}: chunkedReceiverStart length=${length} crc=${crc} mime=${mime_type}`;

  if (length > state.max_buffer_size) {
    console.error(`${log}: ERR_TOO_LARGE`);
    return void resp_func('ERR_TOO_LARGE');
  }
  if (state.buffer_size + length > state.max_buffer_size) {
    console.error(`${log}: ERR_OUT_OF_SPACE`);
    return void resp_func('ERR_OUT_OF_SPACE');
  }

  state.buffer_size += length;

  let id = ++state.last_file_id;
  console.log(`${log} id=${id}`);
  state.files[id] = {
    length,
    crc,
    mime_type,
    total: 0,
    dv: packetBufPoolAlloc(length),
  };
  resp_func(null, id);
}

export function chunkedReceiverOnChunk(state, pak, resp_func) {
  if (!state) {
    pak.pool();
    return void resp_func('ERR_NOT_INITED');
  }
  let id = pak.readInt();
  let offs = pak.readInt();
  let buf = pak.readBuffer(false);
  let log = `${state.name}: chunkedReceiverOnChunk id=${id} offs=${offs} length=${buf.length}`;
  let file_data = state.files && state.files[id];
  if (!file_data) {
    console.error(`${log}: ERR_INVALID_FILE_ID`);
    return void resp_func('ERR_INVALID_FILE_ID');
  }
  if (file_data.total + buf.length > file_data.length) {
    cleanupFile(state, id);
    console.error(`${log}: ERR_BUFFER_OVERRUN`);
    return void resp_func('ERR_BUFFER_OVERRUN');
  }
  console.debug(log);
  file_data.total += buf.length;
  file_data.dv.u8.set(buf, offs);
  if (state.on_progress) {
    state.on_progress(file_data.total, file_data.length, file_data.mime_type, id);
  }
  resp_func();
}

// Optional? do some final checks
export function chunkedReceiverFinish(state, pak, resp_func) {
  let id = pak.readInt();
  if (!state) {
    return void resp_func('ERR_NOT_INITED');
  }
  let file_data = state.files && state.files[id];
  let log = `${state.name}: chunkedReceiverFinish id=${id}`;
  if (!file_data) {
    console.error(`${log}: ERR_INVALID_FILE_ID`);
    return void resp_func('ERR_INVALID_FILE_ID');
  }
  if (file_data.total !== file_data.length) {
    cleanupFile(state, id);
    console.error(`${log}: ERR_INCOMPLETE (total=${file_data.total} length=${file_data.length})`);
    return void resp_func('ERR_INCOMPLETE');
  }
  let crc = crc32(file_data.dv.u8, file_data.length);
  if (crc !== file_data.crc) {
    cleanupFile(state, id);
    console.error(`${log}: ERR_CRC_MISMATCH (expected=${file_data.crc} actual=${crc})`);
    return void resp_func('ERR_CRC_MISMATCH');
  }
  file_data.finished = true;
  resp_func();
}

// cb(err, id)
export function chunkedSend(opts, cb) {
  let { client, buffer, mime_type, max_in_flight } = opts;
  assert(buffer instanceof Uint8Array, 'Invalid data type');
  assert(mime_type, 'Missing mime_type');

  let length = buffer.length;
  assert(length);
  let crc = crc32(buffer);

  let id;
  asyncSeries([
    function getID(next) {
      let pak = client.pak('upload_start');
      pak.writeInt(length);
      pak.writeU32(crc);
      pak.writeAnsiString(mime_type);
      pak.send(function (err, assigned_id) {
        id = assigned_id;
        next(err);
      });
    },
    function streamFile(next) {
      let num_chunks = ceil(length / CHUNK_SIZE);

      let any_error = false;
      function sendChunk(idx, next) {
        if (any_error) {
          // Already had an error, fail-fast, don't try to send on disconnected link, etc
          return void next();
        }
        assert(idx < num_chunks);
        let pak = client.pak('upload_chunk');
        pak.writeInt(id);
        let start = idx * CHUNK_SIZE;
        pak.writeInt(start);
        let chunk_len = min(CHUNK_SIZE, length - start);
        pak.writeBuffer(new Uint8Array(buffer.buffer, buffer.byteOffset + start, chunk_len));
        pak.send(function (err) {
          if (err) {
            any_error = true;
          }
          next(err);
        });
      }
      let tasks = [];
      for (let ii = 0; ii < num_chunks; ++ii) {
        tasks.push(sendChunk.bind(null, ii));
      }
      asyncParallelLimit(tasks, max_in_flight, next);
    },
    function finish(next) {
      let pak = client.pak('upload_finish');
      pak.writeInt(id);
      pak.send(next);
    },
  ], function (err) {
    cb(err, id);
  });
}
