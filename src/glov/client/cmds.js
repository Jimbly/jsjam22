// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/* eslint-disable import/order */
const cmd_parse_mod = require('glov/common/cmd_parse.js');
const local_storage = require('./local_storage.js');
export let cmd_parse = cmd_parse_mod.create({ storage: local_storage });

const engine = require('./engine.js');
const { errorReportDetailsString } = require('./error_report.js');
const { fetchDelaySet } = require('./fetch.js');
const net = require('./net.js');
const { netClient, netDisconnected } = net;
const { SEMANTIC } = require('./shaders.js');
const { textureGetAll } = require('./textures.js');
const { netDelayGet, netDelaySet } = require('glov/common/wscommon.js');

window.cmd = function (str) {
  cmd_parse.handle(null, str, cmd_parse_mod.defaultHandler);
};

function byteFormat(bytes) {
  if (bytes > 850000) {
    return `${(bytes/(1024*1024)).toFixed(2)}MB`;
  }
  if (bytes > 850) {
    return `${(bytes/1024).toFixed(2)}KB`;
  }
  return `${bytes}B`;
}

cmd_parse.register({
  cmd: 'texmem',
  help: 'Displays texture memory usage',
  func: function (str, resp_func) {
    let all_textures = textureGetAll();
    let keys = Object.keys(all_textures);
    keys = keys.filter((a) => all_textures[a].gpu_mem > 1024);
    keys.sort((a, b) => all_textures[a].gpu_mem - all_textures[b].gpu_mem);
    resp_func(null, keys.map((a) => `${byteFormat(all_textures[a].gpu_mem)} ${a}`).join('\n'));
  }
});

cmd_parse.register({
  cmd: 'gpumem',
  help: 'Displays GPU memory usage summary',
  func: function (str, resp_func) {
    let { gpu_mem } = engine.perf_state;
    resp_func(null, `${byteFormat(gpu_mem.geom)} Geo\n${byteFormat(gpu_mem.tex)} Tex\n${
      byteFormat(gpu_mem.geom + gpu_mem.tex)} Total`);
  }
});

function validDefine(str) {
  if (SEMANTIC[str]) {
    return false;
  }
  return str.match(/^[A-Z][A-Z0-9_]*$/);
}

cmd_parse.register({
  cmd: 'd',
  help: 'Toggles a debug define',
  func: function (str, resp_func) {
    str = str.toUpperCase().trim();
    if (!str) {
      if (engine.definesClearAll()) {
        return void resp_func(null, 'All debug defines cleared');
      } else {
        return void resp_func(null, 'No debug defines active');
      }
    }
    if (!validDefine(str)) {
      return void resp_func('Invalid define specified');
    }
    engine.defines[str] = !engine.defines[str];
    resp_func(null, `D=${str} now ${engine.defines[str]?'SET':'unset'}`);
    engine.definesChanged();
  }
});

cmd_parse.register({
  cmd: 'renderer',
  help: 'Displays current renderer',
  func: function (str, resp_func) {
    resp_func(null, `Renderer=WebGL${engine.webgl2?2:1}`);
  }
});

function cmdDesc(cmd_data) {
  return `/${cmd_data.cmd} - ${cmd_data.help}`;
}

cmd_parse.register({
  cmd: 'help',
  help: 'Searches commands',
  func: function (str, resp_func) {
    let list = cmd_parse.autoComplete('', this && this.access);
    if (str) {
      let str_cname = cmd_parse.canonical(str);
      let str_lc = str.toLowerCase();
      list = list.filter((cmd_data) => cmd_data.cname.indexOf(str_cname) !== -1 ||
          cmd_data.help.toLowerCase().indexOf(str_lc) !== -1);
    }
    if (!list.length) {
      return void resp_func(null, `No commands found matching "${str}"`);
    }
    resp_func(null, list.map(cmdDesc).join('\n'));
  }
});

export let safearea = [-1,-1,-1,-1];
cmd_parse.registerValue('safe_area', {
  label: 'Safe Area',
  type: cmd_parse.TYPE_STRING,
  usage: 'Safe Area value: Use -1 for auto based on browser environment,\n' +
    'or 0-25 for percentage of screen size\n' +
    '  Usage: /safe_area [value]\n' +
    '  Usage: /safe_area horizontal,vertical\n' +
    '  Usage: /safe_area left,right,top,bottom',
  default_value: '-1',
  get: () => (safearea[0] === -1 ? '-1 (auto)' : safearea.join(',')),
  set: (v) => {
    v = String(v);
    let keys = v.split(',');
    if (v && keys.length === 1) {
      safearea[0] = safearea[1] = safearea[2] = safearea[3] = Number(v);
    } else if (keys.length === 2) {
      safearea[0] = safearea[1] = Number(keys[0]);
      safearea[2] = safearea[3] = Number(keys[1]);
    } else if (keys.length === 4) {
      for (let ii = 0; ii < 4; ++ii) {
        safearea[ii] = Number(keys[ii]);
      }
    } else {
      // error, ignore?
    }
    for (let ii = 0; ii < 4; ++ii) {
      if (!isFinite(safearea[ii])) {
        safearea[ii] = -1;
      }
    }
  },
  store: true,
});

cmd_parse.register({
  cmd: 'webgl2_auto',
  help: 'Resets WebGL2 auto-detection',
  func: function (str, resp_func) {
    let disable_data = local_storage.getJSON('webgl2_disable');
    if (!disable_data) {
      return resp_func(null, 'WebGL2 is already being auto-detected');
    }
    local_storage.setJSON('webgl2_disable', undefined);
    return resp_func(null, 'WebGL2 was disabled, will attempt to use it again on the next load');
  },
});

cmd_parse.registerValue('postprocessing', {
  label: 'Postprocessing',
  type: cmd_parse.TYPE_INT,
  help: 'Enables/disables postprocessing',
  get: () => (engine.postprocessing ? 1 : 0),
  set: (v) => engine.postprocessingAllow(v),
});

cmd_parse.register({
  cmd: 'net_delay',
  help: 'Sets/shows network delay values',
  usage: '$HELP\n/net_delay time_base time_rand',
  func: function (str, resp_func) {
    if (str) {
      let params = str.split(' ');
      netDelaySet(Number(params[0]), Number(params[1]) || 0);
      fetchDelaySet(Number(params[0]), Number(params[1]) || 0);
    }
    let cur = netDelayGet();
    resp_func(null, `Client NetDelay: ${cur[0]}+${cur[1]}`);
  }
});

cmd_parse.register({
  cmd: 'error_report_details',
  help: 'Shows details submitted with any error report',
  access_show: ['hidden'],
  func: function (str, resp_func) {
    resp_func(null, errorReportDetailsString());
  },
});

cmd_parse.register({
  cmd: 'disconnect',
  help: 'Forcibly disconnect WebSocket connection (Note: will auto-reconnect)',
  prefix_usage_with_help: true,
  usage: '/disconnect [disconnnect_duration [disconnect_delay]]',
  func: function (str, resp_func) {
    let socket = netClient()?.socket;
    if (!socket) {
      return void resp_func('No socket');
    }
    if (netDisconnected()) {
      return void resp_func('Not connected');
    }
    let params = str.split(' ').map(Number);
    let disconnect_duration = isFinite(params[0]) ? params[0] : 0;
    let disconnect_delay = isFinite(params[1]) ? params[1] : 0;
    netClient().retry_extra_delay = disconnect_duration;
    if (disconnect_delay) {
      setTimeout(socket.close.bind(socket), disconnect_delay);
    } else {
      socket.close();
    }
    resp_func();
  },
});

export function resetSettings() {
  let results = cmd_parse.resetSettings();
  if (engine.definesClearAll()) {
    results.push('Debug defines cleared');
  }
  if (!results.length) {
    return null;
  }
  results.push('Please restart the app or reload to page for the new settings to take effect.');
  return results.join('\n');
}

cmd_parse.register({
  cmd: 'reset_settings',
  help: 'Resets all settings and options to their defaults (Note: requires an app restart)',
  func: function (str, resp_func) {
    resp_func(null, resetSettings() || 'No stored settings to reset');
  },
});
