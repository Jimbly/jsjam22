const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { asyncEachSeries } = require('glov-async');
const gb = require('glov-build');
const babel = require('glov-build-babel');
const gbcache = require('glov-build-cache');
const imagemin = require('glov-build-imagemin');
const preresolve = require('glov-build-preresolve');
const sourcemap = require('glov-build-sourcemap');
const imagemin_optipng = require('imagemin-optipng');
const imagemin_zopfli = require('imagemin-zopfli');
const argv = require('minimist')(process.argv.slice(2));
const Replacer = require('regexp-sourcemaps');

const alphafix = require('./alphafix.js');
const appBundle = require('./app-bundle.js');
const autosound = require('./autosound.js');
const compress = require('./compress.js');
const eslint = require('./eslint.js');
const exec = require('./exec.js');
const gulpish_tasks = require('./gulpish-tasks.js');
const json5 = require('./json5.js');
const testRunner = require('./test-runner.js');
const { texPackExtractPNG, texPackRecombinePNG } = require('./texpack.js');
const texproc = require('./texproc.js');
const typescript = require('./typescript.js');
const uglify = require('./uglify.js');
const uglifyrc = require('./uglifyrc.js');
const warnMatch = require('./warn-match.js');
const webfs = require('./webfs_build.js');
const yamlproc = require('./yamlproc.js');

require('./checks.js')(__filename);

// Suppress nonsensical warning from `caniuse-lite` that shows up even when targeting Node
process.env.BROWSERSLIST_IGNORE_OLD_DATA = 1;

const targets = {
  dev: path.join(__dirname, '../dist/game/build.dev'),
  test_server: path.join(__dirname, '../dist/game/build.test/server'),
  test_client: path.join(__dirname, '../dist/game/build.test/client'),
  prod: path.join(__dirname, '../dist/game/build.prod'),
};
const SOURCE_DIR = path.join(__dirname, '../src/');
gb.configure({
  source: SOURCE_DIR,
  statedir: path.join(__dirname, '../dist/game/.gbstate'),
  targets,
  log_level: gb.LOG_INFO,
});

// eslint-disable-next-line import/order
const config = require('./config.js')(gb);

// Gets applied to the entire bundle
const max_mangle = argv['max-mangle'];
const prod_uglify_opts = {
  ...uglifyrc,
  keep_fnames: !max_mangle,
  mangle: { toplevel: true },
};

const babel_plugins_base = [
  // Generates much more optimal require() statements / usage
  // TODO: Switch (here, and 2 other places) to `transform-modules-simple-commonjs` if PR is accepted
  ['@jimbly/babel-plugin-transform-modules-simple-commonjs', { exportNamed: false, inlineReplace: true }],
  ['replace-ts-export-assignment', {}],
];

const babel_preset_typescript = ['@babel/preset-typescript', { allowDeclareFields: true }];

function copy(job, done) {
  job.out(job.getFile());
  done();
}

gb.task({
  name: 'client_css',
  input: config.client_css,
  type: gb.SINGLE,
  target: 'dev',
  func: copy,
});

gb.task({
  name: 'server_js',
  input: config.server_js_files,
  ...babel({
    babel: {
      babelrc: false,
      presets: [
        ['@babel/env', {
          targets: {
            node: '16'
          },
          loose: true,
        }],
        babel_preset_typescript,
      ],
      plugins: babel_plugins_base,
    },
  }),
});

gb.task({
  name: 'server_js_glov_preresolve',
  ...preresolve({ ...config.preresolve_params, source: 'server_js' }),
});

gb.task({
  name: 'server_js_notest',
  target: 'dev',
  input: [
    'server_js_glov_preresolve:**',
    'server_js_glov_preresolve:!**/test.js*',
    'server_js_glov_preresolve:!**/tests/**',
  ],
  type: gb.SINGLE,
  func: copy,
});

gb.task({
  name: 'eslint',
  ...eslint({
    input: [
      ...config.client_html,
      ...config.all_js_files,
    ],
  }),
});

gb.task({
  name: 'gulpish-client_html_default',
  input: config.client_html,
  ...gulpish_tasks.client_html_default('dev', config.default_defines)
});

let gulpish_client_html_tasks = ['gulpish-client_html_default'];
config.extra_index.forEach(function (elem) {
  let name = `gulpish-client_html_${elem.name}`;
  gulpish_client_html_tasks.push(name);
  gb.task({
    name,
    input: config.client_html_index,
    ...gulpish_tasks.client_html_custom('dev', elem)
  });
});

gb.task({
  name: 'gulpish-client_html',
  deps: gulpish_client_html_tasks,
});

gb.task({
  name: 'client_json',
  input: config.client_json_files,
  ...json5({ beautify: false })
});

gb.task({
  name: 'server_json',
  input: config.server_json_files,
  target: 'dev',
  ...json5({ beautify: true })
});

gb.task({
  name: 'client_png',
  input: config.client_png,
  ...gbcache({
    key: 'alphafix',
    version: 1,
  }, alphafix(config.client_png_alphafix)),
});

gb.task({
  name: 'client_texopt',
  input: ['client/img/**/*.texopt'],
  ...yamlproc(),
});

gb.task({
  name: 'client_texproc',
  input: 'client_png:**',
  deps: ['client_texopt'],
  ...texproc(),
});

gb.task({
  name: 'client_texproc_output',
  input: [
    'client_texproc:**',
    'client_texproc:!**/*.tflag',
  ],
  type: gb.SINGLE,
  target: 'dev',
  func: copy,
});

gb.task({
  name: 'server_static',
  input: config.server_static,
  type: gb.SINGLE,
  target: 'dev',
  func: copy,
});

gb.task({
  name: 'client_js_babel_files',
  input: config.client_js_files,
  ...babel({
    sourcemap: {
      inline: true,
    },
    babel: {
      babelrc: false,
      presets: [
        ['@babel/env', {
          targets: {
            ie: '10'
          },
          loose: true,
        }],
        babel_preset_typescript,
      ],
      plugins: [
        ...babel_plugins_base,
        // Note: Dependencies are not tracked from babel plugins, so use
        //   `webfs` instead of `static-fs` where possible
        ['static-fs', {}], // generates good code, but does not allow reloading/watchify
        ['transform-preprocessor', { replace: {
          'profilerStartFunc()': 'profilerStart(__funcname)',
          'profilerStopFunc()': 'profilerStop(__funcname)',
        } }],
      ]
    }
  }),
});

const regex_code_strip = /_classCallCheck\([^)]+\);\n|exports\.__esModule = true;|function _classCallCheck\((?:[^}]*\}){2}\n/g;
gb.task({
  name: 'client_js_babel_cleanup_bad',
  input: ['client_js_babel_files:**.js'],
  type: gb.SINGLE,
  func: function (job, done) {
    let file = job.getFile();
    job.depReset();
    sourcemap.init(job, file, function (err, map, raw_map_file) {
      if (err) {
        return void done(err);
      }
      let code = file.contents.toString();
      if (!code.match(regex_code_strip)) {
        job.out(file);
        if (raw_map_file) {
          job.out(raw_map_file);
        }
        return void done();
      }
      // replace while updating sourcemap
      let replacer = new Replacer(regex_code_strip, '');
      let result = replacer.replace(code, file.relative);
      // This doesn't work because `source-map`::applySourceMap() just doesn't
      // work for anything non-trivial, and the babel-generated sourcemap is far from trivial
      // map = sourcemap.apply(map, result.map);
      let result_code = result.code;

      sourcemap.out({
        relative: file.relative,
        contents: result_code,
        map,
      });
      done();
    });
  }
});

// much simpler version of above that simply passes through existing .map files
gb.task({
  name: 'client_js_babel_cleanup',
  input: ['client_js_babel_files:**'],
  type: gb.SINGLE,
  func: function (job, done) {
    let file = job.getFile();
    if (path.extname(file.relative) === '.js') {
      job.out({
        relative: file.relative,
        contents: file.contents.toString().replace(regex_code_strip, ''),
      });
    } else {
      job.out(file);
    }
    done();
  }
});

gb.task({
  name: 'client_js_glov_preresolve',
  ...preresolve({ ...config.preresolve_params, source: 'client_js_babel_cleanup' }),
});

gb.task({
  name: 'client_js_warnings',
  input: ['client_js_glov_preresolve:**.js'],
  ...warnMatch({
    'Spread constructor param': /isNativeReflectConstruct/,
    'Bad babel': /__esModule/,
    'TypeError: read-only': /_readOnlyError/,
  })
});

gb.task({
  name: 'client_js_uglify',
  input: ['client_js_glov_preresolve:**.js'],
  ...uglify({ inline: true }, uglifyrc),
});

gb.task({
  name: 'client_js_babel',
  deps: [
    'client_js_uglify',
    'client_js_warnings',
  ]
});

// Pull from multiple tasks into one (on-disk) folder for another tasks to reference
// For non-gulpish tasks, can pull from multiple sources (automatically) without
//   this step, but can be useful to see this particular step on-disk.
gb.task({
  name: 'client_intermediate',
  input: config.client_intermediate_input,
  type: gb.SINGLE,
  func: copy,
});

let server_process_container = {};

const WORKER_BAN_DEPS = {
  'Cannot reference window/document from WebWorkers': [
    'glov/client/engine',
    'glov/client/urlhash',
    'glov/client/worker_comm',
  ],
};
let bundle_tasks = [];
function registerBundle(param) {
  const { entrypoint, deps, is_worker, do_version, do_reload, ban_deps } = param;
  let name = `client_bundle_${entrypoint.replace('/', '_')}`;
  let out = `client/${entrypoint}.bundle.js`;
  appBundle({
    name,
    source: 'client_intermediate',
    entrypoint: `client/${entrypoint}.js`,
    out,
    deps_source: 'source',
    deps: `client/${deps}.js`,
    deps_out: is_worker ? null : `client/${deps}.bundle.js`,
    is_worker,
    target: 'dev',
    task_accum: bundle_tasks,
    do_version,
    bundle_uglify_opts: argv['dev-mangle'] ? prod_uglify_opts : null,
    ban_deps: ban_deps || (is_worker ? WORKER_BAN_DEPS : null),
  });
  if (do_reload) {
    // Add an early sync task, letting the server know we should reload these files
    let name_last = `${name}${do_version ? '_ver' : ''}`;
    let name_sync = `${name_last}_reload`;
    gb.task({
      name: name_sync,
      input: [
        `${name_last}:**`,
      ],
      type: gb.ALL,
      read: false,
      version: Date.now(), // always runs once per process
      func: function (job, done) {
        if (server_process_container.proc) {
          let updated = job.getFilesUpdated();
          updated = updated.map((a) => a.relative);
          server_process_container.proc.send({ type: 'file_change', paths: updated });
        }
        done();
      },
    });
    bundle_tasks.push(name_sync);
  }
}
config.bundles.forEach(registerBundle);

gb.task({
  name: 'server_fsdata',
  input: config.server_fsdata,
  target: 'dev',
  type: gb.SINGLE,
  func: function (job, done) {
    let file = job.getFile();
    let server_name = file.relative.replace(/^client\//, 'server/');
    job.out({
      relative: server_name,
      contents: file.contents,
    });

    done();
  }
});

let server_hotreload_updated = null;
gb.task({
  name: 'server_hotreload',
  input: 'server_fsdata:**',
  type: gb.SINGLE,
  init: function (next) {
    server_hotreload_updated = [];
    next();
  },
  func: function (job, done) {
    server_hotreload_updated.push(job.getFile().relative);
    done();
  },
  finish: function () {
    if (server_process_container.proc) {
      server_process_container.proc.send({ type: 'file_change', paths: server_hotreload_updated });
    }
    server_hotreload_updated = null;
  },
});

const server_input_globs = [
  'server_static:**',
  'server_js_notest:**',
  'server_json:**',
];

let server_port = argv.port || process.env.port || 3000;
let server_port_https = argv.sport || process.env.sport || (server_port + 100);

gb.task({
  name: 'run_server',
  deps: [
    // do not run until after these are done, but does not cause a hard reload
    'server_fsdata',
    'server_hotreload',
  ],
  input: server_input_globs,
  ...exec({
    cwd: '.',
    cmd: 'node',
    args: [
      argv.port ? `--inspect=${9229 + Number(argv.port) - 3000}` : '--inspect',
      'dev:server/index.js',
      '--dev',
      '--master',
      `--port=${server_port}`,
      `--sport=${server_port_https}`,
    ].concat(argv.debug ? ['--debug'] : [])
    .concat(argv['net-delay'] === false ? ['--no-net-delay'] : [])
    .concat(argv.timeout === false ? ['--no-timeout'] : [])
    .concat(argv['packet-debug'] === false ? ['--no-packet-debug'] : [])
    .concat(argv.env ? [`--env=${argv.env}`] : []),
    stdio: argv.serverlog === false ?
      ['ignore', 'ignore', 'ignore', 'ipc'] : // --no-serverlog
      ['inherit', 'inherit', 'inherit', 'ipc'],
    // shell: true,
    // detached: true,
    process_container: server_process_container,
  }),
});

gb.task({
  name: 'client_fsdata',
  input: config.client_fsdata,
  target: 'dev',
  ...webfs({
    embed: config.fsdata_embed,
    strip: config.fsdata_strip,
    base: 'client',
    output: 'client/fsdata.js',
  })
});

gb.task({
  name: 'client_static',
  input: config.client_static,
  type: gb.SINGLE,
  target: 'dev',
  func: copy,
});

gb.task({
  name: 'client_single_min_pre',
  input: config.client_single_min,
  ...uglify({ no_sourcemap: true }, {}),
});

gb.task({
  name: 'client_single_min',
  input: 'client_single_min_pre:**',
  type: gb.SINGLE,
  target: 'dev',
  func: function (job, done) {
    let file = job.getFile();
    let min_name = file.relative.replace(/^(.*\/)([^/]+)\.js$/, 'client/$2.min.js');
    job.out({
      relative: min_name,
      contents: file.contents,
    });

    done();
  },
});

gb.task({
  name: 'client_autosound',
  input: config.client_autosound,
  target: 'dev',
  ...gbcache({
    key: 'autosound',
    version: 1,
  }, autosound(config.client_autosound_config)),
});

function addStarStar(a) {
  return `${a}:**`;
}
function addStarStarJS(a) {
  return `${a}:**.js`;
}
function addStarStarJSON(a) {
  return `${a}:**.json`;
}

let client_tasks = [
  ...config.extra_client_tasks,
  'client_autosound',
  'client_static',
  'client_single_min',
  'client_texproc_output',
  'client_css',
  'client_fsdata',
  ...bundle_tasks,
];

let client_input_globs_base = client_tasks.map(addStarStar);

let client_input_globs = [
  ...client_input_globs_base,
  ...gulpish_client_html_tasks.map(addStarStar),
];


let bs_target = `http://localhost:${server_port}`;
let bs_target_https = `https://localhost:${server_port_https}`;
let bs;
gb.task({
  name: 'browser_sync',
  input: client_input_globs,
  type: gb.ALL,
  read: false,
  version: Date.now(), // always runs once per process
  init: function (next) {
    if (!bs) {
      // eslint-disable-next-line global-require
      let utils = require('browser-sync/dist/utils.js');
      // hack the browser opening to go to the URL we want
      let old_open = utils.opnWrapper;
      assert(old_open);
      utils.opnWrapper = (url, name, instance) => {
        if (instance.options.get('open') === 'target') {
          url = `${bs_target}${config.browsersync_queryparams}`;
        } else if (instance.options.get('open') === 'target_https') {
          url = `${bs_target_https}${config.browsersync_queryparams}`;
        }
        old_open(url, name, instance);
      };
      // eslint-disable-next-line global-require
      bs = require('browser-sync').create();
    }
    next();
  },
  func: function (job, done) {
    let user_data = job.getUserData();
    if (!user_data.running) {
      user_data.running = true;
      // for more browser-sync config options: http://www.browsersync.io/docs/options/
      bs.init({
        // informs browser-sync to proxy our app which would run at the following location
        proxy: {
          target: `${bs_target}${config.browsersync_queryparams}`,
          ws: true,
          proxyReq: [
            function (proxyReq) {
              // Note: adding this will cause the browser-sync port (:4000) to
              // be considered insecure (not serve .map files if private, no
              // access to permtoken API, etc), since it could be forwarding
              // a non-local request.  For now, leaving this request alone
              // and relying on the developer to protect the port appropriately.
              // If the port is only ever served via a proxy that adds the
              // forward header, it's sufficiently protected.
              // proxyReq.setHeader('X-Forwarded-For', 'browser-sync');
            }
          ]
        },
        // informs browser-sync to use the following port for the proxied app
        // notice that the default port is 3000, which would clash with our server
        port: 4000,

        // don't sync clicks/scrolls/forms/etc
        ghostMode: false,

        open: argv.browser === false ?
          false : // --no-browser
          argv.https ? 'target_https' : 'target',
      }, done);

      if (server_process_container.proc) {
        // Very first run, but server is already up, make sure they know the
        //   client has been updated, if it was changed between the server
        //   being started and this task being run.
        server_process_container.proc.send({ type: 'file_change', paths: ['client/app.ver.json'] });
      }

    } else {
      let updated = job.getFilesUpdated();
      updated = updated.map((a) => a.relative);
      if (server_process_container.proc) {
        server_process_container.proc.send({ type: 'file_change', paths: updated });
      }
      bs.reload(updated);
      done();
    }
  },
});

gb.task({
  name: 'check_typescript',
  input: [...config.all_js_files, ...config.client_json_files, ...config.server_json_files],
  ...typescript({
    config_path: 'tsconfig.json',
  }),
});

gb.task({
  name: 'test',
  ...testRunner({
    input_server: 'server_js_glov_preresolve',
    input_client: 'client_intermediate',
  }),
});

gb.task({
  name: 'nop',
  type: gb.SINGLE,
  input: 'does_not_exist',
  func: assert.bind(null, false),
});

gb.task({
  name: 'build_deps',
  deps: [
    // 'client_json', // dep'd from client_bundle*
    // 'client_js_babel', // dep'd from client_bundle*

    'server_static',
    'server_fsdata',
    'server_js_notest',
    'server_json',
    ...client_tasks,
    (argv.nolint || argv.lint === false) ? 'nop' : 'eslint',
    // 'gulpish-eslint', // example, superseded by `eslint`
    (argv.nolint || argv.lint === false) ? 'nop' : 'check_typescript',
    (argv.nolint || argv.lint === false) ? 'nop' : 'test',
    'gulpish-client_html',
    'client_js_warnings',
  ],
});

if (argv['prod-uglify'] === false) {
  gb.task({
    name: 'build.prod.uglify',
    input: [
      ...bundle_tasks.map(addStarStarJS),
    ],
    type: gb.SINGLE,
    func: copy,
  });
} else {
  gb.task({
    name: 'build.prod.uglify',
    input: [
      ...bundle_tasks.map(addStarStarJS),
    ],
    ...uglify({ inline: false }, prod_uglify_opts),
  });
}

function noBundleTasks(elem) {
  if (bundle_tasks.indexOf(elem.split(':')[0]) !== -1) {
    return false;
  }
  return true;
}

function noTextureTask(elem) {
  if (elem.split(':')[0] === 'client_texproc_output') {
    return false;
  }
  return true;
}

gb.task({
  name: 'build.prod.pngextract',
  input: [
    'client_texproc_output:**/*.txp',
  ],
  ...texPackExtractPNG(),
});

gb.task({
  name: 'build.prod.png',
  input: [
    'client_texproc_output:**/*.png',
    'build.prod.pngextract:**',
  ],
  ...gbcache({
    key: 'imagemin',
    version: 1,
  }, imagemin({
    plugins: [
      imagemin_optipng(config.optipng),
      imagemin_zopfli(config.zopfli),
    ],
  })),
});

gb.task({
  name: 'build.prod.pngpack',
  input: [
    'build.prod.png:**',
  ],
  ...texPackRecombinePNG(),
});

// Texture pipeline summary:
//   client_png
//     -> combines all source pngs from source data, generated, combined, etc, does alpha fixing
//   client_texproc - input of client_png
//     -> based on .texopt settings, generates compressed and packed textures plus tflags
//     -> passes through other png files
//   client_texproc_output
//     -> filters out the tflags and outputs all these to dev
// (Production build only pipeline)
//   build.prod.pngextract
//     -> extracts TXPs to individual PNGs for optimization
//   build.prod.png
//     -> compresses all PNGs (either individuals or those extracted in previous task)
//   build.prod.pngpack
//     -> repacks PNGs to TXPs, passes through other pngs
//   build.prod.texfinal
//     -> gathers all final images needed for prod zip tasks an also outputs to prod:
//       all outputs from build.prod.pngpack
//       all non-txp, non-png, non-tflag outputs of client_texproc (gpu textures, maybe jpegs later, etc)
//         Or, maybe they should be pass-through from build.prod.pngextract->etc?
//         There are not yet any of these, all `texproc()` outputs are currently PNGs or PNG-containing TXPs

gb.task({
  name: 'build.prod.texfinal',
  input: [
    // All final compressed .PNGs, all re-packed .TXPs
    'build.prod.pngpack:**',
    // all non-txp, non-png, non-tflag outputs of client_texproc (gpu textures, maybe jpegs later, etc)
    'client_texproc:**',
    'client_texproc:!**/*.png',
    'client_texproc:!**/*.txp',
    'client_texproc:!**/*.tflag',
  ],
  target: 'prod',
  type: gb.SINGLE,
  func: copy,
});


let zip_tasks = [];
config.extra_index.forEach(function (elem) {
  if (!elem.zip) {
    return;
  }
  let name = `build.zip.${elem.name}`;
  zip_tasks.push(name);
  gb.task({
    name,
    input: [
      ...client_input_globs_base.filter(noBundleTasks).filter(noTextureTask),
      'build.prod.texfinal:**',
      ...bundle_tasks.map(addStarStarJSON), // things excluded in build.prod.uglify
      'build.prod.uglify:**',
      ...config.extra_client_html,
      ...config.extra_zip_inputs,
      `gulpish-client_html_${elem.name}:**`,
    ],
    deps: ['build_deps'],
    ...gulpish_tasks.zip('prod', elem),
    type: gb.ALL,
  });
});
if (!zip_tasks.length) {
  zip_tasks.push('build_deps'); // something arbitrary, just so it's not an empty list
}
gb.task({
  name: 'build.zip',
  deps: zip_tasks,
});

const package_files = ['package.json', 'package-lock.json'];
function timestamp(list) {
  return list.map((fn) => fs.statSync(fn).mtime.getTime()).join(',');
}
gb.task({
  name: 'build.prod.package',
  input: ['../package.json'], // Not actually valid
  type: gb.ALL,
  target: 'prod',
  // BAD EXAMPLE
  // This task reads from the filesystem directly, without adding any dependency
  // tracking, so will only be run when we restart our build process, not
  // when the source files change.  This is acceptable in this case since these
  // are rarely-modified files, and we do not want a `watch` happening on the
  // entire root directory of the project, nor do we want all other tasks to
  // necessarily be relative of the root instead of the implicit `src/`.
  // TODO: Some better solution here: multiple sources? external dependency
  //   function, so this works for sources like web fetches too? custom input
  //   provider function (key + timestamp) and we reference it as a source?
  version: timestamp(package_files),
  func: function (job, done) {
    asyncEachSeries(package_files, function (filename, next) {
      fs.readFile(filename, function (err, buffer) {
        if (buffer) {
          job.out({
            relative: filename,
            contents: buffer,
          });
        }
        next(err);
      });
    }, done);
  },
});

gb.task({
  name: 'build.prod.compress',
  input: [
    ...bundle_tasks.map(addStarStarJSON), // things excluded in build.prod.uglify
    'build.prod.uglify:**',
    ...client_input_globs.filter(noBundleTasks).filter(noTextureTask),
    ...config.extra_prod_inputs,
  ],
  target: 'prod',
  ...compress(config.compress_files),
});

gb.task({
  name: 'build.prod.server',
  input: [
    ...server_input_globs,
    'server_fsdata:**',
  ],
  target: 'prod',
  type: gb.SINGLE,
  func: copy,
});

gb.task({
  name: 'build.prod.client',
  deps: ['build.prod.compress', 'build.prod.texfinal', 'build.zip'],
});
gb.task({
  name: 'build',
  deps: ['build.prod.package', 'build.prod.server', 'build.prod.client'],
});

// Default development task
gb.task({
  name: 'default',
  deps: [
    'build_deps',
    'run_server',
    'browser_sync',
  ],
});

gb.task({
  name: 'lint',
  deps: [
    'eslint',
    'check_typescript',
  ],
});

// Send build state to server process upon server startup and upon state change
let gbstate;
function sendGBState() {
  if (server_process_container.proc && gbstate) {
    server_process_container.proc.send(gbstate);
  }
}
server_process_container.on_change = sendGBState;
let last_gbstate = '';
gb.on('done', function () {
  let debug_state = gb.getDebugState();
  let state_str = JSON.stringify(debug_state);
  if (state_str !== last_gbstate) {
    gbstate = { type: 'gbstate', state: debug_state };
    last_gbstate = state_str;
    sendGBState();
  }
});

gb.go();
