/* eslint no-throw-literal:off */

import assert from 'assert';
import { asyncSeries } from 'glov-async';
import {
  callbackify,
  unpromisify,
} from 'glov/common/util';
import 'glov/server/test';

function promiseFactory(async, fail) {
  return new Promise(function (resolve, reject) {
    function done() {
      if (fail) {
        // eslint-disable-next-line prefer-promise-reject-errors
        reject('err_in_promise');
      } else {
        resolve(null);
      }
    }
    if (async) {
      setTimeout(done, 1);
    } else {
      done();
    }
  });
}

let callbackFactory = callbackify(promiseFactory);

function handleOneError(post_err) {
  process.once('uncaughtException', function (err) {
    let cb = post_err;
    post_err = null;
    assert(cb);
    cb(err.message || err, err.code || 'NOCODE');
  });
}

function crash() {
  throw 'err_in_cb';
}

function expectErrorThenCrash(err) {
  assert(err, 'Error expected');
  crash();
}

function expectNoErrorThenCrash(err) {
  assert(!err, 'No error expected');
  crash();
}

function neverCalled() {
  throw new Error('This function should never be called');
}

let made_to_end = false;
process.on('exit', function () {
  if (!made_to_end) {
    console.error('Did not make it to end of tests');
    assert(false, 'Did not make it to end of tests');
  }
});
asyncSeries([
  //////////////////////////////////////////////////////////////////////////
  // Test block 1: Success callback throws an exception
  function testUnprotectedSuccess(next) {
    // UNDESIRED BEHAVIOR
    // Without any protection, exception masquerades as a promise rejection
    handleOneError(function (msg, err) {
      assert(msg.includes('err_in_cb'));
      assert.equal(err, 'ERR_UNHANDLED_REJECTION');
      next();
    });
    promiseFactory(false, false).then(crash);
  },
  function testUnprotectedFailure(next) {
    // Unhandled promise rejection is treated as such
    handleOneError(function (msg, err) {
      assert(msg.includes('err_in_promise'));
      assert.equal(err, 'ERR_UNHANDLED_REJECTION');
      next();
    });
    promiseFactory(false, true).then(neverCalled);
  },
  function testUnprotectedCaughtSuccess(next) {
    // UNDESIRED BEHAVIOR
    // Without any protection, exception masquerades as a promise rejection
    handleOneError(function (msg, err) {
      assert(msg.includes('success'));
      next();
    });
    promiseFactory(false, false).then(crash).catch(function (err) {
      assert(String(err).includes('err_in_cb'));
      throw 'success'; // Need to clear the `handleOneError`
    });
  },
  function testUnprotectedCaughtFailure(next) {
    // Unhandled promise rejection is treated as such
    handleOneError(function (msg, err) {
      assert(msg.includes('success'));
      next();
    });
    promiseFactory(false, true).then(neverCalled).catch(function (err) {
      assert(String(err).includes('err_in_promise'));
      throw 'success';
    });
  },
  function testUnprotectedCaughtSuccess2(next) {
    // UNDESIRED BEHAVIOR
    // Without any protection, exception masquerades as a promise rejection
    handleOneError(function (msg, err) {
      assert(msg.includes('err_in_cb'));
      assert.equal(err, 'ERR_UNHANDLED_REJECTION');
      next();
    });
    promiseFactory(false, false).then(crash, neverCalled);
  },
  function testUnprotectedCaughtFailure2(next) {
    // Unhandled promise rejection is treated as such
    handleOneError(function (msg, err) {
      assert(msg.includes('success'));
      next();
    });
    promiseFactory(false, true).then(neverCalled, function (err) {
      assert(String(err).includes('err_in_promise'));
      throw 'success';
    });
  },

  //////////////////////////////////////////////////////////////////////////
  // Test block 2: Failure callback throws an exception
  function testUnprotectedCaughtFailure3(next) {
    // UNDESIRED BEHAVIOR
    // Without any protection, exception masquerades as a promise rejection
    handleOneError(function (msg, err) {
      assert(msg.includes('err_in_cb'));
      assert.equal(err, 'ERR_UNHANDLED_REJECTION');
      next();
    });
    promiseFactory(false, true).then(neverCalled).catch(crash);
  },
  function testUnprotectedCaughtFailure4(next) {
    // UNDESIRED BEHAVIOR
    // Without any protection, exception masquerades as a promise rejection
    handleOneError(function (msg, err) {
      assert(msg.includes('err_in_cb'));
      assert.equal(err, 'ERR_UNHANDLED_REJECTION');
      next();
    });
    promiseFactory(false, true).then(neverCalled, crash);
  },

  //////////////////////////////////////////////////////////////////////////
  // Test block 1-fix1 same as block 1, but fix with `unpromisify`
  function testUnpromisifiedSuccess(next) {
    // Unhandled exception is treated as such
    handleOneError(function (msg, err) {
      assert.equal(msg, 'err_in_cb');
      assert.equal(err, 'NOCODE');
      next();
    });
    promiseFactory(false, false).then(unpromisify(crash));
  },
  function testUnpromisifiedFailure(next) {
    // Unhandled promise rejection is treated as such
    handleOneError(function (msg, err) {
      assert(msg.includes('err_in_promise'));
      assert.equal(err, 'ERR_UNHANDLED_REJECTION');
      next();
    });
    promiseFactory(false, true).then(unpromisify(neverCalled));
  },
  function testUnpromisifiedCaughtSuccess(next) {
    // Unhandled exception is treated as such
    handleOneError(function (msg, err) {
      assert.equal(msg, 'err_in_cb');
      assert.equal(err, 'NOCODE');
      next();
    });
    promiseFactory(false, false).then(unpromisify(crash)).catch(function (err) {
      assert(String(err).includes('err_in_cb'));
      throw 'success'; // Need to clear the `handleOneError`
    });
  },
  function testUnpromisifiedCaughtFailure(next) {
    // Unhandled promise rejection is treated as such
    handleOneError(function (msg, err) {
      assert(msg.includes('success'));
      next();
    });
    promiseFactory(false, true).then(unpromisify(neverCalled)).catch(function (err) {
      assert(String(err).includes('err_in_promise'));
      throw 'success';
    });
  },
  function testUnpromisifiedCaughtSuccess2(next) {
    // Unhandled exception is treated as such
    handleOneError(function (msg, err) {
      assert.equal(msg, 'err_in_cb');
      assert.equal(err, 'NOCODE');
      next();
    });
    promiseFactory(false, false).then(unpromisify(crash), neverCalled);
  },
  function testUnpromisifiedCaughtFailure2(next) {
    // Unhandled promise rejection is treated as such
    handleOneError(function (msg, err) {
      assert(msg.includes('success'));
      next();
    });
    promiseFactory(false, true).then(unpromisify(neverCalled), function (err) {
      assert(String(err).includes('err_in_promise'));
      throw 'success';
    });
  },
  //////////////////////////////////////////////////////////////////////////
  // Test block 2-fix1 same as block 2, but fix with `unpromisify`
  function testUnpromisifiedCaughtFailure3(next) {
    // Unhandled exception is treated as such
    handleOneError(function (msg, err) {
      assert.equal(msg, 'err_in_cb');
      assert.equal(err, 'NOCODE');
      next();
    });
    promiseFactory(false, true).then(neverCalled).catch(unpromisify(crash));
  },
  function testUnpromisifiedCaughtFailure4(next) {
    // Unhandled exception is treated as such
    handleOneError(function (msg, err) {
      assert.equal(msg, 'err_in_cb');
      assert.equal(err, 'NOCODE');
      next();
    });
    promiseFactory(false, true).then(neverCalled, unpromisify(crash));
  },

  //////////////////////////////////////////////////////////////////////////
  // Test block fix2 similar, but fix with `callbackify`
  function testCallbackifiedSuccess(next) {
    // Unhandled exception is treated as such
    handleOneError(function (msg, err) {
      assert.equal(msg, 'err_in_cb');
      assert.equal(err, 'NOCODE');
      next();
    });
    callbackFactory(false, false, expectNoErrorThenCrash);
  },
  function testCallbackifiedFailure(next) {
    // Unhandled exception is treated as such
    handleOneError(function (msg, err) {
      assert.equal(msg, 'err_in_cb');
      assert.equal(err, 'NOCODE');
      next();
    });
    callbackFactory(false, true, expectErrorThenCrash);
  },

], function (err) {
  if (err) {
    throw err;
  }
  made_to_end = true;
});
