/* ── State ── */
const state = {
  apiBase: localStorage.getItem('auth.apiBase') || '',
  jobs: [],
  selectedJobId: null,
  lastEventSeq: 0,
  pollTimer: null,
  detailPollTimer: null
};

/* ── DOM refs ── */
const $ = (id) => document.getElementById(id);
const apiBaseInput     = $('apiBase');
const saveApiBaseBtn   = $('saveApiBase');
const apiToggle        = $('apiToggle');
const apiPopup         = $('apiPopup');
const workerStatus     = $('workerStatus');
const jobsList         = $('jobsList');
const createJobBtn     = $('createJobBtn');
const emptyState       = $('emptyState');
const jobDetail        = $('jobDetail');
const detailStatus     = $('detailStatus');
const detailEmail      = $('detailEmail');
const detailMeta       = $('detailMeta');
const detailActions    = $('detailActions');
const logBody          = $('logBody');
const autoScrollCb     = $('autoScroll');
const createModal      = $('createModal');
const closeModal       = $('closeModal');
const cancelModal      = $('cancelModal');
const createForm       = $('createForm');
const emailInput       = $('emailInput');
const accountPreview   = $('accountPreview');
const submitJob        = $('submitJob');

/* ── Helpers ── */
function getApiBase() {
  if (state.apiBase) return state.apiBase;
  return `http://${window.location.hostname}:3080`;
}

function setApiBase(v) {
  state.apiBase = v;
  localStorage.setItem('auth.apiBase', v);
  apiBaseInput.value = v;
}

async function api(path, opts = {}) {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Auth-User': 'local-admin', ...(opts.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return data;
}

function isRunning(s) {
  return ['queued','validating','starting_browser','authorizing','waiting_email_code','exchanging_token','persisting_artifacts'].includes(s);
}

function statusClass(s) {
  if (s === 'succeeded') return 'succeeded';
  if (s === 'failed') return 'failed';
  if (s === 'canceled') return 'canceled';
  if (isRunning(s)) return 'running';
  return 'queued';
}

function dotClass(s) {
  if (isRunning(s)) return 'running';
  if (s === 'succeeded') return 'succeeded';
  if (s === 'failed') return 'failed';
  if (s === 'canceled') return 'canceled';
  return 'queued';
}

function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec/60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec/3600)}h ago`;
  return d.toLocaleDateString();
}

function shortTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/* ── Render: Job List ── */
function renderJobList() {
  if (!state.jobs.length) {
    jobsList.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">暂无任务</div>';
    return;
  }
  jobsList.innerHTML = state.jobs.map(j => `
    <div class="job-item ${j.id === state.selectedJobId ? 'active' : ''}" data-job-id="${j.id}">
      <div class="job-item-email">${escHtml(j.email)}</div>
      <div class="job-item-meta">
        <span class="job-dot ${dotClass(j.status)}"></span>
        <span class="job-item-status">${j.status}</span>
        <span class="job-item-time">${timeAgo(j.createdAt)}</span>
      </div>
    </div>
  `).join('');
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

  // Actions
  const tokenArt = artifacts.find(a => a.artifactType === 'token');
  let acts = '';
  if (tokenArt) {
    acts += `<a href="${getApiBase()}/api/v1/phase3/jobs/${job.id}/token" target="_blank"><button class="btn-primary btn-sm">下载 Token</button></a>`;
  }
  if (isRunning(job.status)) {
    acts += `<button class="btn-danger btn-sm" data-action="cancel" data-job-id="${job.id}">取消任务</button>`;
  }
  if (job.status === 'failed' || job.status === 'canceled') {
    acts += `<button class="btn-primary btn-sm" data-action="retry" data-job-id="${job.id}">重试</button>`;
  }
  detailActions.innerHTML = acts;

  // Log
  const prevCount = logBody.children.length;
  const newEvents = events.slice(prevCount);
  newEvents.forEach((e, i) => {
    const line = document.createElement('div');
    line.className = 'log-line' + (i === newEvents.length - 1 ? ' log-new' : '');
    const msg = escHtml(e.message)
      .replace(/(token|succeeded|成功)/gi, '<span class="highlight">$1</span>');
    line.innerHTML = `
      <span class="log-time">${shortTime(e.createdAt)}</span>
      <span class="log-level ${e.level}">${e.level}</span>
      <span class="log-msg">${msg}</span>
    `;
    logBody.appendChild(line);
  });

  if (autoScrollCb.checked && newEvents.length > 0) {
    logBody.scrollTop = logBody.scrollHeight;
  }
}

function clearDetail() {
  state.selectedJobId = null;
  state.lastEventSeq = 0;
  jobDetail.classList.add('hidden');
  emptyState.classList.remove('hidden');
  logBody.innerHTML = '';
  renderJobList();
}

/* ── Data Fetching ── */
async function fetchJobs() {
  try {
    const result = await api('/api/v1/phase3/jobs');
    state.jobs = result.items || [];
    renderJobList();
    workerStatus.textContent = 'live';
    workerStatus.className = 'badge live';
  } catch {
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

    // If still running, keep polling events
    if (isRunning(detail.job.status)) {
      startDetailPoll(jobId);
    } else {
      stopDetailPoll();
    }
  } catch (e) {
    console.error('fetchDetail error', e);
  }
}

/* ── Polling ── */
function startGlobalPoll() {
  stopGlobalPoll();
  state.pollTimer = setInterval(fetchJobs, 4000);
}

function stopGlobalPoll() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}

function startDetailPoll(jobId) {
  stopDetailPoll();
  state.detailPollTimer = setInterval(() => fetchDetail(jobId), 2000);
}

function stopDetailPoll() {
  if (state.detailPollTimer) { clearInterval(state.detailPollTimer); state.detailPollTimer = null; }
}

/* ── Actions ── */
async function selectJob(jobId) {
  state.selectedJobId = jobId;
  state.lastEventSeq = 0;
  logBody.innerHTML = '';
  emptyState.classList.add('hidden');
  jobDetail.classList.remove('hidden');
  renderJobList();
  await fetchDetail(jobId);
}

async function cancelJob(jobId) {
  try {
    await api(`/api/v1/phase3/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
    await fetchDetail(jobId);
    await fetchJobs();
  } catch (e) {
    alert('取消失败: ' + e.message);
  }
}

async function retryJob(jobId) {
  try {
    const result = await api(`/api/v1/phase3/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' });
    await fetchJobs();
    await selectJob(result.jobId);
  } catch (e) {
    alert('重试失败: ' + e.message);
  }
}

async function createAndStartJob(email) {
  try {
    const result = await api('/api/v1/phase3/jobs', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    closeModalFn();
    await fetchJobs();
    await selectJob(result.jobId);
  } catch (e) {
    alert('创建失败: ' + e.message);
  }
}

function closeModalFn() {
  createModal.classList.add('hidden');
  emailInput.value = '';
  accountPreview.classList.add('hidden');
}

/* ── Event Bindings ── */
// API toggle
apiToggle.addEventListener('click', () => {
  apiPopup.classList.toggle('hidden');
  apiBaseInput.value = state.apiBase;
});

saveApiBaseBtn.addEventListener('click', () => {
  setApiBase(apiBaseInput.value.trim());
  apiPopup.classList.add('hidden');
  fetchJobs();
});

// Create job modal
createJobBtn.addEventListener('click', () => {
  createModal.classList.remove('hidden');
  emailInput.focus();
});

closeModal.addEventListener('click', closeModalFn);
cancelModal.addEventListener('click', closeModalFn);

// Email preview on blur
let previewTimer = null;
emailInput.addEventListener('input', () => {
  clearTimeout(previewTimer);
  const email = emailInput.value.trim();
  if (!email) {
    accountPreview.classList.add('hidden');
    return;
  }
  previewTimer = setTimeout(async () => {
    try {
      const result = await api(`/api/v1/accounts/${encodeURIComponent(email)}`);
      if (result.exists) {
        const a = result.account;
        accountPreview.innerHTML = `
          <span class="ok">✓ 账号存在</span><br>
          姓名: ${escHtml(a.name || '(空)')} | 手机: ${escHtml(a.phone || '(空)')} | 状态: ${a.status || 'unknown'}
        `;
      } else {
        accountPreview.innerHTML = '<span class="err">✗ 未找到该账号</span>';
      }
      accountPreview.classList.remove('hidden');
    } catch {
      accountPreview.innerHTML = '<span class="err">查询失败</span>';
      accountPreview.classList.remove('hidden');
    }
  }, 400);
});

createForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  if (email) createAndStartJob(email);
});

// Job list click
jobsList.addEventListener('click', (e) => {
  const item = e.target.closest('.job-item');
  if (item) selectJob(item.dataset.jobId);
});

// Detail actions (cancel/retry)
detailActions.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const jobId = btn.dataset.jobId;
  if (action === 'cancel') cancelJob(jobId);
  if (action === 'retry') retryJob(jobId);
});

// Auto scroll
autoScrollCb.addEventListener('change', () => {
  if (autoScrollCb.checked) logBody.scrollTop = logBody.scrollHeight;
});

// Close modal on overlay click
createModal.addEventListener('click', (e) => {
  if (e.target === createModal) closeModalFn();
});

/* ── Init ── */
setApiBase(state.apiBase);
fetchJobs();
startGlobalPoll();