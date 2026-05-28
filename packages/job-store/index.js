const fs = require('fs');
const path = require('path');
const { JOB_STATUS, isRunningStatus } = require('../shared-types');
const { createId, ensureDir, nowIso, readJsonFile, writeJsonFile, fileExists, formatError } = require('../shared-utils');

class FilePhase3JobRepository {
  constructor(config) {
    this.config = config;
    this.jobsDir = config.jobsDir;
    this.eventsDir = config.eventsDir;
    ensureDir(this.jobsDir);
    ensureDir(this.eventsDir);
  }

  getJobFile(jobId) {
    return path.join(this.jobsDir, `${jobId}.json`);
  }

  getEventFile(jobId) {
    return path.join(this.eventsDir, `${jobId}.json`);
  }

  listJobs(options = {}) {
    const files = fs.readdirSync(this.jobsDir)
      .filter((file) => file.endsWith('.json'));
    const jobs = files
      .map((file) => readJsonFile(path.join(this.jobsDir, file), null))
      .filter(Boolean)
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
    if (options.limit) {
      return jobs.slice(0, options.limit);
    }
    return jobs;
  }

  getJob(jobId) {
    return readJsonFile(this.getJobFile(jobId), null);
  }

  createJob({ email, triggeredBy, retryOf = '' }) {
    const id = createId('job');
    const createdAt = nowIso();
    const job = {
      id,
      email: String(email || '').trim(),
      status: JOB_STATUS.QUEUED,
      currentStep: JOB_STATUS.QUEUED,
      triggeredBy: String(triggeredBy || this.config.defaultUser).trim(),
      retryOf,
      failureReason: '',
      workerId: '',
      createdAt,
      startedAt: '',
      finishedAt: '',
      artifacts: []
    };
    writeJsonFile(this.getJobFile(id), job);
    this.appendEvent(id, {
      level: 'info',
      message: `任务已创建: ${job.email}`,
      createdAt
    });
    return job;
  }

  updateJob(jobId, patch = {}) {
    const current = this.getJob(jobId);
    if (!current) {
      return null;
    }
    const next = {
      ...current,
      ...patch
    };
    writeJsonFile(this.getJobFile(jobId), next);
    return next;
  }

  appendEvent(jobId, event = {}) {
    const eventFile = this.getEventFile(jobId);
    const current = readJsonFile(eventFile, []);
    current.push({
      sequence: current.length + 1,
      level: event.level || 'info',
      message: event.message || '',
      payload: event.payload || null,
      createdAt: event.createdAt || nowIso()
    });
    writeJsonFile(eventFile, current);
    return current[current.length - 1];
  }

  listEvents(jobId) {
    return readJsonFile(this.getEventFile(jobId), []);
  }

  findRunningByEmail(email) {
    const normalized = String(email || '').trim().toLowerCase();
    return this.listJobs().find((job) => {
      return String(job.email || '').trim().toLowerCase() === normalized && isRunningStatus(job.status);
    }) || null;
  }

  reserveNextQueuedJob(workerId) {
    const candidates = this.listJobs()
      .filter((job) => job.status === JOB_STATUS.QUEUED)
      .sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')));
    const nextJob = candidates[0] || null;
    if (!nextJob) {
      return null;
    }
    const updated = this.updateJob(nextJob.id, {
      status: JOB_STATUS.VALIDATING,
      currentStep: JOB_STATUS.VALIDATING,
      workerId,
      startedAt: nextJob.startedAt || nowIso()
    });
    this.appendEvent(nextJob.id, {
      level: 'info',
      message: `Worker 已领取任务: ${workerId}`
    });
    return updated;
  }

  markStep(jobId, status, message, payload = null) {
    const updated = this.updateJob(jobId, {
      status,
      currentStep: status
    });
    this.appendEvent(jobId, {
      level: 'info',
      message,
      payload
    });
    return updated;
  }

  markSucceeded(jobId, patch = {}) {
    const updated = this.updateJob(jobId, {
      ...patch,
      status: JOB_STATUS.SUCCEEDED,
      currentStep: JOB_STATUS.SUCCEEDED,
      finishedAt: nowIso()
    });
    this.appendEvent(jobId, {
      level: 'info',
      message: '任务执行成功'
    });
    return updated;
  }

  markFailed(jobId, error, patch = {}) {
    const updated = this.updateJob(jobId, {
      ...patch,
      status: JOB_STATUS.FAILED,
      currentStep: JOB_STATUS.FAILED,
      failureReason: formatError(error),
      finishedAt: nowIso()
    });
    this.appendEvent(jobId, {
      level: 'error',
      message: `任务执行失败: ${formatError(error)}`
    });
    return updated;
  }

  createRetryJob(jobId, triggeredBy) {
    const current = this.getJob(jobId);
    if (!current) {
      return null;
    }
    return this.createJob({
      email: current.email,
      triggeredBy,
      retryOf: current.id
    });
  }
}

module.exports = {
  FilePhase3JobRepository
};
