import { wsstats, wsstats_out } from 'glov/common/wscommon';
import { cmd_parse } from './cmds';
import * as perf from './perf';
import * as settings from './settings';

const { min } = Math;

type StatsType = typeof wsstats;
type StatsTracking = StatsType & {
  dm: number;
  db: number;
  time: number;
};

settings.register({
  show_net: {
    default_value: 0,
    type: cmd_parse.TYPE_INT,
    enum_lookup: {
      OFF: 0,
      ON: 2,
    },
  },
});
let last_wsstats: StatsTracking = { msgs: 0, bytes: 0, time: Date.now(), dm: 0, db: 0 };
let last_wsstats_out: StatsTracking = { msgs: 0, bytes: 0, time: Date.now(), dm: 0, db: 0 };
function bandwidth(stats: StatsType, last: StatsTracking): string {
  let now = Date.now();
  if (now - last.time > 1000) {
    last.dm = stats.msgs - last.msgs;
    last.db = stats.bytes - last.bytes;
    last.msgs = stats.msgs;
    last.bytes = stats.bytes;
    if (now - last.time > 2000) { // stall
      last.time = now;
    } else {
      last.time += 1000;
    }
  }
  return `${(last.db/1024).toFixed(2)} kb (${last.dm})`;
}
perf.addMetric({
  name: 'net',
  show_stat: 'show_net',
  width: 5,
  labels: {
    'down: ': bandwidth.bind(null, wsstats, last_wsstats),
    'up: ': bandwidth.bind(null, wsstats_out, last_wsstats_out),
  },
});

let ping_providers = 0;
export type PingData = {
  ping: number;
  fade: number;
};
export function registerPingProvider(fn: () => PingData | null): void {
  ++ping_providers;
  let suffix = ping_providers === 1 ? '' : `${ping_providers}`;

  settings.register({
    [`show_ping${suffix}`]: {
      default_value: 0,
      type: cmd_parse.TYPE_INT,
      range: [0,1],
    },
  });
  perf.addMetric({
    name: `ping${suffix}`,
    show_stat: `show_ping${suffix}`,
    labels: {
      'ping: ': () => {
        let pt = fn();
        if (!pt || pt.fade < 0.001) {
          return '';
        }
        return { value: `${pt.ping.toFixed(1)}`, alpha: min(1, pt.fade * 3) };
      },
    },
  });
}
