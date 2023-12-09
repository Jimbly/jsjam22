// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/* eslint-disable import/order */
const { serverConfig } = require('./server_config.js');
const querystring = require('querystring');
const url = require('url');

// Options pulled in from serverConfig
// how far behind proxies that reliably add x-forwarded-for headers are we?
let forward_depth = serverConfig().forward_depth || 0;
let forward_loose = serverConfig().forward_loose || false;

function skipWarn(req) {
  if (forward_loose) {
    return true;
  }
  if (req.url === '/' || req.url === '/status') {
    // skipping warning on '/' because lots of internal health checks or
    // something on GCP seem to hit this, and / is not an endpoint that could
    // have anything interesting on its own.
    return true;
  }
  return false;
}

const regex_ipv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/;
export function ipFromRequest(req) {
  // See getRemoteAddressFromRequest() for more implementation details, possibilities, proxying options
  // console.log('Client connection headers ' + JSON.stringify(req.headers));

  if (req.glov_ip) {
    return req.glov_ip;
  }

  let raw_ip = req.client.remoteAddress || req.client.socket && req.client.socket.remoteAddress;
  let ip = raw_ip;
  let header = req.headers['x-forwarded-for'];
  if (forward_depth) {
    // Security note: must check x-forwarded-for *only* if we know this request came from a
    //   reverse proxy, should warn if missing x-forwarded-for.
    // If forwarded through multiple proxies, want to get just the original client IP,
    //   but the configuration must specify how many trusted proxies we passed through.
    if (!header) {
      if (!skipWarn(req)) {
        console.warn('Received request missing any x-forwarded-for header from ' +
          `${raw_ip} for ${req.url}, assuming trusted local`);
      }
      // Use raw IP
    } else {
      let forward_list = (header || '').split(',');
      let forward_ip = (forward_list[forward_list.length - forward_depth] || '').trim();
      if (!forward_ip) {
        // forward_depth is incorrect, or someone is not getting the appropriate headers
        // Best guess: leftmost or raw IP
        ip = forward_list[0].trim() || raw_ip;
        if (forward_loose) {
          // don't warn, just use best guess
        } else {
          if (!skipWarn(req)) {
            console.warn(`Received request missing expected x-forwarded-for header from ${raw_ip} for ${req.url}`);
          }
          // use a malformed IP so that it does not pass "is local" IP checks, etc
          ip = `untrusted:${ip}`;
        }
      } else {
        ip = forward_ip;
      }
    }
  } else {
    // No forward_depth specified, so, if we do see a x-forwarded-for header, then
    // this is either someone spoofing, or a forwarded request (e.g. from
    // browser-sync). Either way, do not trust it.
    if (header) {
      if (!skipWarn(req)) {
        console.warn('Received request with unexpected x-forwarded-for header '+
          `(${header}) from ${raw_ip} for ${req.url}`);
      }
      // use a malformed IP so that it does not pass "is local" IP checks, etc
      ip = `untrusted:${ip}`;
    }
  }
  if (!ip) {
    // client already disconnected?
    return 'unknown';
  }
  let m = ip.match(regex_ipv4);
  if (m) {
    ip = m[1];
  }
  req.glov_ip = ip;
  return ip;
  // return `${ip}${port ? `:${port}` : ''}`;
}

let cache = {};
let debug_ips = /^(?:(?:::1)|(?:127\.0\.0\.1)(?::\d+)?)$/;
export function isLocalHost(ip) {
  let cached = cache[ip];
  if (cached === undefined) {
    cache[ip] = cached = Boolean(ip.match(debug_ips));
    if (cached) {
      console.info(`Allowing dev access from ${ip}`);
    } else {
      console.debug(`NOT Allowing dev access from ${ip}`);
    }
  }
  return cached;
}

export function requestIsLocalHost(req) {
  if (req.glov_is_dev === undefined) {
    let ip = ipFromRequest(req);
    req.glov_is_dev = isLocalHost(ip);
  }
  return req.glov_is_dev;
}

export function allowMapFromLocalhostOnly(app) {
  app.all('*.map', function (req, res, next) {
    if (requestIsLocalHost(req)) {
      return void next();
    }
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end(`Cannot ${req.method} ${req.url}`);
  });
}

export function safeString(str) {
  return str.replace(/["<>\\]/g, '');
}

// Gets a parsed, cached `query` from a request.  This is usually provided
//   by Express's default middleware, but useful to call manually if not
//   using Express or on low-level requests like `upgrade`s).
export function requestGetQuery(req) {
  if (!req.query) {
    req.query = querystring.parse(url.parse(req.url).query);
  }
  return req.query;
}

export function respondArray(req, res, next, err, arr) {
  if (err) {
    return void next(err);
  }
  let text;
  if (req.query.format === 'csv' || req.query.format === 'tsv') {
    res.setHeader('Content-Type', 'text/plain');
    let delim = req.query.format === 'csv' ? ',' : '\t';
    let header = [];
    let keys = {};
    let lines = [];
    for (let ii = 0; ii < arr.length; ++ii) {
      let elem = arr[ii];
      for (let key in elem) {
        let idx = keys[key];
        if (idx === undefined) {
          keys[key] = header.length;
          header.push(key);
        }
      }
      lines.push(header.map((f) => `${elem[f]}`).join(delim));
    }
    text = `${header.join(delim)}\n${lines.join('\n')}`;
  } else {
    res.setHeader('Content-Type', 'application/json');
    text = JSON.stringify(arr);
  }
  res.end(text);
}

function setOriginHeaders(req, res, next) {
  if (req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  }
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  next();
}

function setCrossOriginHeadersAlways(req, res, next) {
  let pathname = url.parse(req.url).pathname;
  if (pathname.endsWith('/') || pathname.endsWith('.html') || pathname.endsWith('.js')) {
    // For developers: Set as "cross-origin isolated", for access to high resolution timers
    // Disclaimer: I have no idea what this does, other than allows high resolution timers on Chrome/Firefox
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  }
  next();
}

function setCrossOriginHeadersUponRequest(req, res, next) {
  if (req.query.coop) {
    setCrossOriginHeadersAlways(req, res, next);
  } else {
    next();
  }
}

function disableCrossOriginHeadersUponRequest(req, res, next) {
  if (!req.query.nocoop) {
    setCrossOriginHeadersAlways(req, res, next);
  } else {
    next();
  }
}

export function setupRequestHeaders(app, { dev, allow_map }) {
  if (!allow_map) {
    allowMapFromLocalhostOnly(app);
  }
  if (dev) {
    app.use(disableCrossOriginHeadersUponRequest);
  } else {
    app.use(setCrossOriginHeadersUponRequest);
  }
  app.use(setOriginHeaders);
}
