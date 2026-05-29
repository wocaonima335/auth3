const apiBaseInput = document.getElementById('apiBase');
const saveApiBaseButton = document.getElementById('saveApiBase');
const adminLoginForm = document.getElementById('adminLoginForm');
const adminUsernameInput = document.getElementById('adminUsername');
const adminPasswordInput = document.getElementById('adminPassword');
const sessionSummary = document.getElementById('sessionSummary');
const logoutButton = document.getElementById('logoutButton');
const createForm = document.getElementById('createForm');
const emailInput = document.getElementById('emailInput');
const accountResult = document.getElementById('accountResult');
const jobsList = document.getElementById('jobsList');
const jobsTitle = document.getElementById('jobsTitle');
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

function getSession() {
  try {
    return JSON.parse(localStorage.getItem('auth.session') || 'null');
  } catch (error) {
    return null;
  }
}

function setSession(session) {
  if (!session) {
    localStorage.removeItem('auth.session');
    return;
  }
  localStorage.setItem('auth.session', JSON.stringify(session));
}

function clearSession() {
  setSession(null);
}

function buildAuthHeaders() {
  const session = getSession();
  if (!session?.token) {
    return {};
  }
  return {
    Authorization: `Bearer ${session.token}`
  };
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function getCurrentRole() {
  return getSession()?.role || 'anonymous';
}

function canRetry(job) {
  return getCurrentRole() === 'admin' && job.status === 'failed';
}

function renderSession() {
  const session = getSession();
  if (!session) {
    sessionSummary.innerHTML = `
      <div class="card">
        <div class="status">anonymous</div>
        <div class="meta">普通用户无需登录。提交邮箱后会自动切换到该邮箱的访客视角。</div>
      </div>
    `;
    jobsTitle.textContent = '当前范围任务';
    return;
  }
  if (session.role === 'admin') {
    sessionSummary.innerHTML = `
      <div class="card">
        <div class="status">admin</div>
        <div class="meta">当前管理员：${session.username || 'admin'}，可查看全部账号任务。</div>
      </div>
    `;
    jobsTitle.textContent = '全部账号任务';
    return;
  }
  sessionSummary.innerHTML = `
    <div class="card">
      <div class="status">guest</div>
      <div class="meta">当前访客范围：${session.email}，仅可查看该邮箱任务。</div>
    </div>
  `;
  jobsTitle.textContent = `邮箱 ${session.email} 的任务`;
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
        ${canRetry(job) ? `<button class="secondary" data-job-id="${job.id}" data-action="retry">重试</button>` : ''}
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
        ${tokenArtifact ? `<button type="button" id="downloadCurrentToken" data-job-id="${job.id}">下载 token</button>` : ''}
        ${canRetry(job) ? `<button id="retryCurrentJob" data-job-id="${job.id}">重试当前任务</button>` : ''}
      </div>
      <ol class="events">
        ${events.map((event) => `<li><strong>[${event.level}]</strong> ${event.message}<br><span class="meta">${event.createdAt}</span></li>`).join('')}
      </ol>
    </div>
  `;
  const retryCurrentJob = document.getElementById('retryCurrentJob');
  const downloadCurrentToken = document.getElementById('downloadCurrentToken');
  if (downloadCurrentToken) {
    downloadCurrentToken.addEventListener('click', async () => {
      await downloadToken(job.id, job.email);
    });
  }
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
  if (result.token && getCurrentRole() !== 'admin') {
    setSession({
      role: result.scope?.role || 'guest',
      email: result.scope?.email || email,
      token: result.token
    });
    renderSession();
  }
  await refreshJobs();
  await fetchAccount(email);
  await fetchJobDetail(result.jobId);
}

async function retryJob(jobId) {
  const result = await requestJson(`/api/v1/phase3/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST'
  });
  await refreshJobs();
  await fetchJobDetail(result.jobId);
}

async function downloadToken(jobId, email) {
  const response = await fetch(`${getApiBase()}/api/v1/phase3/jobs/${encodeURIComponent(jobId)}/token`, {
    headers: {
      ...buildAuthHeaders()
    }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `codex-${email}-free.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

async function adminLogin(username, password) {
  const result = await requestJson('/api/v1/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  setSession({
    role: result.scope?.role || 'admin',
    username: result.scope?.username || username,
    token: result.token
  });
  renderSession();
  await refreshJobs();
  accountResult.innerHTML = `<div class="card">管理员登录成功，可查看全部任务。</div>`;
}

saveApiBaseButton.addEventListener('click', () => {
  setApiBase(apiBaseInput.value.trim());
});

adminLoginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await adminLogin(adminUsernameInput.value.trim(), adminPasswordInput.value);
  } catch (error) {
    sessionSummary.innerHTML = `<div class="card">管理员登录失败：${error.message}</div>`;
  }
});

logoutButton.addEventListener('click', async () => {
  clearSession();
  renderSession();
  accountResult.innerHTML = `<div class="card">已退出当前模式。</div>`;
  jobsList.innerHTML = `<div class="card">请先提交邮箱，或使用管理员登录查看全部任务。</div>`;
  jobDetail.textContent = '尚未选择任务';
});

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  if (!email) {
    return;
  }
  try {
    await createJob(email);
  } catch (error) {
    if (error.status === 409 && error.payload?.token) {
      setSession({
        role: error.payload.scope?.role || 'guest',
        email: error.payload.scope?.email || email,
        token: error.payload.token
      });
      renderSession();
      accountResult.innerHTML = `<div class="card">${error.message}</div>`;
      await refreshJobs();
      if (error.payload?.job?.id) {
        await fetchAccount(email);
        await fetchJobDetail(error.payload.job.id);
      }
      return;
    }
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
renderSession();
if (getSession()) {
  refreshJobs().catch((error) => {
    jobsList.innerHTML = `<div class="card">加载任务失败：${error.message}</div>`;
  });
} else {
  jobsList.innerHTML = `<div class="card">请先提交邮箱，或使用管理员登录查看全部任务。</div>`;
}
