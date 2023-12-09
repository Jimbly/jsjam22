import crypto from 'crypto';

const { floor } = Math;

// Assures the specified length and does not start with a 0.
export function randNumericId(len: number): string {
  // About 4.5x slower than calling Math.random() for each letter, but still relatively fast
  let buf = crypto.randomBytes(len);
  for (let ii = 0; ii < len; ++ii) {
    buf[ii] = (ii ? 48 : 49) + floor(buf[ii]/256 * (ii ? 10 : 9));
  }
  return buf.toString();
}
