const path = require('path');
const fs = require('fs');
const { ensureDir } = require('../shared-utils');

function loadDotEnv(repoRoot) {
  const envFile = path.join(repoRoot, '.env');
  if (!fs.existsSync(envFile)) return;
  const text = fs.readFileSync(envFile, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

function splitCandidateDirs(rawValue = '') {
  return String(rawValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadRuntimeConfig(repoRoot = path.resolve(__dirname, '..', '..')) {
  loadDotEnv(repoRoot);
  const dataDir = path.resolve(repoRoot, process.env.AUTH_DATA_DIR || 'data');
  const runtimeDir = path.join(dataDir, 'runtime');
  const dbDir = path.join(runtimeDir, 'db');
  const jobsDir = path.join(dbDir, 'jobs');
  const eventsDir = path.join(dbDir, 'events');
  const artifactsDir = path.join(dataDir, 'artifacts');
  const legacyProjectRoot = process.env.AUTH_LEGACY_PROJECT_ROOT || 'E:/codex-registrar2/codex-registrar2_副本';
  const sourceUsernameFile = process.env.AUTH_USERNAME_SOURCE || path.join(legacyProjectRoot, 'username.json');
  const candidateTokenDirs = splitCandidateDirs(process.env.AUTH_LEGACY_TOKEN_DIRS || path.join(legacyProjectRoot, 'tokens'));

  ensureDir(dataDir);
  ensureDir(runtimeDir);
  ensureDir(dbDir);
  ensureDir(jobsDir);
  ensureDir(eventsDir);
  ensureDir(artifactsDir);

  return {
    repoRoot,
    dataDir,
    runtimeDir,
    dbDir,
    jobsDir,
    eventsDir,
    artifactsDir,
    accountsCacheFile: path.join(dbDir, 'accounts.json'),
    apiPort: Number(process.env.AUTH_API_PORT || 3000),
    webPort: Number(process.env.AUTH_WEB_PORT || 3010),
    workerPollMs: Number(process.env.AUTH_WORKER_POLL_MS || 3000),
    defaultUser: process.env.AUTH_DEFAULT_USER || 'local-admin',
    runtimeMode: process.env.AUTH_RUNTIME_MODE || 'compat-legacy-cli',
    legacyProjectRoot,
    legacyEntrypoint: path.join(legacyProjectRoot, 'index.js'),
    sourceUsernameFile,
    candidateTokenDirs,
    legacyConfigProfile: process.env.AUTH_LEGACY_CONFIG_PROFILE || 'server',
    legacyConfigFile: process.env.AUTH_LEGACY_CONFIG_FILE || '',
    webApiBase: process.env.AUTH_API_BASE || `http://localhost:${Number(process.env.AUTH_API_PORT || 3000)}`,
    adminUsername: process.env.AUTH_ADMIN_USERNAME || 'admin',
    adminPassword: process.env.AUTH_ADMIN_PASSWORD || 'abc15497',
    authTokenSecret: process.env.AUTH_TOKEN_SECRET || 'dev-secret-change-in-prod',
    redisEnabled: String(process.env.AUTH_REDIS_ENABLED || 'false').trim().toLowerCase() === 'true',
    redisUrl: process.env.AUTH_REDIS_URL || 'redis://127.0.0.1:6379/0',
    redisQueuePendingKey: process.env.AUTH_REDIS_QUEUE_PENDING_KEY || 'auth:phase3:jobs:pending',
    redisQueueProcessingKey: process.env.AUTH_REDIS_QUEUE_PROCESSING_KEY || 'auth:phase3:jobs:processing',
    redisQueueDeadKey: process.env.AUTH_REDIS_QUEUE_DEAD_KEY || 'auth:phase3:jobs:dead',
    redisBlockingTimeoutSec: Number(process.env.AUTH_REDIS_BLOCKING_TIMEOUT_SEC || 5)
  };
}

module.exports = {
  loadRuntimeConfig
};
