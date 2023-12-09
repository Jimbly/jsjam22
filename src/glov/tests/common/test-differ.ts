import assert from 'assert';
import {
  Diff,
  diffApply,
  diffPacketRead,
  diffPacketWrite,
  differCreate,
} from 'glov/common/differ';
import { packetCreate } from 'glov/common/packet';
import { clone, deepEqual } from 'glov/common/util';
import 'glov/server/test';

let seen_diffs: Diff[] = [];
function track(diff: Diff): void {
  seen_diffs.push(clone(diff));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let obj: Record<string, any> = { a: 7, foo: 'bar', baz: { foobar: 7 } };
let differ = differCreate(obj, { history_size: 5 });
assert(!differ.canUndo());
assert(!differ.canRedo());
assert(deepEqual(obj, differ.data_last));
obj.baz.qux = 8;
let diff = differ.update(obj);
track(diff);
assert.equal(diff.length, 1);
assert.equal(diff[0][0], 'baz.qux');
assert.equal(diff[0][1], 8);
assert(deepEqual(obj, differ.data_last));
assert(differ.canUndo());
assert(!differ.canRedo());

differ.undo();
assert(!differ.canUndo());
assert(differ.canRedo());
differ.redo();
assert(differ.canUndo());
assert(!differ.canRedo());

let old_obj = clone(obj);
obj.a++;
diff = differ.update(obj);
track(diff);
assert.equal(diff.length, 1);
assert(deepEqual(obj, differ.data_last));

diff = differ.update(obj);
track(diff);
assert.equal(diff.length, 0);
assert(deepEqual(obj, differ.data_last));

// test undo
let recent_obj = obj;
let new_obj;
[diff, new_obj] = differ.undo();
assert.equal(diff.length, 1);
assert.equal(diff[0][0], 'a');
assert.equal(diff[0][1], 7);
assert(differ.canRedo());
assert(deepEqual(old_obj, new_obj));
obj = new_obj as typeof obj;
assert(deepEqual(obj, differ.data_last));

// test redo
[diff, new_obj] = differ.redo();
assert.equal(diff.length, 1);
assert.equal(diff[0][0], 'a');
assert.equal(diff[0][1], 8);
assert(deepEqual(new_obj, recent_obj));
obj = new_obj as typeof obj;


// test modifying the returns from undo/redo
obj.a++;
diff = differ.update(obj);
track(diff);
assert.equal(diff.length, 1);
assert(deepEqual(obj, differ.data_last));

let undos = 0;
while (differ.canUndo()) {
  ++undos;
  differ.undo();
}
assert.equal(undos, 3);

let redos = 0;
while (differ.canRedo()) {
  ++redos;
  differ.redo();
}
assert.equal(redos, 3);

// test history size
obj = { a: 0 };
const HIST_SIZE = 3;
differ = differCreate(obj, { history_size: HIST_SIZE });
for (let ii = 0; ii < 5; ++ii) {
  obj.a++;
  differ.update(obj);
}
assert.equal(obj.a, 5);
undos = 0;
let last_obj: unknown;
while (differ.canUndo()) {
  ++undos;
  [diff, last_obj] = differ.undo();
  assert.equal((last_obj as typeof obj).a, 5 - undos);
}
assert.equal(undos, HIST_SIZE - 1);
while (differ.canRedo()) {
  [diff, last_obj] = differ.redo();
}
assert.equal((last_obj as typeof obj).a, 5);

// Test deletes; test diff being serialized to JSON
obj = { a: [{ b: 1, c: null }] };
let copy = clone(obj);
differ = differCreate(obj, { history_size: HIST_SIZE });
delete obj.a[0].b;
diff = clone(differ.update(obj));
track(diff);
assert.equal(diff.length, 1);
assert.equal(diff[0][0], 'a.0.b');
assert.equal(diff[0][1], undefined);
diffApply(copy, diff);
assert.deepStrictEqual(copy, obj);

delete obj.a[0].c;
diff = clone(differ.update(obj));
track(diff);
assert.equal(diff.length, 1);
assert.equal(diff[0][0], 'a.0.c');
assert.equal(diff[0][1], undefined);
diffApply(copy, diff);
assert.deepStrictEqual(copy, obj);

// Test encoding to/from packet
let total_size = 0;
for (let ii = 0; ii < seen_diffs.length; ++ii) {
  diff = seen_diffs[ii];
  let pak = packetCreate(0);
  diffPacketWrite(pak, diff);
  total_size += pak.totalSize();
  pak.makeReadable();
  let diff2 = diffPacketRead(pak);
  assert.deepStrictEqual(diff, diff2);
}
if (false) {
  console.log(`Packet diff size = ${total_size} (JSON=${JSON.stringify(seen_diffs).length})`);
}
