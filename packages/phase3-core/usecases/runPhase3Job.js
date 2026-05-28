const { ACCOUNT_STATUS, JOB_STATUS } = require('../../shared-types');
const { formatError } = require('../../shared-utils');

async function runPhase3Job(options = {}) {
  const {
    job,
    accountRepository,
    artifactRepository,
    jobRepository,
    executor
  } = options;

  const email = String(job?.email || '').trim();
  if (!email) {
    throw new Error('job.email 不能为空');
  }

  const emit = (level, message, payload = null) => {
    jobRepository.appendEvent(job.id, {
      level,
      message,
      payload
    });
  };

  try {
    jobRepository.markStep(job.id, JOB_STATUS.VALIDATING, '开始校验账号上下文');
    accountRepository.syncFromSource();
    const account = accountRepository.getByEmail(email);
    if (!account) {
      throw new Error(`账号不存在: ${email}`);
    }
    if (!String(account.password || '').trim()) {
      throw new Error(`账号缺少密码，无法执行 Phase3: ${email}`);
    }

    emit('info', `账号状态: ${account.status || '(empty)'}`);
    jobRepository.markStep(job.id, JOB_STATUS.STARTING_BROWSER, '开始执行 legacy Phase3 兼容链路');
    const result = await executor.run({
      email,
      onEvent: (event) => emit(event.level || 'info', event.message || '', event.payload || null)
    });

    jobRepository.markStep(job.id, JOB_STATUS.PERSISTING_ARTIFACTS, '开始保存 token 产物');
    const artifact = artifactRepository.saveTokenFromSource(job.id, email, result.tokenSourcePath);
    accountRepository.noteLatestToken(email, artifact.filePath, {
      status: ACCOUNT_STATUS.OAUTH_DONE
    });

    return jobRepository.markSucceeded(job.id, {
      artifacts: [artifact],
      failureReason: ''
    });
  } catch (error) {
    accountRepository.updateStatus(email, ACCOUNT_STATUS.OAUTH_PHASE3_FAILED, {
      lastFailureReason: formatError(error)
    });
    return jobRepository.markFailed(job.id, error);
  }
}

module.exports = {
  runPhase3Job
};
