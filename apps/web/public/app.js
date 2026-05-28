const apiBaseInput = document.getElementById('apiBase');
const saveApiBaseButton = document.getElementById('saveApiBase');
const createForm = document.getElementById('createForm');
const emailInput = document.getElementById('emailInput');
const accountResult = document.getElementById('accountResult');
const jobsList = document.getElementById('jobsList');
const refreshJobsButton = document.getElementById('refreshJobs');
const jobDetail = document.getElementById('jobDetail');
const clearDetailButton = document.getElementById('clearDetail');

function getApiBase() {
  return localStorage.getItem('auth.apiBase') || apiBaseInput.value.trim() || 'http://localhost:3000';
}

function setApiBase(value) {
  localStorage.setItem('auth.apiBase', value);
  apiBaseInput.value = value;
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-User': 'local-admin',
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function renderAccount(account) {
  if (!account?.exists) {
    accountResult.innerHTML = `<div class="card">未找到该邮箱的账号上下文。</div>`;
    return;
  }
  const item = account.account;
  accountResult.innerHTML = `
    <div class="card">
      <div class="status">${item.status || 'unknown'}</div>
      <h3>${item.email}</h3>
      <div class="meta">
        <div>姓名：${item.name || '(empty)'}</div>
        <div>手机号：${item.phone || '(empty)'}</div>
        <div>最近 token：${item.lastTokenAt || '(none)'}</div>
        <div>最近失败：${item.lastFailureReason || '(none)'}</div>
      </div>
      ${account.runningJob ? `<p class="meta">运行中任务：${account.runningJob.id}</p>` : ''}
    </div>
  `;
}

function renderJobs(items = []) {
  if (!items.length) {
    jobsList.innerHTML = `<div class="card">暂无任务</div>`;
    return;
  }
  jobsList.innerHTML = items.map((job) => `
    <div class="card">
      <div class="status">${job.status}</div>
      <h3>${job.email}</h3>
      <div class="meta">
        <div>任务ID：${job.id}</div>
        <div>发起人：${job.triggeredBy}</div>
        <div>创建时间：${job.createdAt}</div>
        <div>完成时间：${job.finishedAt || '(running)'}</div>
      </div>
      <div class="actions">
        <button data-job-id="${job.id}" data-action="detail">查看详情</button>
        ${job.status === 'failed' ? `<button class="secondary" data-job-id="${job.id}" data-action="retry">重试</button>` : ''}
      </div>
    </div>
  `).join('');
}

function renderDetail(job, events = [], artifacts = []) {
  const tokenArtifact = artifacts.find((item) => item.artifactType === 'token');
  jobDetail.innerHTML = `
    <div class="card">
      <div class="status">${job.status}</div>
      <h3>${job.email}</h3>
      <div class="meta">
        <div>任务ID：${job.id}</div>
        <div>当前阶段：${job.currentStep}</div>
        <div>失败原因：${job.failureReason || '(none)'}</div>
      </div>
      <div class="actions">
        ${tokenArtifact ? `<a href="${getApiBase()}/api/v1/phase3/jobs/${job.id}/token" target="_blank"><button type="button">下载 token</button></a>` : ''}
        ${job.status === 'failed' ? `<button id="retryCurrentJob" data-job-id="${job.id}">重试当前任务</button>` : ''}
      </div>
      <ol class="events">
        ${events.map((event) => `<li><strong>[${event.level}]</strong> ${event.message}<br><span class="meta">${event.createdAt}</span></li>`).join('')}
      </ol>
    </div>
  `;
  const retryCurrentJob = document.getElementById('retryCurrentJob');
  if (retryCurrentJob) {
    retryCurrentJob.addEventListener('click', async () => {
      await retryJob(job.id);
    });
  }
}

async function refreshJobs() {
  const result = await requestJson('/api/v1/phase3/jobs');
  renderJobs(result.items || []);
}

async function fetchAccount(email) {
  const result = await requestJson(`/api/v1/accounts/${encodeURIComponent(email)}`);
  renderAccount(result);
  return result;
}

async function fetchJobDetail(jobId) {
  const [detail, events] = await Promise.all([
    requestJson(`/api/v1/phase3/jobs/${encodeURIComponent(jobId)}`),
    requestJson(`/api/v1/phase3/jobs/${encodeURIComponent(jobId)}/events`)
  ]);
  renderDetail(detail.job, events.items || [], detail.artifacts || []);
}

async function createJob(email) {
  const result = await requestJson('/api/v1/phase3/jobs', {
    method: 'POST',
    body: JSON.stringify({ email })
  });
  await refreshJobs();
  await fetchJobDetail(result.jobId);
}

async function retryJob(jobId) {
  const result = await requestJson(`/api/v1/phase3/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST'
  });
  await refreshJobs();
  await fetchJobDetail(result.jobId);
}

saveApiBaseButton.addEventListener('click', () => {
  setApiBase(apiBaseInput.value.trim());
});

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  if (!email) {
    return;
  }
  try {
    const account = await fetchAccount(email);
    if (!account.exists) {
      return;
    }
    await createJob(email);
  } catch (error) {
    accountResult.innerHTML = `<div class="card">创建任务失败：${error.message}</div>`;
  }
});

refreshJobsButton.addEventListener('click', () => {
  refreshJobs().catch((error) => {
    jobsList.innerHTML = `<div class="card">刷新失败：${error.message}</div>`;
  });
});

clearDetailButton.addEventListener('click', () => {
  jobDetail.textContent = '尚未选择任务';
});

jobsList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-job-id]');
  if (!button) {
    return;
  }
  const jobId = button.getAttribute('data-job-id');
  const action = button.getAttribute('data-action');
  if (action === 'detail') {
    await fetchJobDetail(jobId);
    return;
  }
  if (action === 'retry') {
    await retryJob(jobId);
  }
});

setApiBase(getApiBase());
refreshJobs().catch((error) => {
  jobsList.innerHTML = `<div class="card">加载任务失败：${error.message}</div>`;
});
