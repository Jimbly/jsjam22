const assert = require('assert');
const gb = require('glov-build');
const browserify = require('glov-build-browserify');
const concat = require('glov-build-concat');
const argv = require('minimist')(process.argv.slice(2));
const uglify = require('./uglify.js');

const uglify_options_ext = { compress: true, keep_fnames: false, mangle: true };

const browserify_options_entrypoint = {
  transform: [],
  bundleExternal: false,
};

const babelify_opts_deps = {
  global: true, // Required because some modules (e.g. dot-prop) have ES6 code in it
  presets: [
    ['@babel/env', {
      'targets': {
        'ie': '10'
      },
      'loose': true,
    }],
  ]
};

const browserify_options_deps = {
  bundleExternal: true,
  builtins: {
    // super-simple replacements, if needed
    assert: './src/glov/client/shims/assert.js',
    buffer: './src/glov/client/shims/buffer.js',
    // timers: './src/glov/client/shims/timers.js',
    _process: './src/glov/client/shims/empty.js',
  },
  transform: [
    ['babelify', babelify_opts_deps],
  ],
};


function concatJS(opts) {
  let { first_file, output } = opts;
  function comparator(a, b) {
    if (a.key === first_file) {
      return -1;
    }
    if (b.key === first_file) {
      return 1;
    }
    return a.key < b.key ? -1 : 1;
  }

  return {
    ...concat({
      output,
      comparator,
      sourcemap: { inline: false },
    }),
  };
}

function bundlePair(opts) {
  // entrypoint: 'client/app.js',
  // source: 'client_intermediate',
  // out: 'client/app.bundle.js',
  // deps: 'client/app_deps.js',
  // deps_source: 'source',
  // is_worker: false,
  // target: 'dev:client',
  let {
    source,
    entrypoint,
    out,
    deps,
    deps_source,
    is_worker,
    target,
    deps_out,
    post_bundle_cb,
    bundle_uglify_opts,
    ban_deps,
  } = opts;
  let subtask_name = `bundle_${entrypoint.replace(/^client\//, '').replace(/\//g, '_')}`;

  let tasks = [];

  let do_final_bundle = is_worker && deps;

  let entrypoint_name = `${subtask_name}_entrypoint`;
  if (!do_final_bundle && !bundle_uglify_opts) {
    tasks.push(entrypoint_name);
  }
  let entrypoint_subbundle_opts = {
    entrypoint,
    source,
    out,
    browserify: browserify_options_entrypoint,
    post_bundle_cb,
  };
  if (ban_deps) {
    entrypoint_subbundle_opts.ban_deps = ban_deps;
  }
  gb.task({
    name: entrypoint_name,
    target: (do_final_bundle || bundle_uglify_opts) ? undefined : target,
    ...browserify(entrypoint_subbundle_opts)
  });

  if (bundle_uglify_opts) {
    let mangle_name = `${entrypoint_name}_mangle`;
    gb.task({
      name: mangle_name,
      input: [
        `${entrypoint_name}:${out}`,
      ],
      target: do_final_bundle ? undefined : target,
      ...uglify({ inline: false }, bundle_uglify_opts),
    });
    tasks.push(mangle_name);
    entrypoint_name = mangle_name;
  }

  if (deps) {
    if (!deps_out) {
      deps_out = 'deps.bundle.js';
    }
    let deps_name = `${subtask_name}_deps`;
    gb.task({
      name: deps_name,
      ...browserify({
        entrypoint: deps,
        source: deps_source,
        out: deps_out,
        browserify: browserify_options_deps,
        post_bundle_cb,
      }),
    });

    let uglify_name = `${deps_name}_uglify`;
    gb.task({
      name: uglify_name,
      type: gb.SINGLE,
      input: `${deps_name}:${deps_out}`,
      target: do_final_bundle ? undefined : target,
      ...uglify({ inline: Boolean(do_final_bundle) }, uglify_options_ext),
    });
    if (!do_final_bundle) {
      tasks.push(uglify_name);
    } else {

      let final_name = `${subtask_name}_final`;
      tasks.push(final_name);

      gb.task({
        name: final_name,
        input: [
          `${uglify_name}:${deps_out}`,
          `${entrypoint_name}:${out}`,
        ],
        target,
        ...concatJS({
          output: out,
          first_file: `${uglify_name}:${deps_out}`
        }),
      });
    }
  }

  // Important: one, final composite task that references each of the final outputs.
  //   This allows other tasks to reference our output files as a single glob
  //   without knowing the internal names of the individual tasks.
  return {
    type: gb.SINGLE,
    deps: tasks,
  };
}


const VERSION_STRING = 'BUILD_TIMESTAMP';
const VERSION_BUFFER = Buffer.from(VERSION_STRING);
function versionReplacer(buf) {
  let idx = buf.indexOf(VERSION_BUFFER);
  if (idx !== -1) {
    let build_timestamp = Date.now();
    if (argv.timestamp === false) { // --no-timestamp
      build_timestamp = '0000000000000';
    }
    // Must be exactly 'BUILD_TIMESTAMP'.length (15) characters long
    build_timestamp = `"${build_timestamp}"`;
    assert.equal(build_timestamp.length, 15);
    // Replace all occurrences in `buf`
    let ver_buf = Buffer.from(build_timestamp);
    while (idx !== -1) {
      ver_buf.copy(buf, idx);
      idx = buf.indexOf(VERSION_BUFFER, idx + 15);
    }
  }
}

module.exports = function appBundle(param) {
  let { task_accum, name, out, do_version } = param;
  if (do_version) {
    param.post_bundle_cb = versionReplacer;
  }
  gb.task({
    name,
    ...bundlePair(param),
  });
  task_accum.push(name);
  if (do_version) {
    let version_writer_name = `${name}_ver`;
    gb.task({
      name: version_writer_name,
      deps: task_accum.slice(0), // all previous bundle tasks
      type: gb.SINGLE,
      input: [`${name}:${out}`],
      target: 'dev',
      func: function (job, done) {
        let file = job.getFile();
        let idx = file.contents.indexOf('glov_build_version="');
        if (idx === -1) {
          return void done('Bundle with `do_version` failed: could not find' +
            ' "window.glov_build_version=BUILD_TIMESTAMP;"');
        }
        let last_build_timestamp = file.contents.slice(idx + 'glov_build_version='.length,
          idx + 'glov_build_version=BUILD_TIMESTAMP'.length).toString();
        assert(isFinite(Number(JSON.parse(last_build_timestamp))));
        job.out({
          relative: do_version,
          contents: `{"ver":${last_build_timestamp}}`,
        });
        done();
      },
    });
    task_accum.push(version_writer_name);
  }
};
