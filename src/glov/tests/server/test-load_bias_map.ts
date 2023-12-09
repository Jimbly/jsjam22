import assert from 'assert';
import { loadBiasMap } from 'glov/server/load_bias_map.js';
import 'glov/server/test';

// Example: CPU usage bias > 75%
assert.equal(loadBiasMap(0, 70, 75, 100, 10, 20), 0);
assert.equal(loadBiasMap(70, 70, 75, 100, 10, 20), 0);
assert.equal(loadBiasMap(72.5, 70, 75, 100, 10, 20), 5);
assert.equal(loadBiasMap(75, 70, 75, 100, 10, 20), 10);
assert.equal(loadBiasMap(75+25/2, 70, 75, 100, 10, 20), 15);
assert.equal(loadBiasMap(100, 70, 75, 100, 10, 20), 20);
assert.equal(loadBiasMap(110, 70, 75, 100, 10, 20), 20);


// Example: Free memory bias < 20%
assert.equal(loadBiasMap(100, 25, 20, 0, 10, 20), 0);
assert.equal(loadBiasMap(25, 25, 20, 0, 10, 20), 0);
assert.equal(loadBiasMap(22.5, 25, 20, 0, 10, 20), 5);
assert.equal(loadBiasMap(20, 25, 20, 0, 10, 20), 10);
assert.equal(loadBiasMap(10, 25, 20, 0, 10, 20), 15);
assert.equal(loadBiasMap(0, 25, 20, 0, 10, 20), 20);
