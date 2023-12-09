module.exports = function (gb) {
  let config = {
    server_js_files: [
      '**/*.[jt]s',
      '!**/*.d.ts',
      '!**/client/**/*',
    ],
    server_static: ['**/glov/common/words/*.gkg', '**/glov/common/words/*.txt'],
    all_js_files: ['**/*.[jt]s', '!client/vendor/**/*'],
    client_js_files: [
      '**/*.[jt]s',
      '!**/*.d.ts',
      '!**/server/**/*.[jt]s',
      '!client/vendor/**/*.[jt]s',
    ],
    client_json_files: ['client/**/*.json', 'client/**/*.json5', '!client/vendor/**/*.json'],
    server_json_files: ['server/**/*.json', 'server/**/*.json5'],
    client_html: ['client/**/*.html'],
    client_html_index: ['**/client/index.html'],
    extra_client_html: [],
    client_css: ['client/**/*.css', '!client/sounds/Bfxr/**'],
    client_png: [
      'client/**/*.png',
    ],
    client_png_alphafix: [
      '**',
      '!client/spine/**/*.png', // Already has appropriate color channel
      '!client/img/font/*.png', // Should already be imagemin'd, do not bloat this
    ],
    client_autosound: [
      'client/sounds/**/*.wav',
      'client/sounds/**/*.mp3',
    ],
    client_autosound_config: null, // default: wav to 512kb, mp3 at 128kbps, ogg
    client_static: [
      'client/**/*.webm',
      'client/**/*.ogg',
      // 'client/**/*.png',
      'client/**/*.jpg',
      'client/**/*.glb',
      'client/**/*.ico',
      'client/**/*.ttf',
      'client/**/*.woff',
      'client/**/*.woff2',
      '!**/unused/**',
      '!client/sounds/Bfxr/**',
      // 'client/**/vendor/**',
      // 'client/manifest.json',
    ],
    client_single_min: [
      'glov/common/replacement_chars.js',
    ],
    compress_files: [
      'client/**',
      '!**/*.png',
      '!**/*.jpg',
      '!**/*.mp3',
      '!**/*.ogg',
      '!**/*.webm',
      '!**/*.js.map',
    ],
    client_fsdata: [
      'client/shaders/**',
      'glov/client/shaders/**',
      'glov/client/models/box_textured_embed.glb',
      'glov/client/words/*.txt',
      'glov/common/words/*.gkg',
      'glov/common/words/*.txt',
      'client_texproc:**/*.tflag',
    ],
    fsdata_embed: ['.json', '.tflag'],
    fsdata_strip: ['.json'],
    // files in client/*, presumably bundled into fsdata, that should be placed in server/*
    // Note: no files in base GLOV.js build, but input cannot be empty, so using dummy path
    server_fsdata: ['client/does/not/exists/*'],
    default_defines: {
      PLATFORM: 'web',
      ENV: '',
    },
    extra_index: [],
    bundles: [{
      entrypoint: 'app',
      deps: 'app_deps',
      is_worker: false,
      do_version: 'client/app.ver.json',
      do_reload: true,
    }],
    extra_client_tasks: [],
    extra_prod_inputs: [], // Will bypass the production zip bundling, but still get in the raw production output
    extra_zip_inputs: [],
    client_intermediate_input: [
      'client_json:**',
      'client_js_uglify:**',
    ],
    preresolve_params: { modules: { glov: 'glov' } },
    optipng: {
      //   Note: always lossless, safe to use with anything
      optimizationLevel: 3, // 0...7
      bitDepthReduction: true,
      colorTypeReduction: true,
      paletteReduction: true,
      interlaced: false,
      errorRecovery: true,
    },
    zopfli: {
      //   Note: always lossless, safe to use with anything
      transparent: false, // allow altering hidden colors of transparent pixels
      '8bit': false,
      iterations: 15,
      more: false,
    },
    browsersync_queryparams: '', // e.g. '?D=FOO'
  };
  // eslint-disable-next-line global-require
  require('./config.project.js')(config, gb);
  return config;
};
