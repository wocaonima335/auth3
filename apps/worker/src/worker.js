const os = require('os');
const path = require('path');
const { loadRuntimeConfig } = require('../../../packages/runtime-config');
const { JsonCompatAccountRepository } = require('../../../packages/account-store');
const { FilePhase3JobRepository } = require('../../../packages/job-store');
const { FileArtifactRepository } = require('../../../packages/artifact-store');
const { createPhase3Queue } = require('../../../packages/queue-store');
const { LegacyPhase3CliExecutor, runPhase3Job } = require('../../../packages/phase3-core');
const { sleep } = require('../../../packages/shared-utils');

const config = loadRuntimeConfig(path.resolve(__dirname, '../../..'));
const accountRepository = new JsonCompatAccountRepository(config);
const jobRepository = new FilePhase3JobRepository(config);
const artifactRepository = new FileArtifactRepository(config);
const queue = createPhase3Queue(config);
const executor = new LegacyPhase3CliExecutor(config);
const workerId = `worker-${os.hostname()}-${process.pid}`;

function logWorkerFatal(label, error) {
  const message = error instanceof Error
    ? (error.stack || error.message)
    : String(error);
  console.error(`[auth-worker] ${label}: ${message}`);
}

process.on('unhandledRejection', (reason) => {
  logWorkerFatal('unhandledRejection', reason);
});

process.on('uncaughtException', (error) => {
  logWorkerFatal('uncaughtException', error);
});

async function processNextJob() {
  let queuedJob = null;
  if (queue.isEnabled()) {
    queuedJob = await queue.dequeue(workerId);
    if (!queuedJob) {
      return false;
    }
  }

  const job = queue.isEnabled()
    ? jobRepository.getJob(queuedJob.jobId)
    : jobRepository.reserveNextQueuedJob(workerId);

  if (!job) {
    if (queue.isEnabled() && queuedJob?.jobId) {
      await queue.moveToDead(queuedJob.jobId, 'job-file-missing');
      logWorkerFatal('job metadata missing', `jobId=${queuedJob.jobId}`);
      return true;
    }
    return false;
  }

  if (queue.isEnabled() && ['succeeded', 'failed', 'canceled'].includes(job.status)) {
    await queue.ack(job.id);
    return true;
  }

  console.log(`[auth-worker] processing job ${job.id} ${job.email}`);

  // isCanceled: 读取任务文件检查是否已被标记为 canceled
  const isCanceled = () => {
    const current = jobRepository.getJob(job.id);
    return current && current.status === 'canceled';
  };

  try {
    await runPhase3Job({
      job,
      accountRepository,
      artifactRepository,
      jobRepository,
      executor,
      isCanceled
    });
  } catch (error) {
    logWorkerFatal(`job crashed ${job.id}`, error);
    try {
      jobRepository.markFailed(job.id, error);
    } catch (markError) {
      logWorkerFatal(`markFailed crashed ${job.id}`, markError);
    }
  } finally {
    if (queue.isEnabled()) {
      try {
        await queue.ack(job.id);
      } catch (ackError) {
        logWorkerFatal(`queue ack crashed ${job.id}`, ackError);
      }
    }
  }
  return true;
}

async function main() {
  console.log(`[auth-worker] started as ${workerId}`);
  if (queue.isEnabled()) {
    try {
      const recovery = await queue.recoverStaleProcessingJobs({
        classifyJob: async (jobId) => {
          const job = jobRepository.getJob(jobId);
          if (!job) {
            return 'dead';
          }
          if (['succeeded', 'failed', 'canceled'].includes(job.status)) {
            return 'ack';
          }
          jobRepository.appendEvent(jobId, {
            level: 'warn',
            message: '检测到 processing 残留，已重新入队'
          });
          return 'requeue';
        }
      });
      console.log(`[auth-worker] queue recovery acked=${recovery.acked.length} requeued=${recovery.requeued.length} dead=${recovery.dead.length}`);
    } catch (error) {
      logWorkerFatal('queue recovery failed', error);
    }
  }
  while (true) {
    try {
      const processed = await processNextJob();
      if (!processed && !queue.isEnabled()) {
        await sleep(config.workerPollMs);
      }
    } catch (error) {
      logWorkerFatal('loop error', error);
      if (!queue.isEnabled()) {
        await sleep(config.workerPollMs);
      }
    }
  }
}

main().catch((error) => {
  logWorkerFatal('main crashed', error);
  process.exitCode = 1;
});
