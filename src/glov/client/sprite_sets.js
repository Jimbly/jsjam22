const assert = require('assert');

const sprite_sets = {
  stone: {
    button: { name: 'stone/button', ws: [32, 64, 32], hs: [128] },
    button_rollover: { name: 'stone/button_rollover', ws: [32, 64, 32], hs: [128] },
    button_down: { name: 'stone/button_down', ws: [32, 64, 32], hs: [128] },
    button_disabled: { name: 'stone/button_disabled', ws: [32, 64, 32], hs: [128] },
  },
  pixely: {
    color_set_shades: [0.8, 0.7, 0.4],
    slider_params: [1, 1, 0.3],

    button: { name: 'pixely/button', ws: [4, 5, 4], hs: [13] },
    button_rollover: null,
    button_down: { name: 'pixely/button_down', ws: [4, 5, 4], hs: [13] },
    button_disabled: { name: 'pixely/button_disabled', ws: [4, 5, 4], hs: [13] },
    panel: { name: 'pixely/panel', ws: [3, 2, 3], hs: [3, 10, 3] },
    menu_entry: { name: 'pixely/menu_entry', ws: [4, 5, 4], hs: [13] },
    menu_selected: { name: 'pixely/menu_selected', ws: [4, 5, 4], hs: [13] },
    menu_down: { name: 'pixely/menu_down', ws: [4, 5, 4], hs: [13] },
    menu_header: { name: 'pixely/menu_header', ws: [4, 5, 12], hs: [13] },
    slider: { name: 'pixely/slider', ws: [6, 2, 6], hs: [13] },
    // slider_notch:  name: 'pixely///',{ ws: [3], hs: [13] },
    slider_handle: { name: 'pixely/slider_handle', ws: [9], hs: [13] },

    scrollbar_bottom: { name: 'pixely/scrollbar_bottom', ws: [11], hs: [13] },
    scrollbar_trough: { name: 'pixely/scrollbar_trough', ws: [11], hs: [8], wrap_t: true },
    scrollbar_top: { name: 'pixely/scrollbar_top', ws: [11], hs: [13] },
    scrollbar_handle_grabber: { name: 'pixely/scrollbar_handle_grabber', ws: [11], hs: [13] },
    scrollbar_handle: { name: 'pixely/scrollbar_handle', ws: [11], hs: [3, 7, 3] },
    progress_bar: { name: 'pixely/progress_bar', ws: [3, 7, 3], hs: [13] },
    progress_bar_trough: { name: 'pixely/progress_bar_trough', ws: [3, 7, 3], hs: [13] },

    collapsagories: { name: 'pixely/collapsagories', ws: [4, 5, 4], hs: [13] },
    collapsagories_rollover: { name: 'pixely/collapsagories_rollover', ws: [4, 5, 4], hs: [13] },
    collapsagories_shadow_down: { name: 'pixely/collapsagories_shadow_down', ws: [1, 2, 1], hs: [13] },
  },
};

export function spriteSetGet(key) {
  assert(sprite_sets[key]);
  return sprite_sets[key];
}
