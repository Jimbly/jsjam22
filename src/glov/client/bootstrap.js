// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

// Things that should be done before requiring or running any user-level code or other engine code

require('./polyfill.js');

let debug = document.getElementById('debug');
window.onerror = function (e, file, line, col, errorobj) {
  let msg = String(e);
  if (msg.startsWith('[object ')) {
    try {
      msg = JSON.stringify(e);
    } catch (ignored) {
      // ignored
    }
    msg = msg.slice(0, 600); // Not too huge
  }
  if (typeof errorobj === 'string') {
    msg = `${msg} ${errorobj}`;
  }
  if (file || line > 0 || col > 0) {
    msg += `\n  at ${file}(${line}:${col})`;
  }
  let got_stack = false;
  if (errorobj && errorobj.stack) {
    got_stack = true;
    msg = `${errorobj.stack}`;
    if (errorobj.message) {
      if (msg.indexOf(errorobj.message) === -1) {
        msg = `${errorobj.message}\n${msg}`;
      }
    }
    let origin = document.location.origin || '';
    if (origin) {
      if (origin.slice(-1) !== '/') {
        origin += '/';
      }
      msg = msg.split(origin).join(''); // replace
    }
    // fixup weird Firefox weirdness
    msg = msg.replace(/\[\d+\]<\/?/g, '') // remove funny [123]/ at start of stack lines
      .replace(/\/</g, '') // remove funny /<s, they mess up people's copy and paste, look funny
      .replace(/<?\/<?/g, '/') // remove funny </s, they mess up people's copy and paste
      .replace(/\n\//g, '\n') // remove preceding slashes, not sure where those come from
      .replace(/\n([^ ])/g, '\n  $1'); // add indentation if missing
  }
  if (msg.indexOf('Error:') === -1) {
    msg = `Error: ${msg}`;
  }
  if (errorobj && errorobj.errortype) {
    if (errorobj.errortype === 'unhandledrejection') {
      msg = `Uncaught (in promise) ${msg}`;
    }
  }
  if (errorobj) {
    // Attempt to tack on any string members of the error object that may contain useful details
    try {
      if (typeof errorobj === 'object') {
        for (let key in errorobj) {
          if (typeof errorobj[key] === 'string') {
            let value = errorobj[key];
            if (key !== 'errortype' &&
              !((key === 'stack' || key === 'message') && got_stack)
            ) {
              msg = `${msg}\n${key}=${value}`;
            }
          }
        }
      }
    } catch (ignored) {
      // ignored
    }
  }
  let show = true;
  if (window.glov_error_report) {
    show = window.glov_error_report(msg, file, line, col);
  } else if (!window.glov_error_early) {
    window.glov_error_early = { msg, file, line, col };
  }
  if (show) {
    debug.innerText = `${msg}\n\nPlease report this error to the developer,` +
      ' and then reload this page or restart the app.';
  }
};
window.addEventListener('unhandledrejection', function (event) {
  let errorobj = event.reason;
  if (!errorobj) {
    // Can't possibly get anything useful from this? `reject()` causes this, though, still useful to know?
    return;
  }
  if (!errorobj || typeof errorobj !== 'object') {
    errorobj = { stack: errorobj };
  }
  let file;
  if (event.reason && event.reason.srcElement && event.reason.srcElement.src) {
    file = event.reason.srcElement.src;
  }
  try {
    errorobj.errortype = event.type;
  } catch (ignored) {
    // ignore, happens on Firefox
  }
  window.onerror(event.reason, file, 0, 0, errorobj);
});
window.debugmsg = function (msg, clear) {
  if (clear) {
    debug.innerText = msg;
  } else {
    debug.innerText += `${msg}\n`;
  }
};

// Placeholder profiler functions (in case shared/startup code calls them) until
//   profiler is initialized/enabled.
// eslint-disable-next-line @typescript-eslint/no-empty-function, func-name-matching
window.profilerStart = window.profilerStop = window.profilerStopStart = function nop() {};
