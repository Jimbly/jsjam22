const assert = require('assert');

let metric;
let add_metrics = {};
let set_metrics = {};

// Add to a metric for event counts (i.e. something that we want to view the sum of over a time range)
function add(metric_name, value) {
  assert(!set_metrics[metric_name]);
  add_metrics[metric_name] = 1;
  if (metric) {
    metric.add(metric_name, value);
  }
}
exports.add = add;

// Set a measurement metric (i.e. something reported on a fixed period that we may want to view the min/max/average of)
// The most recent value will be reported when flushed
function set(metric_name, value) {
  assert(!add_metrics[metric_name]);
  if (set_metrics[metric_name] !== value || true) {
    set_metrics[metric_name] = value;
    if (metric) {
      metric.set(metric_name, value);
    }
  }
}
exports.set = set;

// Set a valued event metric for which we want detailed statistics (e.g. bytes sent per request), *not* sampled
//   at a regular interval
// The metric provider may need to track sum/min/max/avg in-process between flushes
// This could maybe be combined with `metric.add(metric_name, 1)` (but only care about sum in that case)?
function stats(metric_name, value) {
  if (metric) {
    metric.stats(metric_name, value);
  }
}
exports.stats = stats;

// metric_impl must have .add and .set
function init(metric_impl) {
  metric = metric_impl;
}
exports.init = init;
