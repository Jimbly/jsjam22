import assert from 'assert';

export type DataError = {
  msg: string;
  per_frame?: boolean;
};

let on_error: null | ((err: DataError) => void) = null;
let enabled = false;
let error_queue: DataError[] = [];
let msgs_in_queue: Partial<Record<string, true>> = Object.create(null);
export function dataErrorEx(err: DataError): void {
  if (!enabled) {
    return;
  }
  if (err.per_frame) {
    if (msgs_in_queue[err.msg]) {
      // Duplicate, silently ignore
      return;
    }
    msgs_in_queue[err.msg] = true;
  }
  if (on_error) {
    on_error(err);
  }
  error_queue.push(err);
  if (error_queue.length > 25) {
    let removed = error_queue.splice(0, 1)[0];
    if (removed.per_frame) {
      delete msgs_in_queue[removed.msg];
    }
  }
}

export function dataError(msg: string): void {
  dataErrorEx({ msg });
}

export function dataErrorQueueEnable(val: boolean): void {
  enabled = val;
}

export function dataErrorOnError(cb: (err: DataError) => void): void {
  assert(!on_error);
  on_error = cb;
}

export function dataErrorQueueGet(): DataError[] {
  return error_queue;
}

export function dataErrorQueueClear(): void {
  error_queue = [];
  msgs_in_queue = Object.create(null);
}
