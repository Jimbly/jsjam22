module.exports = function (config) {
  config.extra_index = [{
    name: 'crazy',
    defines: {
      PLATFORM: 'crazy',
      ENV: '',
    },
    zip: true,
  }, {
    name: 'itch',
    defines: {
      PLATFORM: 'itch',
      ENV: '',
    },
    zip: true,
  }];
};
