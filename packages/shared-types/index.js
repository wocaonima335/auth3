const JOB_STATUS = Object.freeze({
  QUEUED: 'queued',
  VALIDATING: 'validating',
  STARTING_BROWSER: 'starting_browser',
  AUTHORIZING: 'authorizing',
  WAITING_EMAIL_CODE: 'waiting_email_code',
  EXCHANGING_TOKEN: 'exchanging_token',
  PERSISTING_ARTIFACTS: 'persisting_artifacts',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELED: 'canceled'
});

const ACCOUNT_STATUS = Object.freeze({
  EMAIL_BOUND: 'email_bound',
  OAUTH_PHASE3_FAILED: 'oauth_phase3_failed',
  OAUTH_DONE: 'oauth_done',
  TOKEN_USED: 'token_used'
});

const ARTIFACT_TYPE = Object.freeze({
  TOKEN: 'token',
  LOG: 'log',
  SCREENSHOT: 'screenshot'
});

function isRunningStatus(status) {
  return [
    JOB_STATUS.VALIDATING,
    JOB_STATUS.STARTING_BROWSER,
    JOB_STATUS.AUTHORIZING,
    JOB_STATUS.WAITING_EMAIL_CODE,
    JOB_STATUS.EXCHANGING_TOKEN,
    JOB_STATUS.PERSISTING_ARTIFACTS
  ].includes(status);
}

module.exports = {
  ACCOUNT_STATUS,
  ARTIFACT_TYPE,
  JOB_STATUS,
  isRunningStatus
};
