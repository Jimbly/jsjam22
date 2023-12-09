const BUCKET_TIME = 10000;
const NUM_BUCKETS = 5;

let counters = { time_start: Date.now() };
let hist = [counters];
let countdown = BUCKET_TIME;

export function perfCounterAdd(key) {
  counters[key] = (counters[key] || 0) + 1;
}

export function perfCounterAddValue(key, value) {
  counters[key] = (counters[key] || 0) + value;
}

export function perfCounterTick(dt, log) {
  countdown -= dt;
  if (countdown <= 0) {
    countdown = BUCKET_TIME;
    if (hist.length === NUM_BUCKETS) {
      hist.splice(0, 1);
    }
    let now = Date.now();
    counters.time_end = now;
    if (log) {
      log(counters);
    }
    counters = {};
    counters.time_start = now;
    hist.push(counters);
  }
}

export function perfCounterHistory() {
  return hist;
}
