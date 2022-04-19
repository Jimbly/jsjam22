// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');
const camera2d = require('./camera2d.js');
const engine = require('./engine.js');
const glov_input = require('./input.js');
const glov_ui = require('./ui.js');

const { focuslog } = glov_ui;

let form_hook_registered = false;
let active_edit_box;
let active_edit_box_frame;

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
    glov_input.pointerLockEnter('edit_box_submit');
  }
}

class GlovUIEditBox {
  constructor(params) {
    this.x = 0;
    this.y = 0;
    this.z = Z.UI; // actually in DOM, so above everything!
    this.w = glov_ui.button_width;
    this.type = 'text';
    this.allow_modal = false;
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
    this.applyParams(params);
    assert.equal(typeof this.text, 'string');

    this.last_autocomplete = null;
    this.is_focused = false;
    this.elem = null;
    this.input = null;
    this.submitted = false;
    this.pointer_lock = false;
    this.last_frame = 0;
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
    glov_ui.focusSteal(this);
    this.is_focused = true;
    if (this.pointer_lock && glov_input.pointerLocked()) {
      glov_input.pointerLockExit();
    }
  }
  unfocus() {
    glov_ui.focusNext(this);
  }
  isFocused() { // call after .run()
    return this.is_focused;
  }

  updateFocus() {
    let was_glov_focused = this.is_focused;
    let glov_focused = glov_ui.focusCheck(this);
    let dom_focused = this.input && document.activeElement === this.input;
    if (was_glov_focused !== glov_focused) {
      // something external (from clicks/keys in GLOV) changed, apply it if it doesn't match
      if (glov_focused && !dom_focused && this.input) {
        focuslog('GLOV focused, DOM not, focusing', this);
        this.input.focus();
      }
      if (!glov_focused && dom_focused) {
        focuslog('DOM focused, GLOV not, and changed, blurring', this);
        this.input.blur();
      }
    } else if (dom_focused && !glov_focused) {
      focuslog('DOM focused, GLOV not, stealing', this);
      glov_ui.focusSteal(this);
      glov_focused = true;
    } else if (!dom_focused && glov_focused) {
      // Leave it alone, it may be a browser pop-up such as for passwords
    }
    let focused = glov_focused;

    if (focused) {
      setActive(this);
      let key_opt = (this.pointer_lock && !this.text) ? { in_event_cb: glov_input.pointerLockEnter } : null;
      if (glov_input.keyUpEdge(glov_input.KEYS.ESC, key_opt)) {
        if (this.text && this.esc_clears) {
          this.setText('');
        } else {
          glov_ui.focusCanvas();
          if (this.input) {
            this.input.blur();
          }
          focused = false;
          this.canceled = true;
        }
      }
    }
    this.is_focused = focused;
    return focused;
  }

  run(params) {
    this.applyParams(params);

    if (this.last_frame !== engine.frame_index - 1) {
      // it's been more than a frame, we must have not been running, discard async events
      this.submitted = false;
    }
    this.last_frame = engine.frame_index;

    this.canceled = false;
    let focused = this.updateFocus();

    glov_ui.this_frame_edit_boxes.push(this);
    let elem = glov_ui.getDOMElem(this.allow_modal, this.elem);
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
        if (glov_input.click({ peek: true })) {
          glov_ui.focusSteal('canvas');
        }
      }
      // keyboard input is handled by the INPUT element, but allow mouse events to trickle
      glov_input.eatAllKeyboardInput();
    }
    // Eat mouse events going to the edit box
    glov_input.mouseConsumeClicks({ x: this.x, y: this.y, w: this.w, h: this.font_height });

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

export function create(params) {
  return new GlovUIEditBox(params);
}
