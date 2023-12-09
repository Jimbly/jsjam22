const assert = require('assert');
const { vec2, vec4 } = require('glov/common/vmath.js');
const { engineStartupFunc } = require('./engine.js');
const { createSprite } = require('./sprites.js');
const { textureLoad } = require('./textures.js');

const uvs = vec4(0, 0, 1, 1);
const origin_centered = vec2(0.5, 0.5);
const origin_centered_x = vec2(0.5, 0);
let load_opts = {};
let hit_startup = false;
export function spritesheetTextureOpts(name, opts) {
  assert(!hit_startup);
  load_opts[name] = opts;
}
export function spritesheetRegister(runtime_data) {
  // Create with dummy data, will load later
  let texs = [];
  let sprite = runtime_data.sprite = createSprite({ texs, uvs });
  runtime_data[`sprite_${runtime_data.name}`] = sprite;
  let sprite_centered = runtime_data.sprite_centered = createSprite({ texs, uvs, origin: origin_centered });
  runtime_data[`sprite_${runtime_data.name}_centered`] = sprite_centered;
  let sprite_centered_x = runtime_data.sprite_centered_x = createSprite({ texs, uvs, origin: origin_centered_x });
  runtime_data[`sprite_${runtime_data.name}_centered_x`] = sprite_centered_x;
  sprite.uidata = sprite_centered.uidata = sprite_centered_x.uidata = runtime_data.uidata;
  engineStartupFunc(function () {
    hit_startup = true;
    let opts = load_opts[runtime_data.name] || {};
    if (runtime_data.layers) {
      for (let idx = 0; idx < runtime_data.layers; ++idx) {
        let tex = textureLoad({
          ...opts,
          url: `img/${runtime_data.name}_${idx}.png`,
        });
        texs.push(tex);
      }
    } else {
      let tex = textureLoad({
        ...opts,
        url: `img/${runtime_data.name}.png`,
      });
      texs.push(tex);
    }
  });
}
