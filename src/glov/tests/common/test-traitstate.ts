import assert from 'assert';
import { TypeDef, traitFactoryCreate } from 'glov/common/trait_factory';
import { clone } from 'glov/common/util';
import 'glov/server/test';
import { DummyFS } from './dummyfs';

type Stats = {
  stat1: number;
};

type ClassData = {
  stats: Stats;
};

class BaseClass {
  declare type_id: string;
  data: ClassData;
  constructor(data: ClassData) {
    this.data = data;
  }
}

let factory = traitFactoryCreate<BaseClass, ClassData>();
factory.registerTrait<Stats, undefined>('stats', {
  default_opts: {
    stat1: 1,
  },
  alloc_state: function (opts: Stats, obj: BaseClass) {
    // TODO: use a callback that doesn't actually need to allocate any state on the entity?
    if (!obj.data.stats) {
      obj.data.stats = clone(opts);
    }
    return undefined;
  },
});


let fs = new DummyFS<TypeDef>({
  'foo/bar.def': {
    traits: [{
      id: 'stats',
      stat1: 3,
    }],
  },
});

let reload_called = '';
function onReload(type_id: string): void {
  reload_called = type_id;
}

factory.initialize({
  name: 'Test',
  fs,
  directory: 'foo',
  ext: '.def',
  Ctor: BaseClass,
  reload_cb: onReload,
});

let barnew = factory.allocate('bar', {} as ClassData);
let barold = factory.allocate('bar', { stats: { stat1: 5 } });

assert.equal(barnew.data.stats.stat1, 3);
assert.equal(barold.data.stats.stat1, 5);

// Reload
assert(!reload_called);
// trigger reload
fs.applyNewFile('foo/bar.def', {
  traits: [{
    id: 'stats',
    stat1: 7,
  }],
});
assert.equal(reload_called, 'bar');

// existing should not have changed
assert.equal(barnew.data.stats.stat1, 3);
assert.equal(barold.data.stats.stat1, 5);

// allocate again, should get the new values
barnew = factory.allocate('bar', {} as ClassData);
barold = factory.allocate('bar', { stats: { stat1: 5 } });
assert.equal(barnew.data.stats.stat1, 7);
assert.equal(barold.data.stats.stat1, 5);
