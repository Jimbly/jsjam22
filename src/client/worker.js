
const worker = require('glov/client/worker_thread.js');

worker.addHandler('test', function () {
  console.log('Worker Test!');
});
