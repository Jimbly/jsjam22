import assert from 'assert';
import { asyncSeries } from 'glov-async';
import { DataObject } from 'glov/common/types';
import {
  dateToFileTimestamp,
  empty,
  lerpAngle,
  nearSameAngle,
  once,
  randomNot,
  trimEnd,
} from 'glov/common/util';
import 'glov/server/test';

const { PI } = Math;

asyncSeries([
  function testOnce(next) {
    let called = false;
    function foo(): void {
      assert(!called);
      called = true;
    }
    let bar = once(foo);
    bar();
    bar();
    assert(called);
    next();
  },
  function testMisc(next) {
    assert(empty({}));
    assert(!empty({ foo: 'bar' }));
    assert(empty([] as unknown as DataObject));
    assert(!empty([1] as unknown as DataObject));
    next();
  },
  function testEmpty(next) {
    class Foo {
      bar: string;
      constructor() {
        this.bar = 'baz';
      }
    }
    assert(!empty(new Foo() as unknown as DataObject));
    class Foo2 {
      declare bar: string;
    }
    assert(empty(new Foo2() as unknown as DataObject));
    class Foo3 {
      bar!: string;
    }
    assert(!empty(new Foo3() as unknown as DataObject));
    class Foo4 {
      bar?: string;
    }
    assert(!empty(new Foo4() as unknown as DataObject));
    next();
  },
  function testLerpAngle(next) {
    const E = 0.00001;
    const ANGLES = [0, 0.1, PI/3, PI/2, PI, PI * 3/2, PI * 2];
    for (let ii = 0; ii < ANGLES.length; ++ii) {
      let a0 = ANGLES[ii];
      for (let jj = ii; jj < ANGLES.length; ++jj) {
        let a1 = ANGLES[jj];
        assert(nearSameAngle(lerpAngle(0, a0, a1), a0, E));
        assert(nearSameAngle(lerpAngle(0, a1, a0), a1, E));
        assert(nearSameAngle(lerpAngle(1, a0, a1), a1, E));
        assert(nearSameAngle(lerpAngle(1, a1, a0), a0, E));
      }
    }
    assert(nearSameAngle(lerpAngle(0.5, 0, 0.2), 0.1, E));
    assert(nearSameAngle(lerpAngle(0.5, 0, PI*2-0.2), PI*2-0.1, E));
    next();
  },
  function testDateToFileTimestamp(next) {
    let d = new Date(9999, 11, 31, 23, 59, 59);
    assert(dateToFileTimestamp(d) === '9999-12-31 23_59_59');
    d = new Date(1900, 0, 1, 0, 0, 0);
    assert(dateToFileTimestamp(d) === '1900-01-01 00_00_00');
    next();
  },
  function testRandomNot(next) {
    let v = 2;
    for (let ii = 0; ii < 10; ++ii) {
      let v2 = randomNot(v, 2, 4);
      assert(v2 !== v);
      assert(v2 >= 2);
      assert(v2 < 4);
      v = v2;
    }
    next();
  },
  function testTrimEnd(next) {
    assert.equal(trimEnd('asdf  '), trimEnd('asdf'));
    assert.equal(trimEnd('asdf \n '), trimEnd('asdf'));
    assert.equal(trimEnd('  asdf \n '), trimEnd('  asdf'));
    assert.equal(trimEnd(' \n asdf \n '), trimEnd(' \n asdf'));
    next();
  },
], function (err) {
  if (err) {
    throw err;
  }
});
