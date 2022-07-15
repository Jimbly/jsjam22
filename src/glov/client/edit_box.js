// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

exports.create = editBoxCreate; // eslint-disable-line no-use-before-define

const assert = require('assert');
const camera2d = require('./camera2d.js');
const engine = require('./engine.js');
const {
  KEYS,
  eatAllKeyboardInput,
  mouseConsumeClicks,
  keyUpEdge,
  pointerLockEnter,
  pointerLockExit,
  pointerLocked,
  inputClick,
} = require('./input.js');
const {
  SPOT_NAV_LEFT,
  SPOT_NAV_RIGHT,
  spotFocusCheck,
  spotFocusSteal,
  spotUnfocus,
  spotlog,
} = require('./spot.js');
const glov_ui = require('./ui.js');
const { uiGetDOMElem } = require('./ui.js');

let form_hook_registered = false;
let active_edit_box;
let active_edit_box_frame;

let this_frame_edit_boxes = [];
let last_frame_edit_boxes = [];

export function editBoxTick() {
  let expected_last_frame = engine.frame_index - 1;
  for (let ii = 0; ii < last_frame_edit_boxes.length; ++ii) {
    let edit_box = last_frame_edit_boxes[ii];
    if (edit_box.last_frame < expected_last_frame) {
      edit_box.unrun();
    }
  }
  last_frame_edit_boxes = this_frame_edit_boxes;
  this_frame_edit_boxes = [];
}

function setActive(edit_box) {
  active_edit_box = edit_box;
  active_edit_box_frame = engine.frame_index;
}

function formHook(ev) {
  ev.preventDefault();

  if (!active_edit_box || active_edit_box_frame < engine.frame_index - 1) {
    return;
  }
  active_edit_box.submitted = true;
  active_edit_box.updateText();
  if (active_edit_box.pointer_lock && !active_edit_box.text) {
    pointerLockEnter('edit_box_submit');
  }
}

let last_key_id = 0;

class GlovUIEditBox {
  constructor(params) {
    this.key = `eb${++last_key_id}`;
    this.x = 0;
    this.y = 0;
    this.z = Z.UI; // actually in DOM, so above everything!
    this.w = glov_ui.button_width;
    this.type = 'text';
    // this.h = glov_ui.button_height;
    this.font_height = glov_ui.font_height;
    this.text = '';
    this.placeholder = '';
    this.max_len = 0;
    this.zindex = null;
    this.uppercase = false;
    this.initial_focus = false;
    this.onetime_focus = false;
    this.auto_unfocus = false;
    this.initial_select = false;
    this.spellcheck = true;
    this.esc_clears = true;
    this.multiline = 0;
    this.autocomplete = false;
    this.custom_nav = {
      // We want left/right to be handled by the input element, not used to change focus.
      [SPOT_NAV_LEFT]: null,
      [SPOT_NAV_RIGHT]: null,
    };
    this.sticky_focus = true;
    this.applyParams(params);
    assert.equal(typeof this.text, 'string');

    this.last_autocomplete = null;
    this.is_focused = false;
    this.elem = null;
    this.input = null;
    this.submitted = false;
    this.pointer_lock = false;
    this.last_frame = 0;
    this.out = {}; // Used by spotFocusCheck
  }
  applyParams(params) {
    if (!params) {
      return;
    }
    for (let f in params) {
      this[f] = params[f];
    }
    if (this.text === undefined) {
      // do not trigger assert if `params` has a `text: undefined` member
      this.text = '';
    }
    this.h = this.font_height;
  }
  updateText() {
    this.text = this.input.value;
    if (this.max_len > 0) {
      this.text = this.text.slice(0, this.max_len);
    }
  }
  getText() {
    return this.text;
  }
  setText(new_text) {
    new_text = String(new_text);
    if (this.input) {
      this.input.value = new_text;
    }
    this.text = new_text;
  }
  focus() {
    if (this.input) {
      this.input.focus();
      setActive(this);
    } else {
      this.onetime_focus = true;
    }
    spotFocusSteal(this);
    this.is_focused = true;
    if (this.pointer_lock && pointerLocked()) {
      pointerLockExit();
    }
  }
  unfocus() {
    spotUnfocus();
  }
  isFocused() { // call after .run()
    return this.is_focused;
  }

  updateFocus() {
    let was_glov_focused = this.is_focused;
    let spot_ret = spotFocusCheck(this);
    let { focused } = spot_ret;
    let dom_focused = this.input && document.activeElement === this.input;
    if (was_glov_focused !== focused) {
      // something external (from clicks/keys in GLOV) changed, apply it if it doesn't match
      if (focused && !dom_focused && this.input) {
        spotlog('GLOV focused, DOM not, focusing', this);
        this.input.focus();
      }
      if (!focused && dom_focused) {
        spotlog('DOM focused, GLOV not, and changed, blurring', this);
        this.input.blur();
      }
    } else if (dom_focused && !focused) {
      spotlog('DOM focused, GLOV not, stealing', this);
      spotFocusSteal(this);
      focused = true;
    } else if (!dom_focused && focused) {
      // Leave it alone, it may be a browser pop-up such as for passwords
    }

    if (focused) {
      setActive(this);
      let key_opt = (this.pointer_lock && !this.text) ? { in_event_cb: pointerLockEnter } : null;
      if (keyUpEdge(KEYS.ESC, key_opt)) {
        if (this.text && this.esc_clears) {
          this.setText('');
        } else {
          spotUnfocus();
          if (this.input) {
            this.input.blur();
          }
          focused = false;
          this.canceled = true;
        }
      }
    }
    this.is_focused = focused;
    return spot_ret;
  }

  run(params) {
    this.applyParams(params);

    if (this.last_frame !== engine.frame_index - 1) {
      // it's been more than a frame, we must have not been running, discard async events
      this.submitted = false;
    }
    this.last_frame = engine.frame_index;

    this.canceled = false;
    let { allow_focus, focused } = this.updateFocus();

    this_frame_edit_boxes.push(this);
    let elem = allow_focus && uiGetDOMElem(this.elem, true);
    if (elem !== this.elem) {
      if (elem) {
        // new DOM element, initialize
        if (!form_hook_registered) {
          form_hook_registered = true;
          let form = document.getElementById('dynform');
          if (form) {
            form.addEventListener('submit', formHook, true);
          }
        }
        elem.textContent = '';
        let input = document.createElement(this.multiline ? 'textarea' : 'input');
        input.setAttribute('type', this.type);
        input.setAttribute('placeholder', this.placeholder);
        if (this.max_len) {
          input.setAttribute('maxLength', this.max_len);
        }
        if (this.multiline) {
          input.setAttribute('rows', this.multiline);
        }
        input.setAttribute('tabindex', 2);
        elem.appendChild(input);
        let span = document.createElement('span');
        span.setAttribute('tabindex', 3);
        elem.appendChild(span);
        input.value = this.text;
        if (this.uppercase) {
          input.style['text-transform'] = 'uppercase';
        }
        this.input = input;
        if (this.initial_focus || this.onetime_focus) {
          input.focus();
          setActive(this);
          this.onetime_focus = false;
        }
        if (this.initial_select) {
          input.select();
        }
      } else {
        this.input = null;
      }
      this.submitted = false;
      this.elem = elem;
    } else {
      if (this.input) {
        this.updateText();
      }
    }
    if (elem) {
      let pos = camera2d.htmlPos(this.x, this.y);
      if (!this.spellcheck) {
        elem.spellcheck = false;
      }
      elem.style.left = `${pos[0]}%`;
      elem.style.top = `${pos[1]}%`;
      let size = camera2d.htmlSize(this.w, 0);
      elem.style.width = `${size[0]}%`;
      let old_fontsize = elem.style.fontSize || '?px';
      let new_fontsize = `${camera2d.virtualToFontSize(this.font_height).toFixed(0)}px`;
      if (new_fontsize !== old_fontsize) {
        elem.style.fontSize = new_fontsize;
      }
      if (this.zindex) {
        elem.style['z-index'] = this.zindex;
      }
      if (this.last_autocomplete !== this.autocomplete) {
        this.last_autocomplete = this.autocomplete;
        this.input.setAttribute('autocomplete', this.autocomplete || `auto_off_${Math.random()}`);
      }
    }

    if (focused) {
      if (this.auto_unfocus) {
        if (inputClick({ peek: true })) {
          spotUnfocus();
        }
      }
      // keyboard input is handled by the INPUT element, but allow mouse events to trickle
      eatAllKeyboardInput();
    }
    // Eat mouse events going to the edit box
    mouseConsumeClicks({ x: this.x, y: this.y, w: this.w, h: this.h });

    if (this.submitted) {
      this.submitted = false;
      return this.SUBMIT;
    }
    if (this.canceled) {
      this.canceled = false;
      return this.CANCEL;
    }
    return null;
  }
  unrun() {
    // remove from DOM or hide
    this.elem = null;
    this.input = null;
  }
}
GlovUIEditBox.prototype.SUBMIT = 'submit';
GlovUIEditBox.prototype.CANCEL = 'cancel';

export function editBoxCreate(params) {
  return new GlovUIEditBox(params);
}
