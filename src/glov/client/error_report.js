/* global location */

export let session_uid = `${String(Date.now()).slice(-8)}${String(Math.random()).slice(2,8)}`;
let error_report_details = {};
let error_report_dynamic_details = {};

import { getAPIPath } from 'glov/client/environments';
import { platformGetID } from './client_config';
import { fetch } from './fetch';

let error_report_disabled = false;

export function errorReportDisable() {
  error_report_disabled = true;
}

let ignore_promises = false;
export function errorReportIgnoreUncaughtPromises() {
  ignore_promises = true;
}

export function errorReportSetDetails(key, value) {
  if (value) {
    error_report_details[key] = escape(String(value));
  } else {
    delete error_report_details[key];
  }
}
export function errorReportSetDynamicDetails(key, fn) {
  error_report_dynamic_details[key] = fn;
}

errorReportSetDetails('build', BUILD_TIMESTAMP);
errorReportSetDetails('sesuid', session_uid);
errorReportSetDynamicDetails('platform', platformGetID);
const time_start = Date.now();
errorReportSetDetails('time_start', time_start);
errorReportSetDynamicDetails('url', function () {
  return escape(location.href);
});
errorReportSetDynamicDetails('time_up', function () {
  return Date.now() - time_start;
});
let time_accum = 0;
export function errorReportSetTimeAccum(new_value) {
  time_accum = new_value;
}
errorReportSetDynamicDetails('time_accum', function () {
  return time_accum;
});

function getDynamicDetail(key) {
  let value = error_report_dynamic_details[key]();
  if (!value && value !== 0) {
    return '';
  }
  return `&${key}=${value}`;
}
export function errorReportDetailsString() {
  return `&${Object.keys(error_report_details)
    .map((k) => `${k}=${error_report_details[k]}`)
    .join('&')}` +
    `${Object.keys(error_report_dynamic_details).map(getDynamicDetail).join('')}`;
}

let last_error_time = 0;
let crash_idx = 0;
export function hasCrashed() {
  return crash_idx > 0;
}

export function errorReportClear() {
  last_error_time = 0;
  window.debugmsg('', true);
}

let submit_errors = true;
export function glovErrorReportDisableSubmit() {
  submit_errors = false;
}

let on_crash_cb = null;
export function glovErrorReportSetCrashCB(cb) {
  on_crash_cb = cb;
}

// Errors from plugins that we don't want to get reported to us, or show the user!
let filtered_errors = new RegExp([
  // Generic error that shows up with no context, not useful, and probably coming from internal or extension scripts
  '^Error: Script error\\.$',
  // The exact phrase "Script error.\n  at (0:0)" comes from our bootstap.js when we
  //   receive the message 'Script Error.' and no stack.  This happens on the Mi Browser on Redmi phones
  //   and doesn't seem to be indicative of any actual problem.
  '^Error: Script error\\.\n  at \\(0:0\\)$',
  '^Error: null$',
  // Ignoring null at null for similar reasons and because we get nothing useful from the reports.
  '^Error: null\n  at null\\(null:null\\)$',
  'avast_submit',
  'vc_request_action',
  'getElementsByTagName\\(\'video\'\\)',
  'document\\.getElementById\\("search"\\)',
  'change_ua',
  'chrome-extension',
  'setConnectedRobot',
  'Failed to (?:start|stop) the audio device',
  'zaloJSV2',
  'getCookie is not defined',
  'originalPrompt',
  '_AutofillCallbackHandler',
  'sytaxError',
  'bannerNight',
  'privateSpecialRepair',
  '__gCrWeb',
  '\\$wrap is not',
  'wsWhitelisted',
  '#darkcss',
  'chrome://userjs',
  'worker-hammerhead',
  'ammerhead-browser',
  'hammerhead',
  'isFeatureBroken',
  'PureRead',
  'uv\\.handler\\.js',
  'dashawn\\.cf',
  'clearTransInfo', // WeChat
  'firefoxSample',
  'gourmetads',
  'apstag', // Amazon Ad network on Safari
  'otBannerSdk\\.js', // OneTrust (maybe when blocked by ad blocker/etc?)
  'setOTDataLayer', // OneTrust
  'otSDKStub', // OneTrust
  'pubads_20', // Some third-party ad provider
  'ima3\\.js', // Google ads
  'window\\.setDgResult', // likely from ad provider
  'TranslateService',
  'bdTransJSBridge',
  'ciuvoSDK',
  'stubScriptElement',
  'chrome://internal',
  'getElementById\\(\'items\'\\)',
  'closeModal',
].join('|'));

export function glovErrorReport(is_fatal, msg, file, line, col) {
  console.error(msg);
  if (on_crash_cb) {
    on_crash_cb();
  }
  if (is_fatal) {
    // Only doing filtering and such on fatal errors, as non-fatal errors are
    // just logged and should not corrupt state.
    ++crash_idx;
    let now = Date.now();
    let dt = now - last_error_time;
    last_error_time = now;
    if (error_report_disabled) {
      return false;
    }
    if (dt < 30*1000) {
      // Less than 30 seconds since the last error, either we're erroring every
      // frame, or this is a secondary error caused by the first, do not report it.
      // Could maybe hash the error message and just report each message once, and
      // flag errors as primary or secondary.
      return false;
    }
    if (msg.match(filtered_errors)) {
      return false;
    }
  }
  // Post to an error reporting endpoint that (probably) doesn't exist - it'll get in the logs anyway!
  let url = getAPIPath(); // base like http://foo.com/bar/ (without index.html)
  url += `${is_fatal ? 'errorReport' : 'errorLog'}?cidx=${crash_idx}&file=${escape(file)}` +
    `&line=${line||0}&col=${col||0}` +
    `&msg=${escape(msg)}${errorReportDetailsString()}`;
  if (submit_errors) {
    fetch({ method: 'POST', url }, () => { /* nop */ });

    if (window.gtag) {
      window.gtag('event', 'exception', {
        description: msg,
        fatal: is_fatal,
      });
    }
  }
  if (ignore_promises && msg.match(/Uncaught \(in promise\)/)) {
    return false;
  }
  return true;
}

window.glov_error_report = glovErrorReport.bind(null, true);

let early_err = window.glov_error_early;
if (early_err) {
  window.glov_error_report(early_err.msg, early_err.file, early_err.line, early_err.col);
}
