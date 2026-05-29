const os = require('os');
const path = require('path');
const { loadRuntimeConfig } = require('../../../packages/runtime-config');
const { JsonCompatAccountRepository } = require('../../../packages/account-store');
const { FilePhase3JobRepository } = require('../../../packages/job-store');
const { FileArtifactRepository } = require('../../../packages/artifact-store');
const { LegacyPhase3CliExecutor, runPhase3Job } = require('../../../packages/phase3-core');
const { sleep } = require('../../../packages/shared-utils');

const config = loadRuntimeConfig(path.resolve(__dirname, '../../..'));
const accountRepository = new JsonCompatAccountRepository(config);
const jobRepository = new FilePhase3JobRepository(config);
const artifactRepository = new FileArtifactRepository(config);
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
  const job = jobRepository.reserveNextQueuedJob(workerId);
  if (!job) {
    return false;
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
  }
  return true;
}

async function main() {
  console.log(`[auth-worker] started as ${workerId}`);
  while (true) {
    try {
      const processed = await processNextJob();
      if (!processed) {
        await sleep(config.workerPollMs);
      }
    } catch (error) {
      logWorkerFatal('loop error', error);
      await sleep(config.workerPollMs);
    }
  }
}

main().catch((error) => {
  logWorkerFatal('main crashed', error);
  process.exitCode = 1;
});