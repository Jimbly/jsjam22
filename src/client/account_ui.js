// Portions Copyright 2022 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

export const guest_regex = /^anon\d+$/;

/* eslint import/order:off */
const assert = require('assert');
const local_storage = require('glov/client/local_storage.js');
const glov_font = require('glov/client/font.js');
const { click, KEYS, keyDownEdge } = require('glov/client/input.js');
const { linkGetDefaultStyle, linkText } = require('glov/client/link.js');
const { random, round } = Math;
const net = require('glov/client/net.js');
const ui = require('glov/client/ui.js');
const { vec4 } = require('glov/common/vmath.js');

export function formatUserID(user_id, display_name) {
  if (user_id.match(guest_regex)) {
    user_id = 'guest';
  }
  let name = display_name || user_id;
  if (user_id.toLowerCase() !== name.toLowerCase()) {
    name = `${display_name} (${user_id})`;
  }
  return name;
}

function AccountUI() {
  this.edit_box_name = ui.createEditBox({
    placeholder: 'Username',
    initial_focus: true,
    text: local_storage.get('name') || '',
    autocomplete: 'username',
  });
  this.edit_box_password = ui.createEditBox({
    placeholder: 'Password',
    type: 'password',
    text: local_storage.get('name') && local_storage.get('password') || '',
  });
  this.edit_box_password_confirm = ui.createEditBox({
    initial_focus: true,
    placeholder: 'Confirm',
    type: 'password',
    text: '',
    autocomplete: 'new-password',
  });
  this.edit_box_email = ui.createEditBox({
    placeholder: 'Email',
    text: '',
    autocomplete: 'email',
  });
  this.edit_box_display_name = ui.createEditBox({
    placeholder: 'Display',
    text: '',
    autocomplete: 'nickname',
  });
  this.creation_mode = false;
}

AccountUI.prototype.logout = function () {
  this.edit_box_password.setText('');
  net.subs.logout();
};

AccountUI.prototype.playAsGuest = function (use_name) {
  let name;
  if (use_name && (local_storage.get('name') || '').match(guest_regex)) {
    name = local_storage.get('name');
  } else {
    name = `anon${String(random()).slice(2, 8)}`;
  }
  let pass = 'test';
  local_storage.set('name', name);
  this.edit_box_name.setText(name);
  net.subs.login(name, pass, function (err) {
    if (err) {
      ui.modalDialog({
        title: 'Auto-login Failed',
        text: err,
        buttons: {
          'Retry': function () {
            local_storage.set('did_auto_anon', undefined);
            local_storage.set('name', undefined);
          },
          'Cancel': null,
        },
      });
    } else {
      net.subs.sendCmdParse('rename_random', (err) => {
        if (err) {
          console.log(err);
        }
      });
    }
  });
};

AccountUI.prototype.showLogin = function (param) {
  let {
    x, y, style, button_height, button_width,
    prelogout, center,
    url_tos, url_priv, text_w,
    font_height, font_height_small, label_w,
    pad, status_bar,
  } = param;
  font_height = font_height || ui.font_height;
  font_height_small = font_height_small || font_height * 0.75;
  button_height = button_height || ui.button_height;
  button_width = button_width || 240;
  text_w = text_w || 400;
  label_w = label_w || round(font_height * 140/24);
  pad = pad || 10;
  let { edit_box_name, edit_box_password, edit_box_password_confirm, edit_box_email, edit_box_display_name } = this;
  let login_message;
  const BOX_H = font_height;
  let min_h = BOX_H * 2 + pad * 3 + button_height;
  let calign = center ? glov_font.ALIGN.HRIGHT : glov_font.ALIGN.HLEFT | glov_font.ALIGN.HFIT;

  function showTOS(is_create) {
    if (url_tos) {
      assert(url_priv);
      let terms_height = font_height_small;
      ui.font.drawSizedAligned(style, x, y, Z.UI, terms_height, glov_font.ALIGN.HCENTER, 0, 0,
        `By ${is_create ? 'creating an account' : 'logging in'} you agree to our`);
      y += terms_height;
      let and_w = ui.font.getStringWidth(style, terms_height, ' and ');
      ui.font.drawSizedAligned(style, x, y, Z.UI, terms_height, glov_font.ALIGN.HCENTER, 0, 0,
        'and');
      linkText({
        x: x - and_w / 2 - ui.font.getStringWidth(linkGetDefaultStyle(), terms_height, 'Terms of Service'),
        y,
        z: Z.UI,
        font_size: terms_height,
        url: url_tos,
        text: 'Terms of Service',
      });
      linkText({
        x: x + and_w / 2,
        y,
        z: Z.UI,
        font_size: terms_height,
        url: url_priv,
        text: 'Privacy Policy',
      });
      y += BOX_H + pad;
    }
  }

  if (!net.client.connected) {
    login_message = 'Establishing connection...';
  } else if (net.subs.logging_in) {
    login_message = 'Logging in...';
  } else if (net.subs.logging_out) {
    login_message = 'Logging out...';
  } else if (!net.subs.loggedIn() && window.FBInstant) {
    net.subs.loginFacebook(function (err) {
      if (err) {
        ui.modalDialog({
          title: 'Facebook login Failed',
          text: err,
          buttons: {
            'Cancel': null,
          },
        });
      }
    });
  } else if (!net.subs.loggedIn() && net.subs.auto_create_user &&
    !local_storage.get('did_auto_anon') && !local_storage.get('name')
  ) {
    login_message = 'Creating guest account...';
    local_storage.set('did_auto_anon', 'yes');
    this.playAsGuest(false);
  } else if (!net.subs.loggedIn()) {
    let submit = false;
    let w = text_w / 2;
    let indent = center ? 0 : label_w;
    let text_x = center ? x - 8 : x;
    ui.font.drawSizedAligned(style, text_x, y, Z.UI, font_height, calign, indent - pad, 0, 'Username:');
    submit = edit_box_name.run({ x: x + indent, y, w, font_height }) === edit_box_name.SUBMIT || submit;
    y += BOX_H + pad;
    ui.font.drawSizedAligned(style, text_x, y, Z.UI, font_height, calign, indent - pad, 0, 'Password:');
    submit = edit_box_password.run({
      x: x + indent, y, w, font_height,
      autocomplete: this.creation_mode ? 'new-password' : 'current-password',
    }) === edit_box_password.SUBMIT || submit;
    y += BOX_H + pad;

    if (this.creation_mode) {
      ui.font.drawSizedAligned(style, text_x, y, Z.UI, font_height, calign, indent - pad, 0, 'Confirm Password:');
      submit = edit_box_password_confirm.run({ x: x + indent, y, w, font_height }) === edit_box_password.SUBMIT ||
        submit;
      y += BOX_H + pad;

      ui.font.drawSizedAligned(style, text_x, y, Z.UI, font_height, calign, indent - pad, 0, 'Email Address:');
      submit = edit_box_email.run({ x: x + indent, y, w, font_height }) === edit_box_password.SUBMIT || submit;
      y += BOX_H + pad;

      ui.font.drawSizedAligned(style, text_x, y, Z.UI, font_height, calign, indent - pad, 0, 'Display Name:');
      submit = edit_box_display_name.run({ x: x + indent, y, w, font_height }) === edit_box_password.SUBMIT ||
        submit;

      if (ui.buttonText({
        x: x + w + (center ? 0 : label_w) + pad, y, w: button_width * 0.5, h: BOX_H + pad - 2,
        font_height: font_height_small,
        text: 'Random',
      })) {
        net.client.send('random_name', null, function (ignored, data) {
          if (data) {
            edit_box_display_name.setText(data);
          }
        });
      }

      y += BOX_H + pad;

      showTOS(true);

      submit = ui.buttonText({
        x, y, w: button_width, h: button_height,
        font_height,
        text: 'Create User',
      }) || submit;
      if (ui.buttonText({
        x: x + button_width + pad, y, w: button_width, h: button_height,
        font_height,
        text: 'Cancel',
      }) || keyDownEdge(KEYS.ESC)) {
        this.creation_mode = false;
      }
      y += button_height + pad;

      if (submit) {
        local_storage.set('name', edit_box_name.text);
        // do creation and log in!
        net.subs.userCreate({
          user_id: edit_box_name.text,
          email: edit_box_email.text,
          password: edit_box_password.text,
          password_confirm: edit_box_password_confirm.text,
          display_name: edit_box_display_name.text,
        }, (err) => {
          if (err) {
            ui.modalDialog({
              title: 'Login Error',
              text: err,
              buttons: {
                'OK': null,
              },
            });
          } else {
            this.creation_mode = false;
            edit_box_password_confirm.setText('');
            edit_box_email.setText('');
            edit_box_display_name.setText('');
          }
        });
      }

    } else {

      showTOS(false);

      if (net.subs.auto_create_user) {
        submit = ui.buttonText({
          x, y, w: w + label_w, h: button_height,
          font_height,
          text: 'Log in / Create user',
        }) || submit;
        y += button_height + pad;
        if (ui.buttonText({
          x, y, w: w + label_w, h: button_height,
          font_height,
          text: 'Play as Guest',
        })) {
          this.playAsGuest(true);
        }
        // y += button_height + pad;
      } else {
        submit = ui.buttonText({
          x, y, w: button_width, h: button_height,
          font_height,
          text: 'Log in',
        }) || submit;
        if (center) {
          y += button_height + pad;
        }
        if (ui.buttonText({
          x: center ? x : x + button_width + pad, y, w: button_width, h: button_height,
          font_height,
          text: 'New User',
        })) {
          this.creation_mode = true;
          edit_box_display_name.setText(edit_box_name.text);
          if (edit_box_name.text && edit_box_password.text) {
            edit_box_password_confirm.initial_focus = true;
          } else {
            edit_box_password_confirm.initial_focus = false;
            edit_box_name.focus();
          }
        }
      }
      y += button_height + pad;

      if (submit) {
        local_storage.set('name', edit_box_name.text);
        // do log in!
        net.subs.login(edit_box_name.text, edit_box_password.text, (err) => {
          if (err) {
            ui.modalDialog({
              title: 'Login Error',
              text: err,
              buttons: {
                'OK': null,
              },
            });
          }
        });
      }
    }
  } else {
    // FB Users can't logout
    let show_logout = !window.FBInstant;
    let user_id = net.subs.loggedIn();
    let user_channel = net.subs.getChannel(`user.${user_id}`);
    let display_name = user_channel.getChannelData('public.display_name') || user_id;
    let name = formatUserID(user_id, display_name);

    if (show_logout) {
      let logged_in_font_height = font_height_small;
      if (center) {
        ui.font.drawSizedAligned(style, x - text_w / 2, y,
          Z.UI, logged_in_font_height,
          glov_font.ALIGN.HCENTERFIT,
          text_w, 0,
          `Logged in as: ${name}`);
        if (click({ x: x - text_w / 2, y, w: text_w, h: logged_in_font_height, button: 0 })) {
          ui.provideUserString('Your User ID', user_id);
        }
        y += logged_in_font_height + 8;
      } else if (status_bar) {
        ui.font.drawSizedAligned(style, x + button_width + 8, y,
          Z.UI, logged_in_font_height,
          glov_font.ALIGN.HFIT | glov_font.ALIGN.VCENTER,
          text_w, button_height,
          `Logged in as: ${name}`);
        if (click({ x: x + button_width + 8, y, w: text_w, h: button_height, button: 0 })) {
          ui.provideUserString('Your User ID', user_id);
        }
      } else {
        ui.font.drawSizedAligned(style, x + button_width + 8,
          y + logged_in_font_height * -0.25,
          Z.UI, logged_in_font_height, calign | glov_font.ALIGN.VCENTER | glov_font.ALIGN.HFIT, text_w, button_height,
          'Logged in as:');
        ui.font.drawSizedAligned(style, x + button_width + 8,
          y + logged_in_font_height * 0.75,
          Z.UI, logged_in_font_height, calign | glov_font.ALIGN.VCENTER | glov_font.ALIGN.HFIT, text_w, button_height,
          name);
        if (click({ x: x + button_width + 8, y, w: text_w, h: logged_in_font_height * 2, button: 0 })) {
          ui.provideUserString('Your User ID', user_id);
        }
      }

      if (ui.buttonText({
        x: center ? x - button_width / 2 : x,
        y, w: button_width, h: button_height,
        font_height,
        text: 'Log out',
      })) {
        if (prelogout) {
          prelogout();
        }
        this.logout();
      }
      y += button_height + 8;
    } else {
      ui.font.drawSizedAligned(style, center ? x - text_w / 2 : x + button_width + 8, y,
        Z.UI, font_height,
        (center ? glov_font.ALIGN.HCENTER : calign) | glov_font.ALIGN.VCENTER | glov_font.ALIGN.HFIT,
        text_w, button_height,
        `Logged in as: ${name}`);
    }
  }
  if (login_message) {
    let w = ui.font.drawSizedAligned(style, center ? x - 400 : x, y, Z.UI, font_height * 1.5,
      glov_font.ALIGN.HVCENTERFIT,
      center ? 800 : 400, min_h, login_message);
    w += 100;
    ui.drawRect(x - (center ? w / 2 : 50), y, x + (center ? w / 2 : w - 50), y + min_h, Z.UI - 0.5, vec4(0,0,0,0.25));
    y += min_h;
  }
  return y;
};

export function createAccountUI() {
  return new AccountUI();
}
