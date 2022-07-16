module.exports = function (config) {
  config.extra_index = [{
    name: 'crazy',
    defines: {
      PLATFORM: 'crazy',
    },
    zip: true,
  }, {
    name: 'itch',
    defines: {
      PLATFORM: 'itch',
    },
    zip: true,
  }];
};
