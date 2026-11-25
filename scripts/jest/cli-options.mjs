const TARGETED_JEST_FLAGS = new Set([
  '--changedFilesWithAncestor',
  '--changedSince',
  '--collectCoverageOnlyFrom',
  '--findRelatedTests',
  '--ignoreProjects',
  '--lastCommit',
  '--onlyChanged',
  '--onlyFailures',
  '--projects',
  '--runTestsByPath',
  '--selectProjects',
  '--shard',
  '--testMatch',
  '--testNamePattern',
  '--testPathPattern',
  '--testPathPatterns',
  '--testRegex',
  '--watch',
  '--watchAll',
  '-f',
  '-o',
  '-t',
]);

const KNOWN_COVERAGE_REPORTERS = new Set([
  'clover',
  'cobertura',
  'html',
  'html-spa',
  'json',
  'json-summary',
  'lcov',
  'lcovonly',
  'none',
  'teamcity',
  'text',
  'text-lcov',
  'text-summary',
]);

const VALUE_CONSUMING_NON_TARGET_FLAGS = new Set([
  '--cacheDirectory',
  '--collectCoverageFrom',
  '--config',
  '--coverageDirectory',
  '--coveragePathIgnorePatterns',
  '--coverageProvider',
  '--coverageThreshold',
  '--env',
  '--filter',
  '--globalSetup',
  '--globalTeardown',
  '--globals',
  '--haste',
  '--maxConcurrency',
  '--maxWorkers',
  '--moduleDirectories',
  '--moduleFileExtensions',
  '--moduleNameMapper',
  '--modulePathIgnorePatterns',
  '--modulePaths',
  '--notifyMode',
  '--openHandlesTimeout',
  '--outputFile',
  '--preset',
  '--prettierPath',
  '--reporters',
  '--resolver',
  '--rootDir',
  '--roots',
  '--runner',
  '--seed',
  '--setupFiles',
  '--setupFilesAfterEnv',
  '--snapshotSerializers',
  '--testEnvironment',
  '--testEnvironmentOptions',
  '--testFailureExitCode',
  '--testPathIgnorePatterns',
  '--testResultsProcessor',
  '--testRunner',
  '--testSequencer',
  '--testTimeout',
  '--transform',
  '--transformIgnorePatterns',
  '--unmockedModulePathPatterns',
  '--watchPathIgnorePatterns',
  '--workerGracefulExitTimeout',
  '-c',
  '-w',
]);

/**
 * Checks whether CLI arguments explicitly disable Jest coverage collection.
 * @param {readonly string[]} [args]
 * @returns {boolean}
 */
export function hasCoverageDisableFlag(args = process.argv.slice(2)) {
  return args.some(
    (arg) =>
      arg === '--coverage=false' || arg === '--collectCoverage=false' || arg === '--no-coverage'
  );
}

/**
 * Detects CLI invocations that filter, shard, or watch Jest suites rather than running the full suite.
 * @param {readonly string[]} [args]
 * @returns {boolean}
 */
export function isTargetedJestRun(args = process.argv.slice(2)) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) {
      continue;
    }
    if (arg === '--') {
      return args.slice(i + 1).some((restArg) => Boolean(restArg));
    }
    const eqIdx = arg.indexOf('=');
    const flagName = eqIdx === -1 ? arg : arg.slice(0, eqIdx);

    if (TARGETED_JEST_FLAGS.has(flagName)) {
      return true;
    }

    if (eqIdx === -1 && (flagName === '--bail' || flagName === '-b')) {
      const nextArg = args[i + 1];
      if (nextArg && /^\d+$/.test(nextArg)) {
        i += 1;
      }
      continue;
    }

    if (eqIdx === -1 && flagName === '--coverageReporters') {
      while (args[i + 1] && KNOWN_COVERAGE_REPORTERS.has(args[i + 1])) {
        i += 1;
      }
      continue;
    }

    if (eqIdx === -1 && VALUE_CONSUMING_NON_TARGET_FLAGS.has(flagName)) {
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('-')) {
        i += 1;
      }
      continue;
    }

    if (!arg.startsWith('-')) {
      return true;
    }
  }
  return false;
}

/**
 * Determines whether coverage instrumentation is enabled for a Jest invocation.
 * @param {{ args?: readonly string[]; env?: NodeJS.ProcessEnv }} [options]
 * @returns {boolean}
 */
export function resolveIsCoverageRun(options = {}) {
  const args = options.args ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const coverageEnabled = args.some(
    (arg) =>
      arg === '--coverage' ||
      arg === '--collectCoverage' ||
      arg === '--coverage=true' ||
      arg === '--collectCoverage=true'
  );
  const event = env.npm_lifecycle_event || '';
  return (
    !hasCoverageDisableFlag(args) &&
    (event === 'test:cov' ||
      event === 'test:cov:html' ||
      env.COLLECT_COVERAGE === 'true' ||
      coverageEnabled)
  );
}

/**
 * Determines whether global coverage thresholds apply to a Jest invocation.
 * @param {{ args?: readonly string[]; env?: NodeJS.ProcessEnv }} [options]
 * @returns {boolean}
 */
export function shouldEnforceGlobalCoverageThreshold(options = {}) {
  const args = options.args ?? process.argv.slice(2);
  return resolveIsCoverageRun(options) && !isTargetedJestRun(args);
}
