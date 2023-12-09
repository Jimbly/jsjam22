import assert from 'assert';
import { TypeDef, traitFactoryCreate } from 'glov/common/trait_factory';
import { has } from 'glov/common/util';
import 'glov/server/test';
import { DummyFS } from './dummyfs';

import type { DataObject } from 'glov/common/types';

const PROP1_DEFAULT = 1;
const PROP1_BAR = 2;
const PROP1_CHANGER = 3;
const PROP1_TEST = 4;
const ADDEND_ADDER2 = 9;
const ADDEND_QUUX = 17;

class BaseClass {
  declare type_id: string;
  declare prop1: number;
  data: DataObject;
  constructor(data: DataObject) {
    this.data = data;
  }
  method1?(foo: number): number;
  method2?(foo: number): number;
  method3?(): number;
}
BaseClass.prototype.prop1 = PROP1_DEFAULT;

let factory = traitFactoryCreate<BaseClass, DataObject>();
factory.registerTrait('prop1changer', {
  properties: {
    prop1: PROP1_CHANGER,
  },
});

function methodadderOne(this: BaseClass, foo: number): number {
  return this.prop1 + foo;
}
factory.registerTrait('methodadder1', {
  methods: {
    method1: methodadderOne,
  },
});

type Method1WithOptsOpts = {
  addend: number;
};
interface Method1WithOpts extends BaseClass {
  readonly method1withopts_opts: Method1WithOptsOpts;
}
function method1WithOpts(this: Method1WithOpts, foo: number): number {
  return this.prop1 + this.method1withopts_opts.addend + foo;
}
factory.registerTrait<Method1WithOptsOpts>('method1withopts', {
  methods: {
    method1: method1WithOpts,
  },
  default_opts: {
    addend: ADDEND_ADDER2,
  },
});

const STATE1_INIT = 100;
const STATE1_QUUX = 200;
type StatefulMethodOpts = {
  state1_init: number;
};
type StatefulMethodState = {
  state1: number;
};
interface StatefulMethod extends BaseClass {
  readonly stateful_method_opts: StatefulMethodOpts;
  stateful_method_state: StatefulMethodState;
}
function statefulMethod(this: StatefulMethod, foo: number): number {
  this.stateful_method_state.state1++;
  return this.prop1 + this.stateful_method_state.state1 + foo;
}
function statefulMethodAllocState(opts: StatefulMethodOpts): StatefulMethodState {
  return {
    state1: opts.state1_init,
  };
}
factory.registerTrait<StatefulMethodOpts, StatefulMethodState>('stateful_method', {
  methods: {
    method2: statefulMethod,
  },
});
factory.extendTrait<StatefulMethodOpts, StatefulMethodState>('stateful_method', {
  default_opts: {
    state1_init: STATE1_INIT,
  },
  alloc_state: statefulMethodAllocState,
});

const PROP2_DEFAULT = 30;
const PROP2_QUUX = 40;
type LateInitOpts = {
  prop2: number;
  prop3: number;
};
interface LateInit extends BaseClass {
  readonly late_init_opts: LateInitOpts;
}
function lateInitMethod(this: LateInit): number {
  return this.late_init_opts.prop2;
}
let init_called_yet = false;
factory.registerTrait('late_init', {
  methods: {
    method3: lateInitMethod,
  },
  default_opts: {
    prop2: PROP2_DEFAULT,
    prop3: -1,
  },
  init_prototype: function (opts: LateInitOpts) {
    init_called_yet = true;
    opts.prop3 = opts.prop2 + 1;
  },
});

let fs = new DummyFS<TypeDef>({
  'foo/bar.def': {
    // No traits, just properties
    properties: {
      prop1: PROP1_BAR,
    },
  },
  'foo/baz.def': {
    // prop1 is class default
    // has a method
    traits: [{
      id: 'methodadder1',
    }],
  },
  'foo/qux.def': {
    // prop1 overriden by trait
    traits: [{
      id: 'prop1changer',
    }, {
      // has a method which will be overridden by another trait
      id: 'methodadder1',
    }, {
      // has a method with default opts
      id: 'method1withopts',
    }, {
      // has a stateful method with default opts
      id: 'stateful_method',
    }, {
      id: 'late_init', // late init with default
    }],
  },
  'foo/quux.def': {
    // prop1 is class default
    traits: [{
      // has a method with specific opts
      id: 'method1withopts',
      addend: ADDEND_QUUX
    }, {
      // has a stateful method with specific opts
      id: 'stateful_method',
      state1_init: STATE1_QUUX,
    }, {
      id: 'late_init', // late init with specific
      prop2: PROP2_QUUX,
    }],
  },
});

let reload_called = '';
function onReload(type_id: string): void {
  reload_called = type_id;
}

assert(!init_called_yet);
factory.initialize({
  name: 'Test',
  fs,
  directory: 'foo',
  ext: '.def',
  Ctor: BaseClass,
  reload_cb: onReload,
});
assert(init_called_yet);

let bar = factory.allocate('bar', { is_bar: true });
let baz = factory.allocate('baz', {});
let qux = factory.allocate('qux', {});
let quux = factory.allocate('quux', {});

// Has type_id
assert.equal(bar.type_id, 'bar');
assert.equal(baz.type_id, 'baz');
assert.equal(qux.type_id, 'qux');
assert.equal(quux.type_id, 'quux');

// Got constructor parameter
assert.equal(bar.data.is_bar, true);

// Gets a property from prototype, definition, or trait
assert.equal(bar.prop1, PROP1_BAR);
assert.equal(baz.prop1, PROP1_DEFAULT);
assert.equal(qux.prop1, PROP1_CHANGER);
assert.equal(quux.prop1, PROP1_DEFAULT);

// Property from prototype is definitely not being overridden in instance
let Baz = factory.getCtorForTesting('baz');
assert(has(BaseClass.prototype, 'prop1'));
assert(!has(Baz.prototype, 'prop1')); // Would be OK (better?) if this were copied up though
Baz.prototype.prop1 = PROP1_TEST;
assert.equal(baz.prop1, PROP1_TEST);
delete Baz.prototype.prop1;

// Methods
assert(baz.method1);
assert.equal(baz.method1(7), PROP1_DEFAULT + 7);
// Overriding priority and default opts
assert(qux.method1 === method1WithOpts);
assert.equal(qux.method1(7), PROP1_CHANGER + 7 + ADDEND_ADDER2);
// Specific opts
assert(quux.method1);
assert.equal(quux.method1(7), PROP1_DEFAULT + 7 + ADDEND_QUUX);

// Stateful traits
assert(qux.method2);
assert.equal(qux.method2(7), STATE1_INIT + 7 + PROP1_CHANGER + 1);
assert.equal(qux.method2(7), STATE1_INIT + 7 + PROP1_CHANGER + 2);
assert(quux.method2);
assert.equal(quux.method2(7), STATE1_QUUX + 7 + PROP1_DEFAULT + 1);
assert.equal(quux.method2(7), STATE1_QUUX + 7 + PROP1_DEFAULT + 2);

// Late init
assert(qux.method3);
assert.equal(qux.method3(), PROP2_DEFAULT);
assert(quux.method3);
assert.equal(quux.method3(), PROP2_QUUX);

// Reload
assert(!reload_called);
// trigger reload
fs.applyNewFile('foo/qux.def', {
  // simple, no traits
});
assert.equal(reload_called, 'qux');
// baz should not have changed
assert.equal(baz.method1(7), PROP1_DEFAULT + 7);
// existing qux should not have changed, maintains state
assert.equal(qux.prop1, PROP1_CHANGER);
assert.equal(qux.method2(7), STATE1_INIT + 7 + PROP1_CHANGER + 3);
let newqux = factory.allocate('qux', {});
// new qux should have new properties
assert.equal(newqux.prop1, PROP1_DEFAULT);
