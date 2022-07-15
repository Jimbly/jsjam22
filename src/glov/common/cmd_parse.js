// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/* eslint-disable import/order */
const assert = require('assert');
const { isInteger } = require('./util.js');
const { perfCounterAdd } = require('./perfcounters.js');

export function canonical(cmd) {
  return cmd.toLowerCase().replace(/[_.]/g, '');
}

export const TYPE_INT = 0;
export const TYPE_FLOAT = 1;
export const TYPE_STRING = 2;
const TYPE_NAME = ['INTEGER', 'NUMBER', 'STRING'];

export function defaultHandler(err, resp) {
  if (err) {
    console.error(err, resp);
  } else {
    console.info(resp);
  }
}

function checkAccess(access, list) {
  if (list) {
    for (let ii = 0; ii < list.length; ++ii) {
      if (!access || !access[list[ii]]) {
        return false;
      }
    }
  }
  return true;
}

function formatUsage(usage, help, prefix_help) {
  return !usage ? undefined :
    prefix_help ? `${help}\n${usage}`:
    help ? String(usage).replace(/\$HELP/, help) :
    String(usage);
}

function CmdParse(params) {
  this.cmds = {};
  this.cmds_for_complete = this.cmds;
  this.was_not_found = false;
  this.storage = params && params.storage; // expects .setJSON(), .getJSON()
  this.default_handler = defaultHandler;
  this.last_access = null;
  this.register({
    cmd: 'cmd_list',
    func: this.cmdList.bind(this),
    access_show: ['hidden'],
  });
}
CmdParse.prototype.cmdList = function (str, resp_func) {
  if (!this.cmd_list) {
    let list = this.cmd_list = {};
    for (let cmd in this.cmds) {
      let cmd_data = this.cmds[cmd];
      let access = []; // combine for data compaction
      if (cmd_data.access_show) {
        access = access.concat(cmd_data.access_show);
      }
      if (cmd_data.access_run) {
        access = access.concat(cmd_data.access_run);
      }
      if (access.indexOf('hidden') !== -1) {
        continue;
      }
      let data = {
        name: cmd_data.name,
        help: String(cmd_data.help),
      };
      if (cmd_data.usage) {
        data.usage = formatUsage(cmd_data.usage, cmd_data.help, cmd_data.prefix_usage_with_help);
      }
      if (access.length) {
        data.access_show = access;
      }
      list[cmd] = data;
    }
  }
  resp_func(null, this.cmd_list);
};

CmdParse.prototype.setDefaultHandler = function (fn) {
  assert(this.default_handler === defaultHandler); // Should only set this once
  this.default_handler = fn;
};
CmdParse.prototype.checkAccess = function (access_list) {
  return checkAccess(this.last_access, access_list);
};
CmdParse.prototype.handle = function (self, str, resp_func) {
  resp_func = resp_func || this.default_handler;
  this.was_not_found = false;
  let m = str.match(/^([^\s]+)(?:\s+(.*))?$/);
  if (!m) {
    resp_func('Missing command');
    return true;
  }
  let cmd = canonical(m[1]);
  let cmd_data = this.cmds[cmd];
  this.last_access = self && self.access;
  if (cmd_data && !checkAccess(this.last_access, cmd_data.access_run)) {
    // this.was_not_found = true;
    resp_func(`Access denied: "${m[1]}"`);
    return false;
  }
  if (!cmd_data) {
    this.was_not_found = true;
    resp_func(`Unknown command: "${m[1]}"`);
    this.was_not_found = false;
    return false;
  }
  perfCounterAdd(`cmd.${cmd}`);
  cmd_data.fn.call(self, m[2] || '', resp_func);
  return true;
};

CmdParse.prototype.register = function (param) {
  assert.equal(typeof param, 'object');
  let { cmd, func, help, usage, prefix_usage_with_help, access_show, access_run } = param;
  assert(cmd && func);
  let help_lower = String(help || '').toLowerCase();
  if (help_lower.includes('(admin)')) {
    assert(access_run && access_run.includes('sysadmin'));
  }
  if (help_lower.includes('(hidden)')) {
    assert(access_show && access_show.length);
  }
  this.cmds[canonical(cmd)] = {
    name: cmd,
    fn: func,
    help,
    usage,
    prefix_usage_with_help,
    access_show,
    access_run,
  };
};

function formatRangeValue(type, value) {
  let ret = String(value);
  if (type === TYPE_FLOAT && !ret.includes('.')) {
    ret += '.00';
  }
  return ret;
}

// Optional param.on_change(is_startup:boolean)
CmdParse.prototype.registerValue = function (cmd, param) {
  assert(TYPE_NAME[param.type] || !param.set);
  assert(param.set || param.get);
  let label = param.label || cmd;
  let store = param.store && this.storage || false;
  let store_key = `cmd_parse_${canonical(cmd)}`;
  if (param.ver) {
    store_key += `_${param.ver}`;
  }
  if (store) {
    assert(param.set);
    let init_value = this.storage.getJSON(store_key);
    if (init_value !== undefined) {
      // enforce stored values within current range
      if (param.range) {
        init_value = Number(init_value);
        if (!isFinite(init_value) || init_value < param.range[0] || init_value > param.range[1]) {
          init_value = undefined;
        }
      }
      if (init_value !== undefined) {
        param.set(init_value);
      }
      if (param.on_change) {
        param.on_change(true);
      }
    }
  }
  let fn = (str, resp_func) => {
    function value() {
      resp_func(null, `${label} = ${param.get()}`);
    }
    function usage() {
      resp_func(`Usage: /${cmd} ${TYPE_NAME[param.type]}`);
    }
    if (!str) {
      if (param.get && param.set) {
        // More explicit help for these automatic value settings
        let is_bool = param.type === TYPE_INT && param.range && param.range[0] === 0 && param.range[1] === 1;
        let help = [
          `${label}:`,
        ];
        if (param.range) {
          help.push(`Valid range: [${formatRangeValue(param.type, param.range[0])}...` +
            `${formatRangeValue(param.type, param.range[1])}]`);
        }
        let cur_value = param.get();
        if (is_bool) {
          help.push(`To disable: /${cmd} 0`);
          help.push(`To enable: /${cmd} 1`);
        } else {
          help.push(`To change: /${cmd} NewValue`);
          help.push(`  example: /${cmd} ${param.range ?
            cur_value === param.range[0] ? param.range[1] : param.range[0] : 1}`);
        }
        let def_value = param.default_value;
        if (def_value !== undefined) {
          help.push(`Default value = ${def_value}${is_bool ? ` (${def_value ? 'Enabled' : 'Disabled'})`: ''}`);
        }
        help.push(`Current value = ${cur_value}${is_bool ? ` (${cur_value ? 'Enabled' : 'Disabled'})`: ''}`);
        return resp_func(null, help.join('\n'));
      } else if (param.get) {
        return value();
      } else {
        return usage();
      }
    }
    if (!param.set) {
      return resp_func(`Usage: /${cmd}`);
    }
    let n = Number(str);
    if (param.range) {
      if (n < param.range[0]) {
        n = param.range[0];
      } else if (n > param.range[1]) {
        n = param.range[1];
      }
    }
    let store_value = n;
    if (param.type === TYPE_INT) {
      if (!isInteger(n)) {
        return usage();
      }
      param.set(n);
    } else if (param.type === TYPE_FLOAT) {
      if (!isFinite(n)) {
        return usage();
      }
      param.set(n);
    } else {
      store_value = str;
      param.set(str);
    }
    if (store) {
      this.storage.setJSON(store_key, store_value);
    }
    if (param.on_change) {
      param.on_change(false);
    }
    if (param.get) {
      return value();
    } else {
      return resp_func(null, `${label} udpated`);
    }
  };
  this.register({
    cmd,
    func: fn,
    help: param.help || ((param.get && param.set) ?
      `Set or display "${label}" value` :
      param.set ? `Set "${label}" value` : `Display "${label}" value`),
    usage: param.usage || ((param.get ? `Display "${label}" value\n  Usage: /${cmd}\n` : '') +
      (param.set ? `Set "${label}" value\n  Usage: /${cmd} NewValue` : '')),
    prefix_usage_with_help: param.prefix_usage_with_help,
    access_show: param.access_show,
    access_run: param.access_run,
  });
};

function cmpCmd(a, b) {
  if (a.cname < b.cname) {
    return -1;
  }
  return 1;
}

// for auto-complete
CmdParse.prototype.addServerCommands = function (new_cmds) {
  let cmds = this.cmds_for_complete;
  if (this.cmds_for_complete === this.cmds) {
    cmds = this.cmds_for_complete = {};
    for (let cname in this.cmds) {
      cmds[cname] = this.cmds[cname];
    }
  }
  for (let cname in new_cmds) {
    if (!cmds[cname]) {
      cmds[cname] = new_cmds[cname];
    }
  }
};

CmdParse.prototype.autoComplete = function (str, access) {
  let list = [];
  str = str.split(' ');
  let first_tok = canonical(str[0]);
  for (let cname in this.cmds_for_complete) {
    if (str.length === 1 && cname.slice(0, first_tok.length) === first_tok ||
      str.length > 1 && cname === first_tok
    ) {
      let cmd_data = this.cmds_for_complete[cname];
      if (checkAccess(access, cmd_data.access_show) && checkAccess(access, cmd_data.access_run)) {
        list.push({
          cname,
          cmd: cmd_data.name,
          help: String(cmd_data.help),
          usage: formatUsage(cmd_data.usage, cmd_data.help, cmd_data.prefix_usage_with_help),
        });
      }
    }
  }
  list.sort(cmpCmd);
  return list; // .slice(0, 20); Maybe?
};

CmdParse.prototype.canonical = canonical;

CmdParse.prototype.TYPE_INT = TYPE_INT;
CmdParse.prototype.TYPE_FLOAT = TYPE_FLOAT;
CmdParse.prototype.TYPE_STRING = TYPE_STRING;

export function create(params) {
  return new CmdParse(params);
}
