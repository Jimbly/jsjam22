/* global XMLHttpRequest */

const assert = require('assert');
const { once } = require('glov/common/util.js');

export const ERR_CONNECTION = 'ERR_CONNECTION';

const regex_with_host = /\/\/[^/]+\/([^?#]+)/;
const regex_no_host = /([^?#]+)/;
function labelFromURL(url) {
  let m = url.match(regex_with_host);
  if (m) {
    return m[1];
  }
  m = url.match(regex_no_host);
  return m ? m[1] : url;
}

export function fetch(params, cb) {
  cb = once(cb);
  let { method, url, response_type, label } = params;
  method = method || 'GET';
  assert(url);
  label = label || labelFromURL(url);
  let xhr = new XMLHttpRequest();
  xhr.open(method, url, true);
  if (response_type && response_type !== 'json') {
    xhr.responseType = response_type;
  }
  xhr.onload = function () {
    profilerStart(`fetch_onload:${label}`);
    if (xhr.status !== 200 && xhr.status !== 0) {
      let text;
      try {
        text = xhr.responseText;
      } catch (e) {
        // ignored
      }
      cb(String(xhr.status), text || '');
    } else {
      if (response_type === 'json') {
        let text;
        let obj;
        try {
          text = xhr.responseText;
          obj = JSON.parse(text);
        } catch (e) {
          console.error(`Received invalid JSON response from ${url}: ${text || '<empty response>'}`);
          // Probably internal server error or such as the server is restarting
          cb(e);
          profilerStop();
          return;
        }
        cb(null, obj);
      } else if (response_type === 'arraybuffer') {
        if (xhr.response) {
          cb(null, xhr.response);
        } else {
          cb('empty response');
        }
      } else {
        cb(null, xhr.responseText);
      }
    }
    profilerStop();
  };
  xhr.onerror = () => {
    profilerStart(`fetch_onerror:${label}`);
    cb(ERR_CONNECTION);
    profilerStop();
  };
  xhr.send(null);
}
