const path = require('path');
const { ensureDir } = require('../shared-utils');

function splitCandidateDirs(rawValue = '') {
  return String(rawValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadRuntimeConfig(repoRoot = path.resolve(__dirname, '..', '..')) {
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
    webApiBase: process.env.AUTH_API_BASE || `http://localhost:${Number(process.env.AUTH_API_PORT || 3000)}`
  };
}

module.exports = {
  loadRuntimeConfig
};
