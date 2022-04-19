const metrics = require('./metrics.js');
const { ipFromRequest } = require('./request_utils.js');

let app_build_timestamp;
export function errorReportsSetAppBuildTimestamp(version) {
  app_build_timestamp = version;
}

export function errorReportsInit(app) {
  app.post('/api/errorReport', function (req, res, next) {
    let ip = ipFromRequest(req);
    req.query.ip = ip;
    req.query.ua = req.headers['user-agent'];
    console.info('errorReport', req.query);
    res.end('OK');
    if (app_build_timestamp && req.query.build !== app_build_timestamp) {
      metrics.add('client.error_report_old', 1);
    } else {
      metrics.add('client.error_report', 1);
    }
  });
  app.post('/api/errorLog', function (req, res, next) {
    let ip = ipFromRequest(req);
    req.query.ip = ip;
    req.query.ua = req.headers['user-agent'];
    console.info('errorLog', req.query);
    res.end('OK');
    metrics.add('client.error_report_nonfatal', 1);
  });
}
