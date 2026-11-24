const { createRequire } = require('node:module');

const jestRequire = createRequire(require.resolve('jest'));
const jestCoreRequire = createRequire(jestRequire.resolve('@jest/core'));
const TestRunner = jestCoreRequire('jest-runner').default;

class SerialTestRunner extends TestRunner {
  constructor(...args) {
    super(...args);
    this.isSerial = true;
  }
}

module.exports = SerialTestRunner;
