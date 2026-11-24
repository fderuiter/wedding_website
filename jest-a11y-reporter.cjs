const fs = require('node:fs');
const path = require('node:path');

function resolveDefaultReportFile(cwd = process.cwd()) {
  return (
    process.env.JEST_A11Y_REPORT_PATH ||
    path.join(cwd, 'test-results', 'jest-a11y-violations.json')
  );
}

function getShardMeta(reportFile) {
  const resolved = path.resolve(reportFile);
  const dir = path.dirname(resolved);
  const ext = path.extname(resolved) || '.json';
  const base = path.basename(resolved, ext);
  const prefix = `.${base}.shard-`;
  return { resolved, dir, prefix, ext };
}

function getWorkerShardPath(reportFile, workerKey) {
  const { dir, prefix } = getShardMeta(reportFile);
  const resolvedKey =
    workerKey || `${process.env.JEST_WORKER_ID || 'main'}-${process.pid}`;
  const safeKey = String(resolvedKey).replace(/[^a-zA-Z0-9_.-]/g, '_');
  return path.join(dir, `${prefix}${safeKey}.json`);
}

function listJestViolationShards(reportFile) {
  const { dir, prefix } = getShardMeta(reportFile);
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith('.json'))
    .sort()
    .map((entry) => path.join(dir, entry));
}

function cleanJestViolationShards(reportFile) {
  const shardPaths = listJestViolationShards(reportFile);
  for (const shardPath of shardPaths) {
    try {
      fs.rmSync(shardPath, { force: true });
    } catch {
      // Ignore concurrent cleanup errors
    }
  }
}

function writeJsonAtomic(targetPath, payload) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tempPath = path.join(dir, `.${path.basename(targetPath)}.${nonce}.tmp`);
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, targetPath);
}

function aggregateJestViolationShards(reportFile) {
  const resolvedReport = reportFile || resolveDefaultReportFile();
  const shardPaths = listJestViolationShards(resolvedReport);
  const aggregated = [];

  for (const shardPath of shardPaths) {
    try {
      const raw = fs.readFileSync(shardPath, 'utf8').trim();
      if (!raw) {
        continue;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        aggregated.push(...parsed);
      }
    } catch {
      // Ignore transient read errors if another worker is rotating its shard
    }
  }

  writeJsonAtomic(resolvedReport, aggregated);
  return aggregated;
}

function appendJestViolations(violations, options = {}) {
  if (!Array.isArray(violations) || violations.length === 0) {
    return;
  }
  const reportFile = options.reportFile || resolveDefaultReportFile();
  const shardPath = getWorkerShardPath(reportFile, options.workerKey);

  try {
    let existingShard = [];
    if (fs.existsSync(shardPath)) {
      const raw = fs.readFileSync(shardPath, 'utf8').trim();
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          existingShard = parsed;
        }
      }
    }

    writeJsonAtomic(shardPath, [...existingShard, ...violations]);
    aggregateJestViolationShards(reportFile);
  } catch {
    // Preserve matcher behavior even if filesystem write fails
  }
}

function createJestAxeMock(jestObj) {
  const actual = jestObj.requireActual('jest-axe');

  const wrappedToHaveNoViolations = {
    toHaveNoViolations(results) {
      const outcome = actual.toHaveNoViolations.toHaveNoViolations.call(this, results);
      if (!this?.isNot && Array.isArray(outcome?.actual) && outcome.actual.length > 0) {
        appendJestViolations(outcome.actual);
      }
      return outcome;
    },
  };

  return {
    ...actual,
    toHaveNoViolations: wrappedToHaveNoViolations,
  };
}

class JestA11yShardReporter {
  constructor(globalConfig) {
    this._rootDir = globalConfig?.rootDir || process.cwd();
  }

  onRunStart() {
    const reportFile = resolveDefaultReportFile(this._rootDir);
    try {
      cleanJestViolationShards(reportFile);
    } catch {
      // Non-fatal cleanup error
    }
  }

  onRunComplete() {
    const reportFile = resolveDefaultReportFile(this._rootDir);
    try {
      const shards = listJestViolationShards(reportFile);
      if (shards.length > 0) {
        aggregateJestViolationShards(reportFile);
        cleanJestViolationShards(reportFile);
      } else if (!fs.existsSync(reportFile)) {
        writeJsonAtomic(reportFile, []);
      }
    } catch {
      // Non-fatal aggregation error
    }
  }
}

module.exports = JestA11yShardReporter;
module.exports.JestA11yShardReporter = JestA11yShardReporter;
module.exports.resolveDefaultReportFile = resolveDefaultReportFile;
module.exports.getWorkerShardPath = getWorkerShardPath;
module.exports.listJestViolationShards = listJestViolationShards;
module.exports.cleanJestViolationShards = cleanJestViolationShards;
module.exports.aggregateJestViolationShards = aggregateJestViolationShards;
module.exports.appendJestViolations = appendJestViolations;
module.exports.createJestAxeMock = createJestAxeMock;
