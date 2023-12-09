/* eslint import/order:off */
import 'glov/client/test'; // Must be first

import assert from 'assert';
import {
  ROUNDROBIN_CONTINUE,
  ROUNDROBIN_NO,
  ROUNDROBIN_START,
  roundRobinableCreate,
} from 'glov/client/round_robinable';


let thing1 = {};
let thing2 = {};
let thing3 = {};
let rr = roundRobinableCreate();

// Simple round robin
rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_START);
assert.equal(rr.query(thing2), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_NO);
assert.equal(rr.query(thing2), ROUNDROBIN_START);
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_NO);
assert.equal(rr.query(thing2), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_START);

rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_START);
assert.equal(rr.query(thing2), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

// If expected previous is not here this frame, one frame with nothing, then continue
rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_START);

rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_START);
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

// Continuation
rr.stillWorking(thing1);
rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_CONTINUE);
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_START);
rr.stillWorking(thing3);

rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_CONTINUE);

rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_START);
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

// Aborted continuation
rr.stillWorking(thing1);
rr.tick();
assert.equal(rr.query(thing2), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

rr.tick();
assert.equal(rr.query(thing2), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_START);

rr.tick();
assert.equal(rr.query(thing2), ROUNDROBIN_START);
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

// Specific behavior of missing next frame
rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_NO);
assert.equal(rr.query(thing2), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_START);

rr.tick();
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

rr.tick();
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

rr.tick();
assert.equal(rr.query(thing3), ROUNDROBIN_START);

// Bumping
rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_START);
assert.equal(rr.query(thing2), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

// bump before tick, when was head, does nothing
rr.bump(thing1);
rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_NO);
assert.equal(rr.query(thing2), ROUNDROBIN_START);
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_NO);
assert.equal(rr.query(thing2), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_START);

rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_START);
assert.equal(rr.query(thing2), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

// bump after tick, jumps ahead
// Note: order is 1-3-2 after this
rr.tick();
rr.bump(thing1);
assert.equal(rr.query(thing1), ROUNDROBIN_NO);
assert.equal(rr.query(thing2), ROUNDROBIN_START);
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_START);
assert.equal(rr.query(thing2), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_NO);
assert.equal(rr.query(thing2), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_START);

rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_NO);
assert.equal(rr.query(thing2), ROUNDROBIN_START);
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_START);
assert.equal(rr.query(thing2), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

// bump when other is continuing
rr.tick();
rr.bump(thing1);
assert.equal(rr.query(thing1), ROUNDROBIN_NO);
assert.equal(rr.query(thing2), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_START);
rr.stillWorking(thing3);

rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_NO);
assert.equal(rr.query(thing2), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_CONTINUE);

rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_START);
assert.equal(rr.query(thing2), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

// bump when not in list
rr.tick();
assert.equal(rr.query(thing2), ROUNDROBIN_START);
assert.equal(rr.query(thing3), ROUNDROBIN_NO);

rr.tick();
assert.equal(rr.query(thing2), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_START);

rr.bump(thing1);
rr.tick();
assert.equal(rr.query(thing1), ROUNDROBIN_START);
assert.equal(rr.query(thing2), ROUNDROBIN_NO);
assert.equal(rr.query(thing3), ROUNDROBIN_NO);
