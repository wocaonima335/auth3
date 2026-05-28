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

async function processNextJob() {
  const job = jobRepository.reserveNextQueuedJob(workerId);
  if (!job) {
    return false;
  }

  console.log(`[auth-worker] processing job ${job.id} ${job.email}`);
  await runPhase3Job({
    job,
    accountRepository,
    artifactRepository,
    jobRepository,
    executor
  });
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
      console.error('[auth-worker] loop error:', error.message);
      await sleep(config.workerPollMs);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
