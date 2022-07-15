/* eslint consistent-return:off */
const assert = require('assert');
const fs = require('fs');
const { asyncSeries } = require('glov-async');
const gb = require('glov-build');

module.exports = function (opts) {
  const { config_path } = opts;
  let ts;
  let files;
  let script_files = [];
  let config_data;
  let services;
  let format_host;
  let services_host;
  const unwatched_file = /^node_modules\/|^.:|^\//; // starts with node_modules or is an absolute path
  const cwd = '';
  let past_first_run = false;
  function typescriptInit(next) {
    if (ts) {
      return next();
    }
    // eslint-disable-next-line global-require
    ts = require('typescript');

    files = {};

    function cachedUnwatched(api, handler) {
      // Rules:
      //   Anything outside of our watched folders are cached exactly once
      //   Any searching of node_modules/glov gets redirected to source:glov/
      let cache = {};
      return function (file_name, ...args) {
        file_name = file_name.replace(/^node_modules\/glov\//, 'glov/');
        if (file_name.match(unwatched_file)) {
          // This file is outside of our build scope, e.g. something in node_modules/,
          //   just hit the disk once, then cache it.
          if (file_name in cache) {
            return cache[file_name];
          }
          if (past_first_run) {
            // This should not happen upon a regular incremental update, but,
            // happens while coding new things (referencing any new module, for instance),
            // so, just ignore it.

            // console.debug(`unexpected runtime unwatched ${api}(${file_name})`);
          }
          let ret = ts.sys[api](file_name, ...args);
          cache[file_name] = ret;
          return ret;
        }
        return handler(file_name, ...args);
      };
    }

    assert(!ts.sys.getScriptSnapshot);
    ts.sys.getScriptSnapshot = function (file_name) {
      return ts.ScriptSnapshot.fromString(fs.readFileSync(file_name, 'utf8'));
    };

    services_host = {
      getScriptFileNames: () => script_files,
      getCurrentDirectory: () => cwd,
      getCompilationSettings: () => config_data.options,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      getScriptVersion: (file_name) => files[file_name] && files[file_name].timestamp || 1,
      getScriptSnapshot: cachedUnwatched('getScriptSnapshot', function (file_name) {
        let file = files[file_name];
        if (!file || !file.contents) {
          console.log('UNEXPECTED getScriptSnapshot (returning undefined)', file_name);
          return undefined;
        }

        return ts.ScriptSnapshot.fromString(file.contents.toString());
      }),
      fileExists: cachedUnwatched('fileExists', function (file_name) {
        if (files[file_name]) {
          return true;
        }
        return false;
      }),
      readFile: cachedUnwatched('readFile', function (file_name, encoding) {
        // In my testing, this never gets hit (getScriptSnapshot() is called instead),
        //   though could be implemented with something like:
        // return files[file_name]?.contents?.toString(encoding)
        console.log(`UNEXPECTED readFile(${file_name})`);
        assert(false);
      }),
      readDirectory: function (file_name, extensions, exclude, include, depth) {
        console.log('UNEXPECTED readDirectory', file_name, extensions, exclude, include, depth);
        assert(false);
      },
      directoryExists: cachedUnwatched('directoryExists', function (file_name) {
        // Assume all directories exist, fileExists will trivially fail if they actually don't
        return true;
      }),
      getDirectories: cachedUnwatched('getDirectories', function (file_name) {
        console.log('UNEXPECTED getDirectories', file_name);
        assert(false);
      }),
    };

    services = ts.createLanguageService(services_host, ts.createDocumentRegistry());

    format_host = {
      getCanonicalFileName: (p) => p,
      getCurrentDirectory: () => cwd,
      getNewLine: () => '\n',
    };

    next();
  }

  function typescriptFunc(job, done) {
    let updated_files = job.getFilesUpdated();
    let updated_names = {};
    let any_change = false;
    for (let ii = 0; ii < updated_files.length; ++ii) {
      let f = updated_files[ii];
      if (!f.contents) {
        delete files[f.relative];
        any_change = true;
      } else {
        if (!files[f.relative]) {
          any_change = true;
        }
        updated_names[f.relative] = true;
        files[f.relative] = f;
      }
    }
    if (any_change) {
      script_files = Object.keys(files).filter((s) => s.endsWith('.ts'));
    }

    function logDiagnostic(diagnostic) {
      let message = ts.formatDiagnosticsWithColorAndContext([diagnostic], format_host)
        .trimEnd() // Remove extra new line character in the end
        .replace(/\n\s*\n/, '\n'); // Remove empty line before the file context
      switch (diagnostic.category) {
        case ts.DiagnosticCategory.Warning:
          job.warn(message);
          break;
        case ts.DiagnosticCategory.Error:
          job.error(message);
          break;
        case ts.DiagnosticCategory.Message:
        case ts.DiagnosticCategory.Suggestion:
        default:
          job.log(message);
          break;
      }
    }

    asyncSeries([
      function handleConfigLoadOrChange(next) {
        let steps = [];
        if (!files[config_path]) {
          steps.push(function (next) {
            job.depAdd(config_path, function (err, f) {
              if (err) {
                return next(err);
              }
              files[f.relative] = f;
              updated_names[f.relative] = true;
              next();
            });
          });
        }
        steps.push(function (next) {
          if (!updated_names[config_path]) {
            return next();
          }

          // We already have the config file in memory, just "read" it
          const DUMMY_CONFIG = 'dummy';
          let config_read_host = {
            ...services_host,
            onUnRecoverableConfigFileDiagnostic: logDiagnostic,
            readFile: (file_name, encoding) => {
              assert.equal(file_name, DUMMY_CONFIG);
              return files[config_path].contents.toString(encoding);
            },
            readDirectory: () => [], // not needed just to parse the config file
          };
          try {
            config_data = ts.getParsedCommandLineOfConfigFile(DUMMY_CONFIG, undefined, config_read_host);
          } catch (err2) {
            return next(err2);
          }
          next();
        }, function (next) {
          if (!config_data) {
            return next('Could not read config file');
          }
          return next();
        });

        asyncSeries(steps, next);
      },
      function handleFileChanges(next) {
        // Seems there's no optimal way to just feed it the changes and get the
        //   current set of warnings, so we query each file just as
        //   createWatchCompilerHost does internally.

        let all_diagnostics = services.getCompilerOptionsDiagnostics();

        script_files.forEach(function (file_name) {
          all_diagnostics.push(services.getSyntacticDiagnostics(file_name));
          all_diagnostics.push(services.getSemanticDiagnostics(file_name));
        });

        all_diagnostics = ts.sortAndDeduplicateDiagnostics(all_diagnostics.flat());

        all_diagnostics.forEach(logDiagnostic);
        past_first_run = true;
        next();
      },
    ], done);
  }

  return {
    type: gb.ALL,
    init: typescriptInit,
    func: typescriptFunc,
    async: gb.ASYNC_FORK,
    version: [opts],
  };
};
