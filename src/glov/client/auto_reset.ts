// eslint-disable-next-line @typescript-eslint/no-use-before-define
export const autoReset = autoResetSkippedFrames;

import * as engine from './engine';
import type { TSMap } from 'glov/common/types';

let auto_reset_data: TSMap<number> = Object.create(null);
export function autoResetSkippedFrames(key: string): boolean {
  let last_value: number | undefined = auto_reset_data[key];
  auto_reset_data[key] = engine.frame_index;
  return !(last_value! >= engine.frame_index - 1);
}

export function autoResetEachFrame(key: string): boolean {
  let last_value: number | undefined = auto_reset_data[key];
  auto_reset_data[key] = engine.frame_index;
  return (last_value !== engine.frame_index);
}
