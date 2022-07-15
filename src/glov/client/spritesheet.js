const { vec4 } = require('glov/common/vmath.js');
const { engineStartupFunc } = require('./engine.js');
const { createSprite } = require('./sprites.js');
const textures = require('./textures.js');

export function spritesheetRegister(runtime_data) {
  // Create with dummy data, will load later
  runtime_data.sprite = createSprite({ texs: [], uvs: vec4(0, 0, 1, 1) });
  runtime_data[`sprite_${runtime_data.name}`] = runtime_data.sprite;
  runtime_data.sprite.uidata = runtime_data.uidata;
  engineStartupFunc(function () {
    if (runtime_data.layers) {
      for (let idx = 0; idx < runtime_data.layers; ++idx) {
        let tex = textures.load({
          url: `img/${runtime_data.name}_${idx}.png`,
        });
        runtime_data.sprite.texs.push(tex);
      }
    } else {
      let tex = textures.load({
        url: `img/${runtime_data.name}.png`,
      });
      runtime_data.sprite.texs.push(tex);
    }
  });
}
