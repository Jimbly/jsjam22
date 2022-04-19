/* global XMLHttpRequest */

const assert = require('assert');
const { once } = require('glov/common/util.js');

export const ERR_CONNECTION = 'ERR_CONNECTION';

export function fetch(params, cb) {
  cb = once(cb);
  let { method, url, response_type } = params;
  method = method || 'GET';
  assert(url);
  let xhr = new XMLHttpRequest();
  xhr.open(method, url, true);
  if (response_type && response_type !== 'json') {
    xhr.responseType = response_type;
  }
  xhr.onload = function () {
    if (xhr.status !== 200 && xhr.status !== 0) {
      let text;
      try {
        text = xhr.responseText;
      } catch (e) {
        // ignored
      }
      return void cb(String(xhr.status), text || '');
    }
    if (response_type === 'json') {
      let text;
      let obj;
      try {
        text = xhr.responseText;
        obj = JSON.parse(text);
      } catch (e) {
        console.error(`Received invalid JSON response from ${url}: ${text || '<empty response>'}`);
        // Probably internal server error or such as the server is restarting
        return void cb(e);
      }
      cb(null, obj);
    } else if (response_type === 'arraybuffer') {
      if (!xhr.response) {
        return void cb('empty response');
      }
      cb(null, xhr.response);
    } else {
      cb(null, xhr.responseText);
    }
  };
  xhr.onerror = () => {
    cb(ERR_CONNECTION);
  };
  xhr.send(null);
}
