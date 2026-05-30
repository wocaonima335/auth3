const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const http = require('http');
const { loadRuntimeConfig } = require('../../../packages/runtime-config');
const { JsonCompatAccountRepository } = require('../../../packages/account-store');
const { FilePhase3JobRepository } = require('../../../packages/job-store');
const { FileArtifactRepository } = require('../../../packages/artifact-store');
const { parseJsonBody, sendJson, sendText, setCors, fileExists } = require('../../../packages/shared-utils');

const config = loadRuntimeConfig(path.resolve(__dirname, '../../..'));
const accountRepository = new JsonCompatAccountRepository(config);
const jobRepository = new FilePhase3JobRepository(config);
const artifactRepository = new FileArtifactRepository(config);

/* ── Auth helpers ── */
function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function signPayload(payload) {
  return crypto.createHmac('sha256', config.authTokenSecret).update(payload).digest('base64url');
}

function issueAuthToken(payload = {}) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

function verifyAuthToken(token = '') {
  const [encodedPayload, signature] = String(token || '').split('.');
  if (!encodedPayload || !signature) return null;
  if (signature !== signPayload(encodedPayload)) return null;
  try { return JSON.parse(base64UrlDecode(encodedPayload)); } catch { return null; }
}

function buildGuestSession(email) {
  return { role: 'guest', email: String(email || '').trim().toLowerCase() };
}

function buildAdminSession() {
  return { role: 'admin', username: config.adminUsername };
}

function readBearerToken(req) {
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) return authHeader.slice(7).trim();
  return String(req.headers['x-auth-token'] || '').trim();
}

function getAuthContext(req) {
  const payload = verifyAuthToken(readBearerToken(req));
  if (!payload) return { role: 'anonymous', token: '' };
  if (payload.role === 'admin') return { role: 'admin', token: readBearerToken(req), username: payload.username || config.adminUsername };
  if (payload.role === 'guest') return { role: 'guest', token: readBearerToken(req), email: String(payload.email || '').trim().toLowerCase() };
  return { role: 'anonymous', token: '' };
}

function buildAuthResponse(session) {
  const token = issueAuthToken(session);
  return { token, scope: session };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function canAccessEmail(authContext, email) {
  if (authContext.role === 'admin') return true;
  return authContext.role === 'guest' && normalizeEmail(authContext.email) === normalizeEmail(email);
}

function ensureAdmin(res, authContext) {
  if (authContext.role === 'admin') return true;
  sendJson(res, 403, { error: 'ADMIN_REQUIRED', message: '该操作仅管理员可用' });
  return false;
}

/* ── Data helpers ── */
function summarizeAccount(account) {
  if (!account) return null;
  return {
    id: account.id, email: account.email, name: account.name, birthDate: account.birthDate,
    phone: account.phone, phoneCountryCode: account.phoneCountryCode, phoneCountryDialCode: account.phoneCountryDialCode,
    phoneCountryName: account.phoneCountryName, heroSmsCountry: account.heroSmsCountry, status: account.status,
    externalEmailProvider: account.externalEmailProvider, createdAt: account.createdAt, updatedAt: account.updatedAt,
    lastTokenAt: account.lastTokenAt, lastTokenFile: account.lastTokenFile, lastFailureReason: account.lastFailureReason
  };
}

function summarizeJob(job) {
  return {
    id: job.id, email: job.email, status: job.status, currentStep: job.currentStep,
    triggeredBy: job.triggeredBy, failureReason: job.failureReason,
    createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt
  };
}

function listJobsResponse(authContext) {
  const items = jobRepository.listJobs({ limit: 50 });
  const filtered = authContext.role === 'admin' ? items : items.filter(job => canAccessEmail(authContext, job.email));
  return filtered.map(summarizeJob);
}

function getRequestedUser(req) {
  const authContext = getAuthContext(req);
  if (authContext.role === 'admin') return String(authContext.username || config.adminUsername).trim();
  return String(req.headers['x-auth-user'] || config.defaultUser || 'local-admin').trim();
}

function authorizeJobAccess(res, authContext, job) {
  if (!job) { sendJson(res, 404, { error: 'JOB_NOT_FOUND' }); return false; }
  if (canAccessEmail(authContext, job.email)) return true;
  sendJson(res, 403, { error: 'JOB_ACCESS_DENIED', message: '没有权限查看该任务' });
  return false;
}

/* ── Router ── */
async function handleApiRequest(req, res, requestUrl) {
  const pathname = requestUrl.pathname;
  const authContext = getAuthContext(req);

  // Health
  if (req.method === 'GET' && pathname === '/healthz') {
    sendJson(res, 200, { status: 'ok', runtimeMode: config.runtimeMode });
    return;
  }

  // Admin login
  if (req.method === 'POST' && pathname === '/api/v1/admin/login') {
    const body = await parseJsonBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '').trim();
    if (username !== config.adminUsername || password !== config.adminPassword) {
      sendJson(res, 401, { error: 'INVALID_ADMIN_CREDENTIALS', message: '管理员账号或密码错误' });
      return;
    }
    sendJson(res, 200, { message: '管理员登录成功', ...buildAuthResponse(buildAdminSession()) });
    return;
  }

  // Session info
  if (req.method === 'GET' && pathname === '/api/v1/session') {
    if (authContext.role === 'anonymous') {
      sendJson(res, 200, { authenticated: false, role: 'anonymous' });
    } else {
      sendJson(res, 200, { authenticated: true, role: authContext.role, email: authContext.email || '', username: authContext.username || '' });
    }
    return;
  }

  // List jobs
  if (req.method === 'GET' && pathname === '/api/v1/phase3/jobs') {
    sendJson(res, 200, {
      items: listJobsResponse(authContext),
      scope: { role: authContext.role, email: authContext.email || '', username: authContext.username || '' }
    });
    return;
  }

  // Create job
  if (req.method === 'POST' && pathname === '/api/v1/phase3/jobs') {
    const body = await parseJsonBody(req);
    const email = String(body.email || '').trim();
    if (!email) { sendJson(res, 400, { error: 'EMAIL_REQUIRED', message: 'email 不能为空' }); return; }

    accountRepository.syncFromSource();
    const account = accountRepository.getByEmail(email);
    if (!account) { sendJson(res, 404, { error: 'ACCOUNT_NOT_FOUND', message: `未找到账号: ${email}` }); return; }

    const running = jobRepository.findRunningByEmail(email);
    const viewerResponse = authContext.role === 'admin'
      ? { scope: { role: 'admin', username: authContext.username || config.adminUsername } }
      : buildAuthResponse(buildGuestSession(email));

    if (running) {
      sendJson(res, 409, { error: 'JOB_ALREADY_RUNNING', message: `该邮箱已有运行中任务: ${running.id}`, job: summarizeJob(running), ...viewerResponse });
      return;
    }

    const created = jobRepository.createJob({
      email,
      triggeredBy: authContext.role === 'admin' ? String(authContext.username || config.adminUsername).trim() : `guest:${email}`
    });

    sendJson(res, 201, { jobId: created.id, status: created.status, job: summarizeJob(created), ...viewerResponse });
    return;
  }

  // Account info
  if (req.method === 'GET' && pathname.startsWith('/api/v1/accounts/')) {
    const email = decodeURIComponent(pathname.replace('/api/v1/accounts/', ''));
    if (!canAccessEmail(authContext, email)) { sendJson(res, 403, { error: 'ACCOUNT_ACCESS_DENIED', message: '没有权限查看该邮箱账号' }); return; }
    accountRepository.syncFromSource();
    const account = accountRepository.getByEmail(email);
    const running = jobRepository.findRunningByEmail(email);
    if (!account) { sendJson(res, 404, { exists: false, email }); return; }
    sendJson(res, 200, { exists: true, account: summarizeAccount(account), runningJob: running ? summarizeJob(running) : null });
    return;
  }

  // Job detail
  const jobDetailMatch = pathname.match(/^\/api\/v1\/phase3\/jobs\/([^/]+)$/);
  if (req.method === 'GET' && jobDetailMatch) {
    const jobId = decodeURIComponent(jobDetailMatch[1]);
    const job = jobRepository.getJob(jobId);
    if (!authorizeJobAccess(res, authContext, job)) return;
    sendJson(res, 200, { job: summarizeJob(job), artifacts: artifactRepository.list(jobId) });
    return;
  }

  // Job events
  const jobEventMatch = pathname.match(/^\/api\/v1\/phase3\/jobs\/([^/]+)\/events$/);
  if (req.method === 'GET' && jobEventMatch) {
    const jobId = decodeURIComponent(jobEventMatch[1]);
    const job = jobRepository.getJob(jobId);
    if (!authorizeJobAccess(res, authContext, job)) return;
    sendJson(res, 200, { items: jobRepository.listEvents(jobId) });
    return;
  }

  // Retry job (admin only)
  const retryMatch = pathname.match(/^\/api\/v1\/phase3\/jobs\/([^/]+)\/retry$/);
  if (req.method === 'POST' && retryMatch) {
    if (!ensureAdmin(res, authContext)) return;
    const jobId = decodeURIComponent(retryMatch[1]);
    const current = jobRepository.getJob(jobId);
    if (!current) { sendJson(res, 404, { error: 'JOB_NOT_FOUND' }); return; }
    const retryJob = jobRepository.createRetryJob(jobId, getRequestedUser(req));
    sendJson(res, 201, { jobId: retryJob.id, status: retryJob.status, retryOf: jobId, job: summarizeJob(retryJob) });
    return;
  }

  // Cancel job
  const cancelMatch = pathname.match(/^\/api\/v1\/phase3\/jobs\/([^/]+)\/cancel$/);
  if (req.method === 'POST' && cancelMatch) {
    const jobId = decodeURIComponent(cancelMatch[1]);
    const current = jobRepository.getJob(jobId);
    if (!current) { sendJson(res, 404, { error: 'JOB_NOT_FOUND' }); return; }
    const terminalStatuses = ['succeeded', 'failed', 'canceled'];
    if (terminalStatuses.includes(current.status)) {
      sendJson(res, 409, { error: 'JOB_ALREADY_FINISHED', message: `任务状态为 ${current.status}，无法取消`, job: current });
      return;
    }
    const canceled = jobRepository.markCanceled(jobId);
    sendJson(res, 200, { jobId: canceled.id, status: canceled.status, job: canceled });
    return;
  }

  // Token download
  const tokenMatch = pathname.match(/^\/api\/v1\/phase3\/jobs\/([^/]+)\/token$/);
  if (req.method === 'GET' && tokenMatch) {
    const jobId = decodeURIComponent(tokenMatch[1]);
    const job = jobRepository.getJob(jobId);
    if (!authorizeJobAccess(res, authContext, job)) return;
    const artifacts = artifactRepository.list(jobId);
    const tokenArtifact = artifacts.find(item => item.artifactType === 'token');
    if (!tokenArtifact || !fileExists(tokenArtifact.filePath)) {
      sendJson(res, 404, { error: 'TOKEN_ARTIFACT_NOT_FOUND' });
      return;
    }
    const body = fs.readFileSync(tokenArtifact.filePath);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
      'Content-Disposition': `attachment; filename="${tokenArtifact.fileName}"`,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(body);
    return;
  }

  sendJson(res, 404, { error: 'NOT_FOUND', path: pathname });
}

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || `localhost:${config.apiPort}`}`);
    await handleApiRequest(req, res, requestUrl);
  } catch (error) {
    sendJson(res, 500, { error: 'INTERNAL_SERVER_ERROR', message: error.message });
  }
});

accountRepository.syncFromSource();

server.listen(config.apiPort, '0.0.0.0', () => {
  console.log(`[auth-api] listening on http://0.0.0.0:${config.apiPort}`);
});
