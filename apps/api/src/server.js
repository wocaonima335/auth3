const fs = require('fs');
const path = require('path');
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

function summarizeAccount(account) {
  if (!account) {
    return null;
  }
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    birthDate: account.birthDate,
    phone: account.phone,
    phoneCountryCode: account.phoneCountryCode,
    phoneCountryDialCode: account.phoneCountryDialCode,
    phoneCountryName: account.phoneCountryName,
    heroSmsCountry: account.heroSmsCountry,
    status: account.status,
    externalEmailProvider: account.externalEmailProvider,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastTokenAt: account.lastTokenAt,
    lastTokenFile: account.lastTokenFile,
    lastFailureReason: account.lastFailureReason
  };
}

function getRequestedUser(req) {
  return String(req.headers['x-auth-user'] || config.defaultUser || 'local-admin').trim();
}

function listJobsResponse() {
  return jobRepository.listJobs({ limit: 50 }).map((job) => ({
    id: job.id,
    email: job.email,
    status: job.status,
    currentStep: job.currentStep,
    triggeredBy: job.triggeredBy,
    failureReason: job.failureReason,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt
  }));
}

async function handleApiRequest(req, res, requestUrl) {
  const pathname = requestUrl.pathname;

  if (req.method === 'GET' && pathname === '/healthz') {
    sendJson(res, 200, {
      status: 'ok',
      runtimeMode: config.runtimeMode
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/v1/phase3/jobs') {
    sendJson(res, 200, {
      items: listJobsResponse()
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/v1/phase3/jobs') {
    const body = await parseJsonBody(req);
    const email = String(body.email || '').trim();
    if (!email) {
      sendJson(res, 400, {
        error: 'EMAIL_REQUIRED',
        message: 'email 不能为空'
      });
      return;
    }

    accountRepository.syncFromSource();
    const account = accountRepository.getByEmail(email);
    if (!account) {
      sendJson(res, 404, {
        error: 'ACCOUNT_NOT_FOUND',
        message: `未找到账号: ${email}`
      });
      return;
    }

    const running = jobRepository.findRunningByEmail(email);
    if (running) {
      sendJson(res, 409, {
        error: 'JOB_ALREADY_RUNNING',
        message: `该邮箱已有运行中任务: ${running.id}`,
        job: running
      });
      return;
    }

    const created = jobRepository.createJob({
      email,
      triggeredBy: getRequestedUser(req)
    });

    sendJson(res, 201, {
      jobId: created.id,
      status: created.status,
      job: created
    });
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/v1/accounts/')) {
    const email = decodeURIComponent(pathname.replace('/api/v1/accounts/', ''));
    accountRepository.syncFromSource();
    const account = accountRepository.getByEmail(email);
    const running = jobRepository.findRunningByEmail(email);
    if (!account) {
      sendJson(res, 404, {
        exists: false,
        email
      });
      return;
    }
    sendJson(res, 200, {
      exists: true,
      account: summarizeAccount(account),
      runningJob: running
    });
    return;
  }

  const jobDetailMatch = pathname.match(/^\/api\/v1\/phase3\/jobs\/([^/]+)$/);
  if (req.method === 'GET' && jobDetailMatch) {
    const jobId = decodeURIComponent(jobDetailMatch[1]);
    const job = jobRepository.getJob(jobId);
    if (!job) {
      sendJson(res, 404, {
        error: 'JOB_NOT_FOUND'
      });
      return;
    }
    sendJson(res, 200, {
      job,
      artifacts: artifactRepository.list(jobId)
    });
    return;
  }

  const jobEventMatch = pathname.match(/^\/api\/v1\/phase3\/jobs\/([^/]+)\/events$/);
  if (req.method === 'GET' && jobEventMatch) {
    const jobId = decodeURIComponent(jobEventMatch[1]);
    sendJson(res, 200, {
      items: jobRepository.listEvents(jobId)
    });
    return;
  }

  const retryMatch = pathname.match(/^\/api\/v1\/phase3\/jobs\/([^/]+)\/retry$/);
  if (req.method === 'POST' && retryMatch) {
    const jobId = decodeURIComponent(retryMatch[1]);
    const current = jobRepository.getJob(jobId);
    if (!current) {
      sendJson(res, 404, {
        error: 'JOB_NOT_FOUND'
      });
      return;
    }
    const retryJob = jobRepository.createRetryJob(jobId, getRequestedUser(req));
    sendJson(res, 201, {
      jobId: retryJob.id,
      status: retryJob.status,
      retryOf: jobId,
      job: retryJob
    });
    return;
  }

  const tokenMatch = pathname.match(/^\/api\/v1\/phase3\/jobs\/([^/]+)\/token$/);
  if (req.method === 'GET' && tokenMatch) {
    const jobId = decodeURIComponent(tokenMatch[1]);
    const artifacts = artifactRepository.list(jobId);
    const tokenArtifact = artifacts.find((item) => item.artifactType === 'token');
    if (!tokenArtifact || !fileExists(tokenArtifact.filePath)) {
      sendJson(res, 404, {
        error: 'TOKEN_ARTIFACT_NOT_FOUND'
      });
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

  sendJson(res, 404, {
    error: 'NOT_FOUND',
    path: pathname
  });
}

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || `localhost:${config.apiPort}`}`);
    await handleApiRequest(req, res, requestUrl);
  } catch (error) {
    sendJson(res, 500, {
      error: 'INTERNAL_SERVER_ERROR',
      message: error.message
    });
  }
});

accountRepository.syncFromSource();

server.listen(config.apiPort, () => {
  console.log(`[auth-api] listening on http://localhost:${config.apiPort}`);
});
