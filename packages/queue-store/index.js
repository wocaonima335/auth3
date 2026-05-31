const { RedisPhase3Queue } = require('./RedisPhase3Queue');

function createPhase3Queue(config) {
  return new RedisPhase3Queue(config);
}

module.exports = {
  RedisPhase3Queue,
  createPhase3Queue
};
