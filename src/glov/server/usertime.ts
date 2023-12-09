import assert from 'assert';

import type { TSMap } from 'glov/common/types';

const { floor } = Math;

export type MetricReporter = (metric: string, value: number) => void;

// Tracks time attributed to users each with a set of tags, keeping track of
// total time and time per tag.
export class UserTimeAccumulator {
  private accum: TSMap<number> = {};
  private active: TSMap<number> = {};
  private last_tick_time: number;
  constructor(private metric: string, private reporter: MetricReporter) {
    this.last_tick_time = Date.now();
  }

  start(tags: string): void {
    let list = tags ? tags.split(',') : [];
    let dt = Date.now() - this.last_tick_time;
    const { active, accum } = this;
    if (dt) {
      accum.total = (accum.total || 0) - dt;
      for (let ii = 0; ii < list.length; ++ii) {
        let tag = list[ii];
        accum[tag] = (accum[tag] || 0) - dt;
      }
    }
    active.total = (active.total || 0) + 1;
    for (let ii = 0; ii < list.length; ++ii) {
      let tag = list[ii];
      active[tag] = (active[tag] || 0) + 1;
    }
  }

  end(tags: string): void {
    let list = tags ? tags.split(',') : [];
    let dt = Date.now() - this.last_tick_time;
    const { active, accum } = this;
    if (dt) {
      accum.total = (accum.total || 0) + dt;
      for (let ii = 0; ii < list.length; ++ii) {
        let tag = list[ii];
        accum[tag] = (accum[tag] || 0) + dt;
      }
    }
    assert(active.total);
    active.total--;
    for (let ii = 0; ii < list.length; ++ii) {
      let tag = list[ii];
      assert(active[tag]);
      active[tag]!--;
    }
  }

  tick(): void {
    let now = Date.now();
    let dt = now - this.last_tick_time;
    this.last_tick_time = now;
    let log: null | string[] = null as null | string[]; // Set to [] for debugging
    const { active, accum, metric, reporter } = this;
    for (let tag in active) {
      let count = active[tag]!;
      if (!count) {
        delete active[tag];
      }
      let extra = accum[tag] || 0;
      let total_time = (count * dt + extra) / 1000;
      let total_seconds = floor(total_time);
      if (total_seconds) {
        log?.push(`${tag}=${total_seconds}`);
        if (tag === 'total') {
          reporter(metric, total_seconds);
        } else {
          reporter(`${metric}.${tag}`, total_seconds);
        }
      }
      let remainder = total_time - total_seconds;
      if (count) {
        // still have users being counted, keep the millisecond remainder for next tick
        accum[tag] = remainder;
      } else {
        // no users connected, drop the extra
        delete accum[tag];
      }
    }
    if (log?.length) {
      console.debug(log.join(' '));
    }
  }
}
