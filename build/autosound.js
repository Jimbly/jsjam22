const assert = require('assert');
const path = require('path');
const { asyncEach, asyncLimiter } = require('glov-async');
const gb = require('glov-build');

const { max, min } = Math;

// eslint-disable-next-line no-undef
assert(typeof globalThis.Blob === 'undefined');
// Needed for `vorbis-encoder-js`
function Blob(buffers, metadata) {
  this.my_buf = Buffer.concat(buffers);
  this.metadata = metadata;
}
// eslint-disable-next-line no-undef
globalThis.Blob = Blob;

function convertF32toS16(buf) {
  let ret = new Int16Array(buf.length);
  for (let ii = 0; ii < buf.length; ++ii) {
    ret[ii] = min(32767, max(-32768, buf[ii] * 32768));
  }
  return ret;
}

function AudioBufferF32(pcm_channels, rate) {
  this.pcm = pcm_channels;
  let nch = pcm_channels.length;
  this.numberOfChannels = nch;
  this.sampleRate = rate;
  this.length = pcm_channels[0].length;
  this.duration = this.length / this.sampleRate;
}
AudioBufferF32.prototype.getChannelData = function (channel) {
  return this.pcm[channel];
};

function steroToMono(channels) {
  if (channels.length === 1) {
    return channels;
  }
  let c0 = channels[0];
  let c1 = channels[1];
  assert.equal(c0.length, c1.length);
  for (let ii = 0; ii < c0.length; ++ii) {
    c0[ii] = (c0[ii] + c1[ii]) * 0.5;
  }
  return [c0];
}

module.exports = function (options) {
  options = options || {};
  options.inputs = options.inputs || ['wav', 'mp3']; // priority order
  options.outputs = options.outputs || ['ogg', 'mp3'];
  options.wav_max_size = options.wav_max_size || 512*1024;
  options.ogg_quality = options.ogg_quality || 0; // -1 ... 1
  options.mp3_kbps = options.mp3_kbps || 128;
  let all_exts = options.outputs.slice(0);
  for (let ii = 0; ii < options.inputs.length; ++ii) {
    let ext = options.inputs[ii];
    if (!all_exts.includes(ext)) {
      all_exts.push(ext);
    }
  }

  let wav;
  let mp3_decoder;
  let mp3_limiter;
  let VorbisEncoder;
  let lamejs;
  function autosoundInit(next) {
    if (all_exts.includes('wav')) {
      // eslint-disable-next-line global-require
      wav = require('node-wav');
    }
    if (options.outputs.includes('ogg')) {
      // eslint-disable-next-line global-require
      VorbisEncoder = require('@jimbly/vorbis-encoder-js').encoder;
    }
    if (options.outputs.includes('mp3')) {
      // eslint-disable-next-line global-require
      lamejs = require('lamejs');
    }

    if (options.inputs.includes('mp3')) {
      mp3_limiter = asyncLimiter(1);
      import('mpg123-decoder').then(function (mpg123_decoder) {
        const { MPEGDecoder } = mpg123_decoder;
        mp3_decoder = new MPEGDecoder();
        mp3_decoder.ready.then(function () {
          next();
        });
      });
    } else {
      next();
    }
  }

  function acquireMP3Encoder(next) {
    mp3_limiter(function (release) {
      next();
      mp3_decoder.reset().then(release, release);
    });
  }

  function autosound(job, done) {
    let file = job.getFile();
    let { relative } = file;
    let my_ext = path.extname(relative).slice(1);
    let base_name = relative.slice(0, -my_ext.length - 1);
    let ext_exists = {};
    job.depReset();

    if (options.outputs.includes(my_ext)) {
      // Always pass through source audio files, if they're an output extension
      job.out(file);
    }

    asyncEach(all_exts, function (ext, next) {
      if (ext === my_ext) {
        ext_exists[ext] = true;
        return void next();
      }
      let filename = `${base_name}.${ext}`;
      job.depAdd(filename, function (err, dep_file) {
        if (!err && dep_file.contents) {
          ext_exists[ext] = true;
        }
        next();
      });
    }, function () {
      let we_are_best = false;
      for (let ii = 0; ii < options.inputs.length; ++ii) {
        let ext = options.inputs[ii];
        if (ext_exists[ext]) {
          if (ext === my_ext) {
            we_are_best = true;
          }
          break;
        }
      }
      let need_output = false;
      for (let ii = 0; ii < options.outputs.length; ++ii) {
        let ext = options.outputs[ii];
        if (!ext_exists[ext]) {
          need_output = true;
        }
      }
      if (!we_are_best || !need_output) {
        // someone else is a better source,
        // or, all possible outputs already have pre-made inputs,
        // just output us as-is (above), and continue
        return void done();
      }

      function readInput(next) {
        if (my_ext === 'mp3') {
          acquireMP3Encoder(function () {
            next(mp3_decoder.decode(file.contents));
          });
        } else {
          assert.equal(my_ext, 'wav');
          next(wav.decode(file.contents));
        }
      }

      readInput(function (decode_ret) {
        let channels = decode_ret.channelData;
        let nch = channels.length;
        let sample_rate = decode_ret.sampleRate;
        let audio_buffer = new AudioBufferF32(channels, sample_rate);

        if (options.outputs.includes('ogg') && !ext_exists.ogg) {
          let encoder = new VorbisEncoder(sample_rate, nch, options.ogg_quality, {});
          encoder.encodeFrom(audio_buffer);
          let blob = encoder.finish();
          assert(blob.my_buf);
          job.out({
            relative: `${base_name}.ogg`,
            contents: blob.my_buf,
          });
        }

        if (options.outputs.includes('wav') && !ext_exists.wav) {
          // Assuming 16-bit, single channel, 2 bytes per sample, plus header
          let wav_size = audio_buffer.length * 2 + 44;
          if (wav_size <= options.wav_max_size) {
            let wavbuf = wav.encode(steroToMono(channels), { sampleRate: sample_rate, float: false, bitDepth: 16 });
            job.out({
              relative: `${base_name}.wav`,
              contents: wavbuf,
            });
          }
        }

        if (options.outputs.includes('mp3') && !ext_exists.mp3) {
          let mp3_chunks = [];
          let mp3encoder = new lamejs.Mp3Encoder(nch, sample_rate, options.mp3_kbps);
          let channels_s16 = channels.map(convertF32toS16);
          if (nch === 1) {
            mp3_chunks.push(mp3encoder.encodeBuffer(channels_s16[0]));
          } else {
            mp3_chunks.push(mp3encoder.encodeBuffer(channels_s16[0], channels_s16[1]));
          }
          // Get end part of mp3
          let mp3Tmp = mp3encoder.flush();
          if (mp3Tmp.length) {
            mp3_chunks.push(mp3Tmp);
          }
          let mp3_data = Buffer.concat(mp3_chunks.map((i8) => new Uint8Array(i8.buffer, 0, i8.byteLength)));
          job.out({
            relative: `${base_name}.mp3`,
            contents: mp3_data,
          });
        }

        done();
      });
    });
  }

  return {
    init: autosoundInit,
    type: gb.SINGLE,
    func: autosound,
    version: [
      autosound,
      steroToMono,
      options,
    ],
  };
};
