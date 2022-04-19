export let defs = {};

defs.explosion = {
  particles: {
    part0: {
      blend: 'alpha',
      texture: 'particles/circle8',
      color: [1,1,1,1], // multiplied by animation track, default 1,1,1,1, can be omitted
      color_track: [
        // just values, NOT random range
        { t: 0.0, v: [1,1,1,0] },
        { t: 0.2, v: [1,1,1,1] },
        { t: 0.8, v: [1,1,1,1] },
        { t: 1.0, v: [1,1,1,0] },
      ],
      size: [[12,4], [12,4]], // multiplied by animation track
      size_track: [
        // just values, NOT random range
        { t: 0.0, v: [1,1] },
        { t: 0.2, v: [2,2] },
        { t: 0.4, v: [1,1] },
        { t: 1.0, v: [1.5,1.5] },
      ],
      accel: [0,0,0],
      rot: [0,360], // degrees
      rot_vel: [10,2], // degrees per second
      lifespan: [500,0], // milliseconds
      kill_time_accel: 5,
    },
  },
  emitters: {
    part0: {
      particle: 'part0',
      // Random ranges affect each emitted particle:
      pos: [[-8,16], [-8,16], 0],
      vel: [0,0,0],
      emit_rate: [15,0], // emissions per second
      // Random ranges only calculated upon instantiation:
      emit_time: [0,500],
      emit_initial: 10,
      max_parts: Infinity,
    },
  },
  system_lifespan: 1000,
};
