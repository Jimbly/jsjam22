const assert = require('assert');
const child_process = require('child_process');
const { asyncEach } = require('glov-async');
const gb = require('glov-build');

function copy(job, done) {
  job.out(job.getFile());
  done();
}

const OUTPUT_SERVER = 'test_server';
const OUTPUT_CLIENT = 'test_client';

function fileAndLine(str) {
  let m1 = str.match(/^ {4}at (.*:\d+:\d+)$/m);
  let m2 = str.match(/^ {4}at (.*) \((.*:\d+:\d+)\)$/m);
  if (m1 && m2 && str.indexOf(m1[0]) < str.indexOf(m2[0]) ||
    m1 && !m2
  ) {
    return m1[1];
  } else if (m2) {
    return `${m2[1]} (${m2[2]})`;
  }
  return null;
}

function likelyErrorString(str) {
  let m = str.match(/^((?:[A-Z][a-z]+)?Error(?: \[[A-Z_]+\])?: .*)$/m);
  if (!m) {
    m = str.match(/\n(.*)\nThrown at:\n(?: {4})at/m);
  }
  if (m) {
    let msg = m[1];
    let at = fileAndLine(str);
    if (at) {
      msg += ` at ${at}`;
    }
    return msg;
  }
  return null;
}

module.exports = function test(opts) {
  let { input_server, input_client, timeout } = opts;

  timeout = timeout || 5000;

  gb.task({
    name: 'server_js_test',
    target: OUTPUT_SERVER,
    input: [
      `${input_server}:**`,
    ],
    type: gb.SINGLE,
    func: copy,
  });

  gb.task({
    name: 'client_js_test',
    target: OUTPUT_CLIENT,
    input: [
      'server_js_test:**/server/test.*',
      `${input_client}:**`,
    ],
    type: gb.SINGLE,
    func: copy,
  });

  let server_bucket_dir = gb.files.getBucketDir(OUTPUT_SERVER);
  let client_bucket_dir = gb.files.getBucketDir(OUTPUT_CLIENT);

  let jobs_ran;

  return {
    deps: [
      // TODO: this is the right stuff on disk, not just need a job per test file!
      'client_js_test',
      'server_js_test',
    ],
    input: [
      'client_js_test:**/tests/**/test*.js',
      'server_js_test:**/tests/**/test*.js',
    ],
    type: gb.SINGLE,
    read: false,
    version: [
      likelyErrorString,
      fileAndLine,
    ],
    init: function (next) {
      jobs_ran = 0;
      next();
    },
    finish: function () {
      gb.debug(`  ${jobs_ran} tests ran`);
    },
    func: function (job, done) {
      ++jobs_ran;
      let file = job.getFile();
      let bucket_dir = file.getBucketDir();
      let is_client = bucket_dir === client_bucket_dir;
      if (!is_client) {
        assert.equal(bucket_dir, server_bucket_dir);
      }
      let start = Date.now();
      let my_proc = child_process.fork(file.getDiskPath(), ['--test'], {
        cwd: bucket_dir,
        stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
        execArgv: ['--trace-uncaught'],
        timeout,
      });
      let stdout = '';
      my_proc.stdout.on('data', function (chunk) {
        stdout += chunk;
      });
      let stderr = '';
      my_proc.stderr.on('data', function (chunk) {
        stderr += chunk;
      });
      let deps;
      my_proc.on('message', function (data) {
        if (data && data.type === 'deps') {
          assert(!deps);
          deps = data.deps;
        }
      });
      my_proc.on('close', function (code) {
        stdout = stdout.trim().replace(/\r\n/g, '\n');
        stderr = stderr.trim().replace(/\r\n/g, '\n');
        let did_err = false;
        if (stderr) {
          job.error(likelyErrorString(stderr) || 'Errored');
          did_err = true;
        } else if (code === null) {
          job.error(`Test timed out after ${((Date.now() - start)/1000).toFixed(1)}s`);
          did_err = true;
        } else if (code !== 0) {
          job.error(`Exited with code=${code}`);
          did_err = true;
        }
        if (did_err) {
          job.log('Test process output follows:');
          console.log(`${stdout ? `${stdout}\n\n` : ''}${stderr}`);
        } else {
          if (stdout) {
            job.log('Test succeeded, process stdout follows:');
            stdout.split('\n').forEach(function (line) {
              job.log(line);
            });
          } else {
            job.log('Test succeeded.');
          }
        }
        if (!deps || !deps.length) {
          return void done();
        }
        asyncEach(deps, function (item, next) {
          let file_key = `${is_client ? 'client_js_test' : 'server_js_test'}:${item}`;
          // TODO: Want a read:false equivalent here too
          job.depAdd(file_key, next);
        }, done);
      });
      my_proc.on('error', function (err) {
        job.error(`Process error "${err}"`);
      });
    },
  };
};
