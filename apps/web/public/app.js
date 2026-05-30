/* ── State ── */
const state = {
  apiBase: localStorage.getItem('auth.apiBase') || '',
  jobs: [],
  selectedJobId: null,
  pollTimer: null,
  detailPollTimer: null
};

/* ── DOM refs ── */
const $ = (id) => document.getElementById(id);
const apiBaseInput = $('apiBase');
const saveApiBaseBtn = $('saveApiBase');
const apiToggle = $('apiToggle');
const apiPopup = $('apiPopup');
const workerStatus = $('workerStatus');
const sessionInfo = $('sessionInfo');
const openAdminModalBtn = $('openAdminModalBtn');
const logoutBtn = $('logoutBtn');
const jobsList = $('jobsList');
const jobsTitle = $('jobsTitle');
const createJobBtn = $('createJobBtn');
const emptyState = $('emptyState');
const jobDetail = $('jobDetail');
const detailStatus = $('detailStatus');
const detailEmail = $('detailEmail');
const detailMeta = $('detailMeta');
const detailActions = $('detailActions');
const logBody = $('logBody');
const autoScrollCb = $('autoScroll');
const createModal = $('createModal');
const closeModal = $('closeModal');
const cancelModal = $('cancelModal');
const createForm = $('createForm');
const emailInput = $('emailInput');
const accountPreview = $('accountPreview');
const adminModal = $('adminModal');
const closeAdminModalBtn = $('closeAdminModal');
const cancelAdminBtn = $('cancelAdmin');
const adminLoginForm = $('adminLoginForm');
const adminUsernameInput = $('adminUsername');
const adminPasswordInput = $('adminPassword');

/* ── Session helpers ── */
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

function getCurrentRole() {
  return getSession()?.role || 'anonymous';
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

/* ── Helpers ── */
function getApiBase() {
  if (state.apiBase) {
    return state.apiBase;
  }
  return `http://${window.location.hostname}:3000`;
}

function setApiBase(value) {
  state.apiBase = value;
  localStorage.setItem('auth.apiBase', value);
  apiBaseInput.value = value;
}

async function api(path, opts = {}) {
  const response = await fetch(`${getApiBase()}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
      ...(opts.headers || {})
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

function isRunning(status) {
  return [
    'queued',
    'validating',
    'starting_browser',
    'authorizing',
    'waiting_email_code',
    'exchanging_token',
    'persisting_artifacts'
  ].includes(status);
}

function canRetry(job) {
  return getCurrentRole() === 'admin' && ['failed', 'canceled'].includes(job.status);
}

function statusClass(status) {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed') return 'failed';
  if (status === 'canceled') return 'canceled';
  if (isRunning(status)) return 'running';
  return 'queued';
}

function dotClass(status) {
  if (isRunning(status)) return 'running';
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed') return 'failed';
  if (status === 'canceled') return 'canceled';
  return 'queued';
}

function timeAgo(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const seconds = Math.floor((Date.now() - date) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return date.toLocaleDateString();
}

function shortTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function escHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function openCreateModal() {
  createModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  emailInput.focus();
}

function closeCreateModal() {
  createModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  emailInput.value = '';
  accountPreview.classList.add('hidden');
}

function openAdminModal() {
  adminModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  adminUsernameInput.focus();
}

function closeAdminModal() {
  adminModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

function renderSession() {
  const session = getSession();
  if (!session) {
    sessionInfo.textContent = '匿名访客：提交邮箱后自动锁定到该邮箱任务';
    jobsTitle.textContent = '当前范围任务';
    openAdminModalBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    return;
  }

  if (session.role === 'admin') {
    sessionInfo.textContent = `管理员 ${session.username || 'admin'}：可查看全部账号任务`;
    jobsTitle.textContent = '全部任务';
    openAdminModalBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
    return;
  }

  sessionInfo.textContent = `邮箱访客 ${session.email}：仅可查看该邮箱任务`;
  jobsTitle.textContent = `${session.email} 的任务`;
  openAdminModalBtn.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');
}

/* ── Render: Job List ── */
function renderJobList() {
  if (!state.jobs.length) {
    jobsList.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">暂无任务</div>';
    return;
  }

  jobsList.innerHTML = state.jobs.map((job) => `
    <div class="job-item ${job.id === state.selectedJobId ? 'active' : ''}" data-job-id="${job.id}">
      <div class="job-item-email">${escHtml(job.email)}</div>
      <div class="job-item-meta">
        <span class="job-dot ${dotClass(job.status)}"></span>
        <span class="job-item-status">${job.status}</span>
        <span class="job-item-time">${timeAgo(job.createdAt)}</span>
      </div>
    </div>
  `).join('');
}

function renderAccountPreview(account) {
  if (!account?.exists) {
    accountPreview.innerHTML = '<span class="err">✗ 未找到该账号</span>';
    accountPreview.classList.remove('hidden');
    return;
  }

  const item = account.account;
  accountPreview.innerHTML = `
    <span class="ok">✓ 账号存在</span><br>
    姓名: ${escHtml(item.name || '(空)')} | 手机: ${escHtml(item.phone || '(空)')} | 状态: ${item.status || 'unknown'}
  `;
  accountPreview.classList.remove('hidden');
}

/* ── Render: Detail ── */
function renderDetail(job, events, artifacts) {
  detailStatus.className = `status ${statusClass(job.status)}`;
  detailStatus.textContent = job.status;
  detailEmail.textContent = job.email;

  detailMeta.innerHTML = `
    <span>ID: ${job.id.slice(-12)}</span>
    <span>阶段: ${job.currentStep}</span>
    ${job.finishedAt ? `<span>完成: ${shortTime(job.finishedAt)}</span>` : ''}
    ${job.failureReason ? `<span style="color:var(--error)">原因: ${escHtml(job.failureReason)}</span>` : ''}
  `;

  const tokenArt = artifacts.find((item) => item.artifactType === 'token');
  let actions = '';
  if (tokenArt) {
    actions += `<button class="btn-primary btn-sm" data-action="download" data-job-id="${job.id}" data-email="${job.email}">下载 Token</button>`;
  }
  if (canRetry(job)) {
    actions += `<button class="btn-primary btn-sm" data-action="retry" data-job-id="${job.id}">重试</button>`;
  }
  detailActions.innerHTML = actions;

  logBody.innerHTML = '';
  events.forEach((event, index) => {
    const line = document.createElement('div');
    line.className = 'log-line' + (index === events.length - 1 ? ' log-new' : '');
    const message = escHtml(event.message).replace(/(token|succeeded|成功)/gi, '<span class="highlight">$1</span>');
    line.innerHTML = `
      <span class="log-time">${shortTime(event.createdAt)}</span>
      <span class="log-level ${event.level}">${event.level}</span>
      <span class="log-msg">${message}</span>
    `;
    logBody.appendChild(line);
  });

  if (autoScrollCb.checked && events.length > 0) {
    logBody.scrollTop = logBody.scrollHeight;
  }
}

function clearDetail() {
  state.selectedJobId = null;
  jobDetail.classList.add('hidden');
  emptyState.classList.remove('hidden');
  logBody.innerHTML = '';
  detailActions.innerHTML = '';
  renderJobList();
  stopDetailPoll();
}

/* ── Data Fetching ── */
async function fetchJobs() {
  try {
    const result = await api('/api/v1/phase3/jobs');
    state.jobs = result.items || [];
    renderJobList();
    workerStatus.textContent = 'live';
    workerStatus.className = 'badge live';
  } catch (error) {
    state.jobs = [];
    renderJobList();
    workerStatus.textContent = 'offline';
    workerStatus.className = 'badge offline';
  }
}

async function fetchDetail(jobId) {
  try {
    const [detail, events] = await Promise.all([
      api(`/api/v1/phase3/jobs/${encodeURIComponent(jobId)}`),
      api(`/api/v1/phase3/jobs/${encodeURIComponent(jobId)}/events`)
    ]);
    renderDetail(detail.job, events.items || [], detail.artifacts || []);

    if (isRunning(detail.job.status)) {
      startDetailPoll(jobId);
    } else {
      stopDetailPoll();
    }
  } catch (error) {
    console.error('fetchDetail error', error);
  }
}

async function fetchAccount(email) {
  const result = await api(`/api/v1/accounts/${encodeURIComponent(email)}`);
  renderAccountPreview(result);
  return result;
}

/* ── Polling ── */
function startGlobalPoll() {
  stopGlobalPoll();
  state.pollTimer = setInterval(fetchJobs, 4000);
}

function stopGlobalPoll() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function startDetailPoll(jobId) {
  stopDetailPoll();
  state.detailPollTimer = setInterval(() => fetchDetail(jobId), 2000);
}

function stopDetailPoll() {
  if (state.detailPollTimer) {
    clearInterval(state.detailPollTimer);
    state.detailPollTimer = null;
  }
}

/* ── Actions ── */
async function selectJob(jobId) {
  state.selectedJobId = jobId;
  emptyState.classList.add('hidden');
  jobDetail.classList.remove('hidden');
  renderJobList();
  await fetchDetail(jobId);
}

async function retryJob(jobId) {
  try {
    const result = await api(`/api/v1/phase3/jobs/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST'
    });
    await fetchJobs();
    await selectJob(result.jobId);
  } catch (error) {
    alert(`重试失败: ${error.message}`);
  }
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
  const result = await api('/api/v1/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });

  setSession({
    role: result.scope?.role || 'admin',
    username: result.scope?.username || username,
    token: result.token
  });

  renderSession();
  closeAdminModal();
  await fetchJobs();
}

async function createAndStartJob(email) {
  try {
    const result = await api('/api/v1/phase3/jobs', {
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

    closeCreateModal();
    await fetchJobs();
    await selectJob(result.jobId);
  } catch (error) {
    if (error.status === 409 && error.payload?.token) {
      setSession({
        role: error.payload.scope?.role || 'guest',
        email: error.payload.scope?.email || email,
        token: error.payload.token
      });
      renderSession();
      closeCreateModal();
      await fetchJobs();
      if (error.payload?.job?.id) {
        await selectJob(error.payload.job.id);
      }
      return;
    }
    alert(`创建失败: ${error.message}`);
  }
}

/* ── Event Bindings ── */
apiToggle.addEventListener('click', () => {
  apiPopup.classList.toggle('hidden');
  apiBaseInput.value = state.apiBase;
});

saveApiBaseBtn.addEventListener('click', () => {
  setApiBase(apiBaseInput.value.trim());
  apiPopup.classList.add('hidden');
  fetchJobs();
});

openAdminModalBtn.addEventListener('click', () => {
  openAdminModal();
});

closeAdminModalBtn.addEventListener('click', () => {
  closeAdminModal();
});

if (cancelAdminBtn) {
  cancelAdminBtn.addEventListener('click', () => {
    closeAdminModal();
  });
}

adminModal.addEventListener('click', (event) => {
  if (event.target === adminModal) {
    closeAdminModal();
  }
});

logoutBtn.addEventListener('click', () => {
  clearSession();
  renderSession();
  clearDetail();
  fetchJobs();
});

createJobBtn.addEventListener('click', () => {
  openCreateModal();
});

closeModal.addEventListener('click', closeCreateModal);
cancelModal.addEventListener('click', closeCreateModal);

let previewTimer = null;
emailInput.addEventListener('input', () => {
  clearTimeout(previewTimer);
  const email = emailInput.value.trim();
  if (!email) {
    accountPreview.classList.add('hidden');
    return;
  }

  if (getCurrentRole() === 'anonymous') {
    accountPreview.innerHTML = '提交后会自动校验该邮箱是否存在，并切换到当前邮箱访客视角。';
    accountPreview.classList.remove('hidden');
    return;
  }

  previewTimer = setTimeout(async () => {
    try {
      await fetchAccount(email);
    } catch (error) {
      accountPreview.innerHTML = '<span class="err">查询失败</span>';
      accountPreview.classList.remove('hidden');
    }
  }, 400);
});

createForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const email = emailInput.value.trim();
  if (email) {
    createAndStartJob(email);
  }
});

adminLoginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await adminLogin(adminUsernameInput.value.trim(), adminPasswordInput.value);
  } catch (error) {
    alert(`管理员登录失败: ${error.message}`);
  }
});

jobsList.addEventListener('click', (event) => {
  const item = event.target.closest('.job-item');
  if (item) {
    selectJob(item.dataset.jobId);
  }
});

detailActions.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }

  const action = button.dataset.action;
  const jobId = button.dataset.jobId;
  if (action === 'retry') {
    await retryJob(jobId);
    return;
  }
  if (action === 'download') {
    await downloadToken(jobId, button.dataset.email || 'token');
  }
});

autoScrollCb.addEventListener('change', () => {
  if (autoScrollCb.checked) {
    logBody.scrollTop = logBody.scrollHeight;
  }
});

createModal.addEventListener('click', (event) => {
  if (event.target === createModal) {
    closeCreateModal();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!createModal.classList.contains('hidden')) {
      closeCreateModal();
    }
    if (!adminModal.classList.contains('hidden')) {
      closeAdminModal();
    }
  }
});

/* ── Init ── */
setApiBase(state.apiBase || getApiBase());
renderSession();
fetchJobs();
startGlobalPoll();
