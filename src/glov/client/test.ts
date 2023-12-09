import assert from 'assert';
import { setStoragePrefix } from 'glov/client/local_storage';
import { DataObject } from 'glov/common/types';
import 'glov/server/test';

setStoragePrefix('mock');

class MockElementDebug {
}
let debug: MockElementDebug;

class MockLocation {
  protocol = 'mock';
  href = 'mock';
}

class MockDocument {
  getElementById(id: string): MockElementDebug {
    assert.equal(id, 'debug');
    if (!debug) {
      debug = new MockElementDebug();
    }
    return debug;
  }
  location = new MockLocation();
}

class MockNavigator {
  userAgent = 'glov/test/mock';
}
let glob = global as DataObject;

assert(!glob.addEventListener);
glob.addEventListener = function () {
  // ignore
};
glob.conf_platform = 'web';
glob.navigator = new MockNavigator();
glob.BUILD_TIMESTAMP = String(Date.now());

assert(!glob.document);
let document = new MockDocument();
glob.document = document;
glob.location = document.location;
glob.window = glob;
