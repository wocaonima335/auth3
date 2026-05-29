const { ACCOUNT_STATUS, JOB_STATUS } = require('../../shared-types');
const { formatError } = require('../../shared-utils');

class CanceledError extends Error {
  constructor(message = '任务已被用户取消') {
    super(message);
    this.name = 'CanceledError';
  }
}

async function runPhase3Job(options = {}) {
  const {
    job,
    accountRepository,
    artifactRepository,
    jobRepository,
    executor,
    isCanceled = () => false
  } = options;

  const email = String(job?.email || '').trim();
  if (!email) {
    throw new Error('job.email 不能为空');
  }

  const emit = (level, message, payload = null) => {
    try {
      jobRepository.appendEvent(job.id, {
        level,
        message,
        payload
      });
    } catch (error) {
      console.error(`[runPhase3Job] appendEvent failed for ${job.id}: ${error.message}`);
    }
  };

  try {
    if (isCanceled()) {
      throw new CanceledError();
    }

    jobRepository.markStep(job.id, JOB_STATUS.VALIDATING, '开始校验账号上下文');
    accountRepository.syncFromSource();
    const account = accountRepository.getByEmail(email);
    if (!account) {
      throw new Error(`账号不存在: ${email}`);
    }
    if (!String(account.password || '').trim()) {
      throw new Error(`账号缺少密码，无法执行 Phase3: ${email}`);
    }

    if (isCanceled()) {
      throw new CanceledError();
    }

    emit('info', `账号状态: ${account.status || '(empty)'}`);
    jobRepository.markStep(job.id, JOB_STATUS.STARTING_BROWSER, '开始执行 legacy Phase3 兼容链路');
    const result = await executor.run({
      email,
      onEvent: (event) => emit(event.level || 'info', event.message || '', event.payload || null),
      isCanceled
    });

    if (isCanceled()) {
      throw new CanceledError();
    }

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
    emit('error', `Phase3 执行捕获异常: ${formatError(error)}`, {
      code: error.code || ''
    });

    if (error instanceof CanceledError || error.name === 'CanceledError') {
      emit('warn', '任务被用户取消');
      executor.kill();
      return jobRepository.markCanceled(job.id);
    }

    accountRepository.updateStatus(email, ACCOUNT_STATUS.OAUTH_PHASE3_FAILED, {
      lastFailureReason: formatError(error)
    });
    return jobRepository.markFailed(job.id, error);
  }
}

module.exports = {
  CanceledError,
  runPhase3Job
};