// Portions Copyright 2020 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

import assert from 'assert';
import { asyncParallel } from 'glov-async';
import { clamp, defaults, deprecate, matchAll } from 'glov/common/util';
import { v3copy, vec4 } from 'glov/common/vmath';
import * as camera2d from './camera2d';
import { getAbilityChat } from './client_config';
import { cmd_parse } from './cmds';
import * as engine from './engine';
import * as glov_font from './font';
import { ALIGN } from './font';
import * as input from './input';
import { link } from './link';
import * as local_storage from './local_storage';
import { getStringIfLocalizable } from './localization';
import { netClient, netClientId, netSubs, netUserId } from './net';
import { scrollAreaCreate } from './scroll_area';
import * as settings from './settings';
import { isFriend } from './social';
import { spotUnfocus } from './spot';
import * as ui from './ui';
import { uiTextHeight } from './ui';
import { uiStyleCurrent } from './uistyle';
import { profanityFilter, profanityStartup } from './words/profanity';

const { ceil, floor, max, min, round } = Math;

deprecate(exports, 'create', 'chatUICreate');

export const CHAT_FLAG_EMOTE = 1;
export const CHAT_FLAG_USERCHAT = 2;

Z.CHAT = Z.CHAT || 500;
Z.CHAT_FOCUSED = Z.CHAT_FOCUSED || Z.CHAT;

const color_user_rollover = vec4(1, 1, 1, 0.5);
const color_same_user_rollover = vec4(1, 1, 1, 0.25);

const MAX_PER_STYLE = {
  join_leave: 3,
};

function messageFromUser(msg) {
  return msg.style !== 'error' && msg.style !== 'system';
}

settings.register({
  chat_auto_unfocus: {
    default_value: 0,
    type: cmd_parse.TYPE_INT,
    range: [0,1],
    help: 'Automatically unfocus chat after sending a message',
  },
  chat_show_join_leave: {
    default_value: 1,
    type: cmd_parse.TYPE_INT,
    range: [0,1],
    label: 'Show join/leave messages',
    help: 'Show join/leave messages',
  },
  profanity_filter: {
    default_value: 1,
    type: cmd_parse.TYPE_INT,
    range: [0,1],
    help: 'Filter profanity in chat',
  },
});

function CmdHistory() {
  assert(local_storage.getStoragePrefix() !== 'demo'); // wrong initialization order
  this.entries = new Array(50);
  this.idx = local_storage.getJSON('console_idx'); // where we will next insert
  if (typeof this.idx !== 'number' || this.idx < 0 || this.idx >= this.entries.length) {
    this.idx = 0;
  } else {
    for (let ii = 0; ii < this.entries.length; ++ii) {
      this.entries[ii] = local_storage.getJSON(`console_e${ii}`);
    }
  }
  this.resetPos();
}
CmdHistory.prototype.setHist = function (idx, text) {
  this.entries[idx] = text;
  local_storage.setJSON(`console_e${idx}`, text);
};
CmdHistory.prototype.add = function (text) {
  if (!text) {
    return;
  }
  let idx = this.entries.indexOf(text);
  if (idx !== -1) {
    // already in there, just re-order
    let target = (this.idx - 1 + this.entries.length) % this.entries.length;
    while (idx !== target) {
      let next = (idx + 1) % this.entries.length;
      this.setHist(idx, this.entries[next]);
      idx = next;
    }
    this.setHist(target, text);
    return;
  }
  this.setHist(this.idx, text);
  this.idx = (this.idx + 1) % this.entries.length;
  local_storage.setJSON('console_idx', this.idx);
  this.resetPos();
};
CmdHistory.prototype.unadd = function (text) {
  // upon error, do not store this string in our history
  let idx = (this.idx - 1 + this.entries.length) % this.entries.length;
  if (this.entries[idx] !== text) {
    return;
  }
  this.idx = idx;
  local_storage.setJSON('console_idx', this.idx);
  this.resetPos();
};
CmdHistory.prototype.resetPos = function () {
  this.hist_idx = this.idx;
  this.edit_line = '';
};
CmdHistory.prototype.prev = function (cur_text) {
  if (this.hist_idx === this.idx) {
    // if first time goine backwards, stash the current edit line
    this.edit_line = cur_text;
  }
  let idx = (this.hist_idx - 1 + this.entries.length) % this.entries.length;
  let text = this.entries[idx];
  if (idx === this.idx || !text) {
    // wrapped around, or got to empty
    return this.entries[this.hist_idx] || '';
  }
  this.hist_idx = idx;
  return text || '';
};
CmdHistory.prototype.next = function (cur_text) {
  if (this.hist_idx === this.idx) {
    return cur_text || '';
  }
  let idx = (this.hist_idx + 1) % this.entries.length;
  this.hist_idx = idx;
  if (this.hist_idx === this.idx) {
    // just got back to head
    let ret = this.edit_line;
    this.edit_line = '';
    return ret || '';
  }
  return this.entries[idx] || '';
};

function defaultGetRoles() {
  let user_public_data;
  if (netSubs() && netUserId() && netClient().connected) {
    let user_channel = netSubs().getMyUserChannel();
    user_public_data = user_channel.data && user_channel.data.public;
    if (user_public_data?.permissions?.sysadmin) {
      return { sysadmin: 1, csr: 1 };
    }
  }
  return {};
}

function ChatUI(params) {
  assert.equal(typeof params, 'object');
  assert.equal(typeof params.max_len, 'number');
  this.edit_text_entry = ui.createEditBox({
    placeholder: 'Chat',
    initial_focus: false,
    auto_unfocus: true,
    spatial_focus: false,
    max_len: params.max_len,
    text: '',
    suppress_up_down: true,
  });
  this.channel = null;

  let style = params.style || uiStyleCurrent();

  this.on_join = this.onMsgJoin.bind(this);
  this.on_leave = this.onMsgLeave.bind(this);
  this.on_chat = this.onMsgChat.bind(this);
  this.on_chat_cb = null;
  this.handle_cmd_parse = this.handleCmdParse.bind(this);
  this.handle_cmd_parse_error = this.handleCmdParseError.bind(this);
  cmd_parse.setDefaultHandler(this.handle_cmd_parse_error);
  this.clearChat();
  this.max_lines = params.max_lines || 8; // Max shown when chat not active
  this.max_messages = params.max_messages || 1000; // Size of history kept
  this.max_len = params.max_len;
  this.font_height = params.font_height || style.text_height;
  this.hide_disconnected_message = params.hide_disconnected_message || false;
  this.disconnected_message_top = params.disconnected_message_top || false;
  this.scroll_area = scrollAreaCreate({
    background_color: null,
    auto_scroll: true,
  });
  this.w = params.w || engine.game_width / 2;
  this.h = params.h || engine.game_height / 2; // excluding text entry
  this.inner_width_adjust = params.inner_width_adjust || 0;
  this.border = params.border || undefined;
  this.volume_join_leave = params.volume_join_leave || 0.15;
  this.volume_in = params.volume_in || 0.5;
  this.volume_out = params.volume_out || 0.5;
  this.msg_out_err_delay = params.msg_out_err_delay || 0; // Delay when playing msg_out_err after msg_out.
  this.history = new CmdHistory();
  this.get_roles = defaultGetRoles; // returns object for testing cmd access permissions
  this.url_match = params.url_match; // runs `/url match[1]` if clicked
  this.url_info = params.url_info; // Optional for grabbing the interesting portion of the URL for tooltip and /url
  this.user_context_cb = params.user_context_cb; // Cb called with { user_id } on click
  this.user_id_mouseover = false;

  this.fade_start_time = params.fade_start_time || [10000, 1000];
  this.fade_time = params.fade_time || [1000, 500];
  this.z_override = null; // 1-frame Z override

  this.setActiveSize(this.font_height, this.w);
  let outline_width = params.outline_width || 1;
  this.styles = defaults(params.styles || {}, {
    def: glov_font.style(null, {
      color: 0xEEEEEEff,
      outline_width,
      outline_color: 0x000000ff,
    }),
    error: glov_font.style(null, {
      color: 0xDD0000ff,
      outline_width,
      outline_color: 0x000000ff,
    }),
    link: glov_font.style(null, {
      color: 0x5040FFff,
      outline_width,
      outline_color: 0x000000ff,
    }),
    link_hover: glov_font.style(null, {
      color: 0x0000FFff,
      outline_width,
      outline_color: 0x000000ff,
    }),
    system: glov_font.style(null, {
      color: 0xAAAAAAff,
      outline_width,
      outline_color: 0x000000ff,
    }),
  });
  this.styles.join_leave = this.styles.system;
  this.classifyRole = params.classifyRole;

  if (netSubs()) {
    netSubs().on('chat_broadcast', this.onChatBroadcast.bind(this));
  }

  // for console debugging, overrides general (not forwarded to server, not access checked) version
  window.cmd = this.cmdParse.bind(this);
}

ChatUI.prototype.setActiveSize = function (font_height, w) {
  let wrap_w = w - this.scroll_area.barWidth();
  if (this.active_font_height !== font_height || this.wrap_w !== wrap_w) {
    this.active_font_height = font_height;
    this.indent = round(this.active_font_height/24 * 40);
    this.wrap_w = wrap_w;
    // recalc numlines
    this.total_lines = 0;
    for (let ii = 0; ii < this.msgs.length; ++ii) {
      let elem = this.msgs[ii];
      elem.numlines = ui.font.numLines((this.styles[elem.style] || this.styles.def),
        this.wrap_w, this.indent, this.active_font_height, elem.msg_text);
      this.total_lines += elem.numlines;
    }
  }
};

ChatUI.prototype.clearChat = function () {
  this.msgs = [];
  this.total_lines = 0;
};

function notHidden(msg) {
  return !msg.hidden;
}

ChatUI.prototype.addMsgInternal = function (elem) {
  elem.timestamp = elem.timestamp || Date.now();
  if (elem.flags & CHAT_FLAG_USERCHAT) {
    if (elem.flags & CHAT_FLAG_EMOTE) {
      elem.msg_text = `${elem.display_name} ${elem.msg}`;
    } else {
      elem.msg_text = `[${elem.display_name}] ${elem.msg}`;
    }
  } else {
    elem.msg_text = elem.msg;
  }
  elem.numlines = ui.font.numLines((this.styles[elem.style] || this.styles.def),
    this.wrap_w, this.indent, this.active_font_height, elem.msg_text);
  this.total_lines += elem.numlines;
  this.msgs.push(elem);
  let max_msgs = MAX_PER_STYLE[elem.style];
  if (max_msgs) {
    // Remove any more than max
    // Also remove any for the same ID (want for 'join_leave', maybe not others?)
    for (let ii = this.msgs.length - 2; ii >= 0; --ii) {
      let elem2 = this.msgs[ii];
      if (elem2.style === elem.style && !elem2.hidden) {
        if (elem.id && elem2.id === elem.id) {
          elem2.hidden = true;
          this.total_lines -= elem2.numlines;
          elem2.numlines = 0;
        } else {
          --max_msgs;
          if (max_msgs <= 0) {
            elem2.hidden = true;
            this.total_lines -= elem2.numlines;
            elem2.numlines = 0;
            break;
          }
        }
      }
    }
  }
  if (this.msgs.length > this.max_messages * 1.25) {
    this.msgs = this.msgs.filter(notHidden);
    if (this.msgs.length > this.max_messages * 1.25) {
      this.msgs.splice(0, this.msgs.length - this.max_messages);
      this.total_lines = 0;
      for (let ii = 0; ii < this.msgs.length; ++ii) {
        this.total_lines += this.msgs[ii].numlines;
      }
    }
  }
};

function toStr(val) {
  val = getStringIfLocalizable(val);
  return typeof val === 'string' ? val : JSON.stringify(val);
}

ChatUI.prototype.addChat = function (msg, style) {
  msg = toStr(msg);
  console.log(msg);
  this.addMsgInternal({ msg, style });
};
ChatUI.prototype.addChatFiltered = function (data) {
  data.msg = toStr(data.msg);
  console.log(`Chat from ${data.id}: ${data.msg}`);
  if (settings.profanity_filter && data.id !== (netUserId() || netClientId())) {
    data.msg = profanityFilter(data.msg);
  }
  this.addMsgInternal(data);
};
ChatUI.prototype.onMsgJoin = function (data) {
  if (!settings.chat_show_join_leave) {
    return;
  }
  if (data.client_id !== netClientId()) {
    if (this.volume_join_leave) {
      ui.playUISound('user_join', this.volume_join_leave);
    }
    this.addChatFiltered({
      id: data.user_id || data.client_id,
      display_name: data.display_name || data.client_id,
      flags: CHAT_FLAG_EMOTE|CHAT_FLAG_USERCHAT,
      msg: 'joined the channel',
      style: 'join_leave',
    });
  }
};
ChatUI.prototype.onMsgLeave = function (data) {
  if (!settings.chat_show_join_leave) {
    return;
  }
  if (this.volume_join_leave) {
    ui.playUISound('user_leave', this.volume_join_leave);
  }
  this.addChatFiltered({
    id: data.user_id || data.client_id,
    display_name: data.display_name || data.client_id,
    flags: CHAT_FLAG_EMOTE|CHAT_FLAG_USERCHAT,
    msg: 'left the channel',
    style: 'join_leave',
  });
};

ChatUI.prototype.registerOnMsgChatCB = function (cb) {
  assert(!this.on_chat_cb);
  this.on_chat_cb = cb;
};

ChatUI.prototype.onMsgChat = function (data) {
  if (this.on_chat_cb) {
    this.on_chat_cb(data);
  }
  let { msg, style, id, client_id, display_name, flags, ts, quiet } = data;
  if (!quiet && client_id !== netClientId()) {
    if (this.volume_in) {
      ui.playUISound('msg_in', this.volume_in);
    }
  }
  display_name = display_name || id;
  flags = (flags || 0) | CHAT_FLAG_USERCHAT;
  this.addChatFiltered({
    id,
    display_name,
    msg,
    style,
    flags,
    timestamp: ts,
    quiet,
  });
};
ChatUI.prototype.onChatBroadcast = function (data) {
  let { msg, src } = data;
  ui.playUISound('msg_err');
  this.addChatFiltered({
    msg: `[${src}] ${msg}`,
    style: 'error',
  });
};

ChatUI.prototype.focus = function () {
  this.edit_text_entry.focus();
};

ChatUI.prototype.runLate = function () {
  this.did_run_late = true;
  if (getAbilityChat() && input.keyDownEdge(input.KEYS.RETURN)) {
    this.focus();
  }
  if (input.keyDownEdge(input.KEYS.SLASH) ||
    input.keyDownEdge(input.KEYS.NUMPAD_DIVIDE)
  ) {
    this.focus();
    this.edit_text_entry.setText('/');
  }
};

ChatUI.prototype.addChatError = function (err) {
  this.addChat(`[error] ${toStr(err)}`, 'error');
};

ChatUI.prototype.handleCmdParseError = function (err, resp) {
  if (err) {
    this.addChatError(err);
  }
};

ChatUI.prototype.handleCmdParse = function (err, resp) {
  if (err) {
    this.addChatError(err);
  } else if (resp) {
    this.addChat(`[system] ${toStr(resp)}`, 'system');
  }
};

ChatUI.prototype.setGetRoles = function (fn) {
  this.get_roles = fn;
};

let access_dummy = { access: null };
ChatUI.prototype.getAccessObj = function () {
  access_dummy.access = this.get_roles();
  return access_dummy;
};

ChatUI.prototype.cmdParse = function (str, cb) {
  let handleResult = cb ?
    (err, resp) => {
      this.handle_cmd_parse(err, resp);
      if (cb) {
        cb(err, resp);
      }
    } :
    this.handle_cmd_parse;
  cmd_parse.handle(this.getAccessObj(), str, function (err, resp) {
    if (err && cmd_parse.was_not_found) {
      // forward to server
      netSubs().sendCmdParse(str, handleResult);
    } else {
      handleResult(err, resp);
    }
  });
};

ChatUI.prototype.cmdParseInternal = function (str) {
  cmd_parse.handle(this.getAccessObj(), str, this.handle_cmd_parse_error);
};

function pad2(str) {
  return `0${str}`.slice(-2);
}
function conciseDate(dt) {
  return `${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())} ${pad2(dt.getHours())
  }:${pad2(dt.getMinutes())}:${pad2(dt.getSeconds())}`;
}
let help_font_style = glov_font.styleColored(null, 0x000000ff);
let help_font_style_cmd = glov_font.style(help_font_style, {
  outline_width: 0.5,
  outline_color: 0x000000FF,
});
let help_rollover_color = vec4(0, 0, 0, 0.25);
let help_rollover_color2 = vec4(0, 0, 0, 0.125);
const TOOLTIP_MIN_PAGE_SIZE = 20;
let tooltip_page = 0;
let tooltip_last = '';
let tooltip_panel_color = vec4();
function drawHelpTooltip(param) {
  assert(Array.isArray(param.tooltip));
  let tooltip = param.tooltip;
  let num_pages = 1;
  let h = param.font_height;
  let eff_tooltip_pad = floor(ui.tooltip_pad * 0.5);
  let num_per_page = min(TOOLTIP_MIN_PAGE_SIZE, max(1, floor((param.y - camera2d.y0() - eff_tooltip_pad) / h) - 1));
  if (tooltip.length > 20) {
    let text = tooltip.join('\n');
    if (text !== tooltip_last) {
      tooltip_page = 0;
      tooltip_last = text;
    }
    num_pages = ceil(tooltip.length / num_per_page);
    tooltip = tooltip.slice(tooltip_page * num_per_page, (tooltip_page + 1) * num_per_page);
  } else {
    tooltip_page = 0;
    tooltip_last = '';
  }
  let w = param.tooltip_width;
  let x = param.x;
  let z = param.z || (Z.TOOLTIP + 5);
  let text_x = x + eff_tooltip_pad;
  let text_w = w - eff_tooltip_pad * 2;
  let tooltip_y1 = param.y;

  let alpha = 1;
  let vis_h = eff_tooltip_pad * 2 + h * tooltip.length;
  if (!param.do_selection && num_pages === 1 && input.mouseOver({
    x,
    y: tooltip_y1 - vis_h,
    w,
    h: vis_h,
  })) {
    alpha = 0.15;
  }
  let style = help_font_style;
  if (alpha !== 1) {
    style = glov_font.styleAlpha(style, alpha);
  }

  let y = tooltip_y1 - eff_tooltip_pad;
  let ret = null;
  if (num_pages > 1) {
    y -= h;
    ui.font.drawSizedAligned(help_font_style,
      text_x, y, z+1, h, ALIGN.HCENTER,
      text_w, 0,
      `Page ${tooltip_page + 1} / ${num_pages}`);
    let pos = { x, y, w, h };
    if (input.mouseUpEdge(pos)) { // up instead of down to prevent canvas capturing focus
      tooltip_page = (tooltip_page + 1) % num_pages;
    } else if (input.mouseOver(pos)) {
      ui.drawRect(x, y, x + w, y + h, z + 0.5, help_rollover_color);
    }
  }
  for (let ii = tooltip.length - 1; ii >= 0; --ii) {
    let line = tooltip[ii];
    if (param.wrap) {
      y -= h * ui.font.numLines(style, text_w, 0, h, line);
    } else {
      y -= h;
    }
    let idx = line.indexOf(' ');
    if (line[0] === '/' && idx !== -1 && param.do_selection) {
      // is a command
      let cmd = line.slice(0, idx);
      let help = line.slice(idx);
      let cmd_w = ui.font.drawSized(help_font_style_cmd,
        text_x, y, z+1, h, cmd);
      ui.font.drawSizedAligned(help_font_style,
        text_x + cmd_w, y, z+2, h, ALIGN.HFIT,
        text_w - cmd_w, 0,
        help);
      let pos = { x, y, w, h };
      if (input.mouseUpEdge(pos)) { // up instead of down to prevent canvas capturing focus
        ret = cmd.slice(1);
      } else if (input.mouseOver(pos)) {
        ui.drawRect(x, y, text_x + cmd_w + 4, y + h, z + 0.5, help_rollover_color);
        ui.drawRect(text_x + cmd_w + 4, y, x + w, y + h, z + 0.5, help_rollover_color2);
      }
    } else {
      ui.font.drawSizedAligned(style,
        text_x, y, z+1, h, param.wrap ? ALIGN.HWRAP : ALIGN.HFIT,
        text_w, 0,
        line);
    }
  }
  y -= eff_tooltip_pad;
  let pixel_scale = ui.tooltip_panel_pixel_scale * 0.5;

  v3copy(tooltip_panel_color, ui.color_panel);
  tooltip_panel_color[3] = alpha;
  ui.panel({
    x, y, z, w,
    h: tooltip_y1 - y,
    pixel_scale,
    color: tooltip_panel_color,
  });
  return ret;
}

ChatUI.prototype.isFocused = function () {
  return this.edit_text_entry && this.edit_text_entry.isFocused();
};

ChatUI.prototype.sendChat = function (flags, text) {
  if (!netClient() || !netClient().connected) {
    this.addChatError('Cannot chat: Disconnected');
  } else if (!this.channel) {
    this.addChatError('Cannot chat: Must be in a channel');
  } else if (!netSubs().loggedIn() && !netSubs().allow_anon) {
    this.addChatError('Cannot chat: Must be logged in');
  } else if (text.length > this.max_len) {
    this.addChatError('Chat message too long');
  } else {
    let pak = this.channel.pak('chat');
    pak.writeInt(flags);
    pak.writeString(text);
    pak.send((err, data) => {
      if (err) {
        if (err === 'ERR_ECHO') {
          let roles = this.channel?.data?.public?.clients[netClientId()]?.ids?.roles;
          let style = this.classifyRole && this.classifyRole(roles, true);
          this.onMsgChat({
            msg: text,
            style: style,
            id: netUserId(),
            client_id: netClientId(),
            display_name: netSubs().getDisplayName(),
            flags,
          });
        } else {
          this.addChatError(err);
          if (!this.edit_text_entry.getText()) {
            this.edit_text_entry.setText(text);
          }
        }
      }
    });
  }
};

ChatUI.prototype.setZOverride = function (z) {
  this.z_override = z;
};

ChatUI.prototype.run = function (opts) {
  const UI_SCALE = uiTextHeight() / 24;
  opts = opts || {};
  if (!getAbilityChat()) {
    opts.hide = true;
  }
  const border = opts.border || this.border || (8 * UI_SCALE);
  const SPACE_ABOVE_ENTRY = border;
  const scroll_grow = opts.scroll_grow || 0;
  if (netClient() && netClient().disconnected && !this.hide_disconnected_message) {
    ui.font.drawSizedAligned(
      glov_font.style(null, {
        outline_width: 2,
        outline_color: 0x000000ff,
        color: 0xDD2020ff
      }),
      camera2d.x0(),
      this.disconnected_message_top ? engine.game_height * 0.80 : camera2d.y0(),
      Z.DEBUG,
      uiTextHeight(),
      this.disconnected_message_top ? ALIGN.HCENTER : ALIGN.HVCENTER,
      camera2d.w(), camera2d.h() * 0.20,
      `Connection lost, attempting to reconnect (${(netClient().timeSinceDisconnect()/1000).toFixed(0)})...`);
  }

  // Test sending a stream of chat
  // if (engine.defines.CHATTER) {
  //   this.chatter_countdown = (this.chatter_countdown || 0) - engine.frame_dt;
  //   if (this.chatter_countdown < 0) {
  //     this.sendChat(0, `Something random ${Math.random()}`);
  //     this.chatter_countdown = 1000 * Math.random();
  //   }
  // }

  if (!this.did_run_late) {
    this.runLate();
  }
  this.did_run_late = false;
  const x0 = opts.x === undefined ? camera2d.x0() : opts.x;
  const y0 = opts.y === undefined ? camera2d.y1() - this.h : opts.y;
  const y1 = y0 + this.h;
  let x = x0 + border;
  let y = y1;
  let outer_w = this.w;
  let was_focused = this.isFocused();
  let z = this.z_override || (was_focused ? Z.CHAT_FOCUSED : Z.CHAT);
  this.z_override = null;
  let is_focused = false;
  let font_height = this.font_height;
  let anything_visible = false;
  let hide_light = (opts.hide || engine.defines.NOUI || !netSubs().loggedIn()) &&
    !was_focused ?
    1 : // must be numerical, used to index fade values
    0;
  let hide_text_input = ui.modal_dialog || ui.menu_up || hide_light;
  if (!hide_text_input && was_focused && input.touch_mode) {
    // expand chat when focused on touch devices
    outer_w = camera2d.x1() - x0 - 24 * UI_SCALE;
    let font_scale = 4;
    let aspect = camera2d.screenAspect();
    if (aspect > 2) { // scale up to font scale of 8
      font_scale = 4 + 4 * min((aspect - 2) / 8, 1);
    }
    font_height *= font_scale;
  }
  const inner_w = outer_w - border + this.inner_width_adjust;
  this.setActiveSize(font_height, inner_w); // may recalc numlines on each elem; updates wrap_w
  if (!hide_text_input) {
    anything_visible = true;
    y -= border + font_height + 1;
    if (!was_focused && opts.pointerlock && input.pointerLocked()) {
      // do not show edit box
      ui.font.drawSizedAligned(this.styles.def, x, y, z + 1, font_height, ALIGN.HFIT, inner_w, 0,
        '<Press Enter to chat>');
    } else {
      if (was_focused) {
        // Do auto-complete logic *before* edit box, so we can eat TAB without changing focus
        // Eat tab even if there's nothing to complete, for consistency
        let pressed_tab = !input.keyDown(input.KEYS.SHIFT) && input.keyDownEdge(input.KEYS.TAB);
        if (pressed_tab) {
          this.focus();
        }
        let cur_text = this.edit_text_entry.getText();
        if (cur_text) {
          if (cur_text[0] === '/') {
            // do auto-complete
            let autocomplete = cmd_parse.autoComplete(cur_text.slice(1), this.getAccessObj().access);
            if (autocomplete && autocomplete.length) {
              let first = autocomplete[0];
              let auto_text = [];
              let wrap = false;
              for (let ii = 0; ii < autocomplete.length; ++ii) {
                let elem = autocomplete[ii];
                auto_text.push(`/${elem.cmd} - ${elem.help}`);
              }
              let do_selection = false; // should we allow clicking in the tooltip?
              if (autocomplete.length === 1 &&
                first.cname &&
                cmd_parse.canonical(cur_text.slice(1)).slice(0, first.cname.length) === first.cname
              ) {
                // we've typed something that matches the first one
                if (first.usage) {
                  auto_text = first.usage.split('\n');
                } else {
                  auto_text = [first.help];
                }
                wrap = true;
              } else {
                do_selection = true;
              }
              let tooltip_y = y;
              // check if last message is an error, if so, tooltip above that.
              let last_msg = this.msgs[this.msgs.length - 1];
              if (last_msg) {
                let msg = last_msg.msg;
                if (msg && !(last_msg.flags & CHAT_FLAG_USERCHAT) && msg.slice(0, 7) === '[error]') {
                  let numlines = last_msg.numlines;
                  tooltip_y -= font_height * numlines + SPACE_ABOVE_ENTRY;
                }
              }

              let selected = drawHelpTooltip({
                x, y: tooltip_y,
                tooltip_width: max(inner_w, engine.game_width * 0.8),
                tooltip: auto_text,
                do_selection,
                font_height: min(font_height, camera2d.w() / 30),
                wrap,
              });
              if (do_selection) {
                // auto-completes to something different than we have typed
                // Do not use ENTER as well, because sometimes a hidden command is a sub-string of a shown command?
                if (pressed_tab || selected) {
                  this.edit_text_entry.setText(`/${selected || first.cmd} `);
                }
              }
            }
          }
        } else {
          this.history.resetPos();
        }
        if (input.keyDownEdge(input.KEYS.UP)) {
          this.edit_text_entry.setText(this.history.prev(cur_text));
        }
        if (input.keyDownEdge(input.KEYS.DOWN)) {
          this.edit_text_entry.setText(this.history.next(cur_text));
        }
        this.scroll_area.keyboardScroll();
      }
      let input_height = font_height;
      let input_width = inner_w - (opts.cuddly_scroll ? this.scroll_area.barWidth() + 1 + border : border);
      if (input.touch_mode && !was_focused) {
        y -= font_height * 2;
        input_height = font_height * 3;
        input_width = font_height * 6;
      }
      let res = this.edit_text_entry.run({
        x, y, w: input_width, font_height: input_height, pointer_lock: opts.pointerlock
      });
      is_focused = this.isFocused();
      if (res === this.edit_text_entry.SUBMIT) {
        this.scroll_area.scrollToEnd();
        let text = this.edit_text_entry.getText().trim();
        if (text) {
          let start_time = Date.now();
          this.edit_text_entry.setText('');
          if (text[0] === '/') {
            if (text[1] === '/') { // common error of starting with //foo because chat was already focused
              text = text.slice(1);
            }
            this.history.add(text);
            if (netSubs()) {
              netSubs().serverLog('cmd', text);
            }
            this.cmdParse(text.slice(1), (err) => {
              if (!err) {
                return;
              }
              if (this.volume_out) {
                setTimeout(
                  () => ui.playUISound('msg_out_err', this.volume_out),
                  max(0, this.msg_out_err_delay * 1000 - (Date.now() - start_time))
                );
              }
              if (!this.edit_text_entry.getText()) {
                // this.history.unadd(text);
                this.edit_text_entry.setText(text);
              }
              if (!is_focused) { // was auto-unfocused
                this.focus();
              }
            });
          } else {
            this.sendChat(0, text);
          }
          if (this.volume_out) {
            ui.playUISound('msg_out', this.volume_out); // after cmdParse may have adjust volume
          }
          if (settings.chat_auto_unfocus) {
            is_focused = false;
            spotUnfocus();
          }
        } else {
          is_focused = false;
          spotUnfocus();
        }
      }
    }
  }
  y -= SPACE_ABOVE_ENTRY;

  let { url_match, url_info, styles, wrap_w, user_context_cb } = this;
  let self = this;
  let do_scroll_area = is_focused || opts.always_scroll;
  let bracket_width = 0;
  let name_width = {};
  let did_user_mouseover = false;
  // Slightly hacky: uses `x` and `y` from the higher scope
  function drawChatLine(msg, alpha) {
    if (msg.hidden) {
      return;
    }
    let line = msg.msg_text;
    let numlines = msg.numlines;
    let is_url = do_scroll_area && url_match && matchAll(line, url_match);
    is_url = is_url && is_url.length === 1 && is_url[0];
    let url_label = is_url;
    if (is_url && url_info) {
      let m = is_url.match(url_info);
      if (m) {
        url_label = m[1];
      }
    }
    let h = font_height * numlines;
    let do_mouseover = do_scroll_area && !input.mousePosIsTouch() && (!msg.style || messageFromUser(msg) || is_url);
    let text_w;
    let mouseover = false;
    if (do_mouseover) {
      text_w = ui.font.getStringWidth(styles.def, font_height, line);
      // mouseOver peek because we're doing it before checking for clicks
      mouseover = input.mouseOver({ x, y, w: min(text_w, wrap_w), h, peek: true });
    }
    let user_mouseover = false;
    let user_indent = 0;
    let did_user_context = false;
    if ((msg.flags & CHAT_FLAG_USERCHAT) && user_context_cb && msg.id && do_scroll_area) {
      let nw = name_width[msg.display_name];
      if (!nw) {
        nw = name_width[msg.display_name] = ui.font.getStringWidth(styles.def, font_height, msg.display_name);
      }
      if (!(msg.flags & CHAT_FLAG_EMOTE)) {
        if (!bracket_width) {
          bracket_width = ui.font.getStringWidth(styles.def, font_height, '[]');
        }
        nw += bracket_width;
      }
      user_indent = nw;
      let pos_param = {
        x, y, w: min(nw, wrap_w), h: font_height, button: 0, peek: true,
        z: z + 0.5,
        color: color_user_rollover,
      };
      if (input.click(pos_param)) {
        did_user_context = true;
        user_context_cb({
          user_id: msg.id, // Need any other msg. params?
          // x: pos_param.x + pos_param.w,
          // y: pos_param.y,
        });
      } else {
        user_mouseover = input.mouseOver(pos_param);
        if (self.user_id_mouseover === msg.id) {
          ui.drawRect2({
            ...pos_param,
            color: color_same_user_rollover,
          });
        }
        if (user_mouseover) {
          ui.drawRect2(pos_param);
          did_user_mouseover = true;
          self.user_id_mouseover = msg.id;
        }
      }
    }
    let click;
    if (is_url) {
      click = link({ x: x + user_indent, y, w: wrap_w - user_indent, h, url: is_url, internal: true });
    }

    let style;
    if (is_url) {
      style = mouseover && !user_mouseover ? styles.link_hover : styles.link;
    } else {
      style = styles[msg.style] || styles.def;
    }

    // Draw the actual text
    ui.font.drawSizedWrapped(glov_font.styleAlpha(style, alpha), x, y, z + 1, wrap_w, self.indent, font_height, line);

    if (mouseover && (!do_scroll_area || y > self.scroll_area.getScrollPos() - font_height) &&
      // Only show tooltip for user messages or links
      (!msg.style || messageFromUser(msg) || is_url)
    ) {
      ui.drawTooltip({
        x, y, z: Z.TOOLTIP,
        tooltip_above: true,
        tooltip_width: 450 * UI_SCALE,
        tooltip_pad: round(ui.tooltip_pad * 0.5),
        tooltip: is_url && !user_mouseover ?
          `Click to open ${url_label}` :
          `Received${msg.id ? ` from "${msg.id}"` : ''} at ${conciseDate(new Date(msg.timestamp))}\n` +
          'Right-click to copy message' +
          `${(user_mouseover ? '\nClick to view user info' : '')}`,
        pixel_scale: ui.tooltip_panel_pixel_scale * 0.5,
      });
    }
    // Previously: mouseDownEdge because by the time the Up happens, the chat text might not be here anymore
    let longpress = input.longPress({ x, y, w: wrap_w, h });
    click = click || input.click({ x, y, w: wrap_w, h });
    if (did_user_context) {
      click = null;
    }
    if (click || longpress) {
      if (longpress || click.button === 2) {
        ui.provideUserString('Chat Text', is_url || line);
      } else if (is_url) {
        self.cmdParseInternal(`url ${url_label}`);
      }
    }
    anything_visible = true;
  }


  let now = Date.now();
  if (do_scroll_area) {
    // within scroll area, just draw visible parts
    let scroll_internal_h = this.total_lines * font_height;
    if (opts.cuddly_scroll) {
      let new_y = y1 - border;
      scroll_internal_h += new_y - y;
      y = new_y;
    }
    scroll_internal_h += scroll_grow;
    y += scroll_grow;
    let scroll_y0 = opts.always_scroll ? y0 + border - scroll_grow : y - min(this.h, scroll_internal_h);
    let scroll_external_h = y - scroll_y0;
    let clip_offs = 1; // for font outline
    this.scroll_area.begin({
      x: x - clip_offs,
      y: scroll_y0, z,
      w: inner_w + clip_offs,
      h: scroll_external_h,
      focusable_elem: this.edit_text_entry,
      auto_hide: this.total_lines <= 2,
    });
    let x_save = x;
    let y_save = y;
    x = clip_offs;
    y = 0;
    let y_min = this.scroll_area.getScrollPos();
    let y_max = y_min + scroll_external_h;
    for (let ii = 0; ii < this.msgs.length; ++ii) {
      let msg = this.msgs[ii];
      let h = font_height * msg.numlines;
      if (y <= y_max && y + h >= y_min) {
        drawChatLine(msg, 1);
      }
      y += h;
    }
    this.scroll_area.end(scroll_internal_h);
    x = x_save;
    y = y_save - scroll_external_h + scroll_grow;
    // Eat mouse events (not handled by above) in the scroll area to prevent unfocusing
    input.mouseDownEdge({ x: x0, y: y - border, w: outer_w, h: y1 - y + border });
    // But a click should dismiss it (important on fullscreen touch UI!)
    if (input.mouseUpEdge({ x: x0, y: y - border, w: outer_w, h: y1 - y + border,
      in_event_cb: opts.pointerlock ? input.pointerLockEnter : null })
    ) {
      spotUnfocus();
      is_focused = false;
    }
    // Also prevent mouseover from going to anything beneat it
    input.mouseOver({ x: x0, y: y - border, w: outer_w, h: y1 - y + border });
    // Also a mouse down anywhere outside of the chat UI should dismiss it
    if (is_focused && input.mouseDownEdge({ peek: true })) {
      // On touch, tapping doesn't always remove focus from the edit box!
      // Maybe this logic should be in the editbox logic?
      spotUnfocus();
      is_focused = false;
    }
  } else {
    // Just recent entries, fade them out over time
    let { max_lines } = this;
    for (let ii = 0; ii < this.msgs.length; ++ii) {
      let msg = this.msgs[this.msgs.length - ii - 1];
      let age = now - msg.timestamp;
      let alpha = 1 - clamp((age - this.fade_start_time[hide_light]) / this.fade_time[hide_light], 0, 1);
      if (!alpha || msg.quiet) {
        break;
      }
      let numlines = msg.numlines;
      if (numlines > max_lines && ii) {
        break;
      }
      max_lines -= numlines;
      let h = font_height * numlines;
      y -= h;
      drawChatLine(msg, alpha);
    }
  }

  if (!did_user_mouseover) {
    self.user_id_mouseover = false;
  }

  if (opts.pointerlock && is_focused && input.pointerLocked()) {
    // Gained focus undo pointerlock
    input.pointerLockExit();
  }

  if (!anything_visible && (ui.modal_dialog || ui.menu_up || hide_light)) {
    return;
  }
  ui.drawRect(x0, y - border, x0 + outer_w, y1, z, [0.3,0.3,0.3,0.8]);
};

ChatUI.prototype.setChannel = function (channel) {
  if (channel === this.channel) {
    return;
  }
  if (this.channel) {
    if (!channel) {
      this.addChat(`Left channel ${this.channel.channel_id}`);
    }
    this.channel.removeMsgHandler('chat', this.on_chat);
    this.channel.removeMsgHandler('join', this.on_join);
    this.channel.removeMsgHandler('leave', this.on_leave);
  }
  this.channel = channel;
  if (!this.channel) {
    return;
  }
  // joining a new one, clear first
  this.clearChat();
  channel.onMsg('chat', this.on_chat);
  channel.onMsg('join', this.on_join);
  channel.onMsg('leave', this.on_leave);
  let chat_history;
  let here = [];
  let here_map = {};
  let friends = [];
  asyncParallel([
    (next) => {
      channel.send('chat_get', null, (err, data) => {
        if (!err && data && data.msgs && data.msgs.length) {
          chat_history = data;
        }
        next();
      });
    },
    (next) => {
      channel.onceSubscribe((data) => {
        let clients = data && data.public && data.public.clients;
        if (clients) {
          for (let client_id in clients) {
            let client = clients[client_id];
            let user_id = client.ids && client.ids.user_id;
            let already_in_list = false;
            if (user_id && client.ids.display_name) {
              if (here_map[user_id]) {
                already_in_list = true;
              } else {
                here_map[user_id] = client.ids.display_name;
              }
            }
            if (client_id === netClientId() || already_in_list) {
              continue;
            }
            if (client.ids) {
              if (user_id && isFriend(user_id)) {
                friends.push(client.ids.display_name || user_id || client_id);
              } else {
                here.push(client.ids.display_name || user_id || client_id);
              }
            }
          }
        }
        next();
      });
    },
  ], () => {
    if (!this.channel) {
      // disconnected/left already
      return;
    }
    // First display chat history
    if (chat_history) {
      let messages_pre = this.msgs.slice(0);
      if (messages_pre.length) {
        this.msgs = [];
      }
      for (let ii = 0; ii < chat_history.msgs.length; ++ii) {
        let idx = (chat_history.idx + ii) % chat_history.msgs.length;
        let elem = chat_history.msgs[idx];
        if (elem && elem.msg) {
          elem.quiet = true;
          if (here_map[elem.id]) {
            elem.display_name = here_map[elem.id];
          }
          this.onMsgChat(elem);
        }
      }
      if (messages_pre.length) {
        // Sort the history so it is before any other messages received in the meantime
        this.msgs = this.msgs.concat(messages_pre);
      }
    }

    // Then join message
    this.addChat(`Joined channel ${this.channel.channel_id}`, 'join_leave');
    // Then who's here now
    if (here.length || friends.length) {
      let msg = [];
      if (here.length) {
        if (here.length > 10) {
          msg.push(`Other users already here: ${here.slice(0, 10).join(', ')} (and ${here.length - 10} more...)`);
        } else {
          msg.push(`Other users already here: ${here.join(', ')}`);
        }
      }
      if (friends.length) {
        msg.push(`Friends already here: ${friends.join(', ')}`);
      }
      this.addChatFiltered({
        msg: msg.join('\n'),
        style: 'join_leave',
      });
    }
  });
};

export function chatUICreate(params) {
  profanityStartup();
  let chat_ui = new ChatUI(params);
  function emote(str, resp_func) {
    if (!str) {
      return void resp_func(null, 'Usage: /me does something.');
    }

    if (params.emote_cb) {
      params.emote_cb(str);
    }

    chat_ui.sendChat(CHAT_FLAG_EMOTE, str);
  }
  cmd_parse.registerValue('volume_chat_joinleave', {
    type: cmd_parse.TYPE_FLOAT,
    label: 'Join/Leave chat message volume',
    range: [0,1],
    get: () => chat_ui.volume_join_leave,
    set: (v) => (chat_ui.volume_join_leave = v),
    store: true,
  });
  cmd_parse.registerValue('volume_chat_in', {
    type: cmd_parse.TYPE_FLOAT,
    label: 'Incoming chat message volume',
    range: [0,1],
    get: () => chat_ui.volume_in,
    set: (v) => (chat_ui.volume_in = v),
    store: true,
  });
  cmd_parse.registerValue('volume_chat_out', {
    type: cmd_parse.TYPE_FLOAT,
    label: 'Outgoing chat message volume',
    range: [0,1],
    get: () => chat_ui.volume_out,
    set: (v) => (chat_ui.volume_out = v),
    store: true,
  });
  cmd_parse.register({
    cmd: 'me',
    help: 'Sends a message emoting an action. Can also perform animated emotes.',
    usage: '$HELP\n  Example: /me jumps up and down!\n' +
    '    /me waves\n' +
    '    /me sits',
    func: emote,
  });
  // Also alias /em
  cmd_parse.register({
    access_show: ['hidden'],
    cmd: 'em',
    func: emote,
  });
  cmd_parse.register({
    cmd: 'echo',
    help: 'Echo text locally',
    func: (str, resp_func) => {
      chat_ui.addChatFiltered({ msg: str });
      resp_func();
    },
  });
  cmd_parse.register({
    cmd: 'csr_all',
    access_run: ['sysadmin'],
    help: '(Admin) Run a command as all users in the current channel',
    prefix_usage_with_help: true,
    usage: '  /csr_all command\n' +
      'Example: /csr_all me bows down',
    func: function (str, resp_func) {
      if (!(chat_ui.channel && chat_ui.channel.numSubscriptions())) {
        return void resp_func('Must be in a channel');
      }
      let clients = chat_ui.channel.getChannelData('public.clients', {});
      let count = 0;
      for (let client_id in clients) {
        let ids = clients[client_id].ids;
        if (ids?.user_id) {
          let cmd = str;
          let pak = netSubs().getChannelImmediate(`user.${ids.user_id}`).pak('csr_admin_to_user');
          pak.writeJSON(cmd_parse.last_access);
          pak.writeString(cmd);
          pak.writeAnsiString(client_id);
          pak.send(chat_ui.handle_cmd_parse);
          ++count;
        }
      }
      resp_func(null, `Sent command to ${count} user(s)`);
    }
  });
  cmd_parse.register({
    cmd: 'csr',
    access_run: ['csr'],
    help: '(CSR) Run a command as another user',
    prefix_usage_with_help: true,
    usage: '  /csr UserID command\n' +
      'Example: /csr jimbly gems -100',
    func: function (str, resp_func) {
      let idx = str.indexOf(' ');
      if (idx === -1) {
        return void resp_func('Invalid number of arguments');
      }
      let user_id = str.slice(0, idx);
      let desired_client_id = '';
      if (chat_ui.channel && chat_ui.channel.numSubscriptions()) {
        let clients = chat_ui.channel.getChannelData('public.clients', {});
        for (let client_id in clients) {
          let ids = clients[client_id].ids;
          if (ids?.user_id === user_id) {
            desired_client_id = client_id;
          }
        }
      }

      let cmd = str.slice(idx + 1);
      let pak = netSubs().getChannelImmediate(`user.${user_id}`).pak('csr_admin_to_user');
      pak.writeJSON(cmd_parse.last_access);
      pak.writeString(cmd);
      pak.writeAnsiString(desired_client_id);
      pak.send(resp_func);
    }
  });


  return chat_ui;
}
