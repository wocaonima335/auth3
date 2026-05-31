const net = require('net');

function parseRedisUrl(rawUrl = 'redis://127.0.0.1:6379/0') {
  const parsed = new URL(rawUrl);
  return {
    host: parsed.hostname || '127.0.0.1',
    port: Number(parsed.port || 6379),
    username: decodeURIComponent(parsed.username || ''),
    password: decodeURIComponent(parsed.password || ''),
    db: Number(String(parsed.pathname || '/0').replace(/^\//, '') || 0)
  };
}

function encodeCommand(args = []) {
  const chunks = [Buffer.from(`*${args.length}\r\n`, 'utf8')];
  for (const arg of args) {
    const value = Buffer.from(String(arg ?? ''), 'utf8');
    chunks.push(Buffer.from(`$${value.length}\r\n`, 'utf8'));
    chunks.push(value);
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  return Buffer.concat(chunks);
}

function findLineEnd(buffer, offset) {
  return buffer.indexOf('\r\n', offset, 'utf8');
}

function parseRespValue(buffer, offset = 0) {
  if (buffer.length <= offset) {
    return null;
  }

  const prefix = String.fromCharCode(buffer[offset]);
  const lineEnd = findLineEnd(buffer, offset + 1);
  if (lineEnd < 0) {
    return null;
  }

  if (prefix === '+' || prefix === '-' || prefix === ':') {
    const raw = buffer.slice(offset + 1, lineEnd).toString('utf8');
    return {
      bytes: lineEnd + 2 - offset,
      value: prefix === ':' ? Number(raw) : (prefix === '-' ? new Error(raw) : raw)
    };
  }

  if (prefix === '$') {
    const length = Number(buffer.slice(offset + 1, lineEnd).toString('utf8'));
    if (length === -1) {
      return {
        bytes: lineEnd + 2 - offset,
        value: null
      };
    }
    const start = lineEnd + 2;
    const end = start + length;
    if (buffer.length < end + 2) {
      return null;
    }
    return {
      bytes: end + 2 - offset,
      value: buffer.slice(start, end).toString('utf8')
    };
  }

  if (prefix === '*') {
    const count = Number(buffer.slice(offset + 1, lineEnd).toString('utf8'));
    if (count === -1) {
      return {
        bytes: lineEnd + 2 - offset,
        value: null
      };
    }

    let consumed = lineEnd + 2 - offset;
    let cursor = lineEnd + 2;
    const values = [];
    for (let index = 0; index < count; index += 1) {
      const parsed = parseRespValue(buffer, cursor);
      if (!parsed) {
        return null;
      }
      values.push(parsed.value);
      cursor += parsed.bytes;
      consumed += parsed.bytes;
    }

    return {
      bytes: consumed,
      value: values
    };
  }

  return null;
}

class RedisConnection {
  constructor(options = {}) {
    this.options = options;
    this.socket = null;
    this.pending = [];
    this.buffer = Buffer.alloc(0);
    this.closed = false;
  }

  static async connect(options = {}) {
    const connection = new RedisConnection(options);
    await connection.open();
    return connection;
  }

  async open() {
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({
        host: this.options.host,
        port: this.options.port
      });
      this.socket = socket;

      const onErrorBeforeConnect = (error) => {
        socket.removeListener('connect', onConnect);
        reject(error);
      };

      const onConnect = () => {
        socket.removeListener('error', onErrorBeforeConnect);
        socket.on('data', (chunk) => this.onData(chunk));
        socket.on('error', (error) => this.rejectPending(error));
        socket.on('close', () => {
          this.closed = true;
          this.rejectPending(new Error('Redis connection closed'));
        });
        resolve();
      };

      socket.once('error', onErrorBeforeConnect);
      socket.once('connect', onConnect);
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const parsed = parseRespValue(this.buffer, 0);
      if (!parsed) {
        break;
      }
      this.buffer = this.buffer.slice(parsed.bytes);
      const waiter = this.pending.shift();
      if (!waiter) {
        continue;
      }
      if (parsed.value instanceof Error) {
        waiter.reject(parsed.value);
      } else {
        waiter.resolve(parsed.value);
      }
    }
  }

  rejectPending(error) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    while (this.pending.length > 0) {
      const waiter = this.pending.shift();
      waiter.reject(error);
    }
  }

  async bootstrap() {
    if (this.options.password) {
      if (this.options.username) {
        await this.command(['AUTH', this.options.username, this.options.password]);
      } else {
        await this.command(['AUTH', this.options.password]);
      }
    }
    if (Number.isFinite(this.options.db) && this.options.db > 0) {
      await this.command(['SELECT', String(this.options.db)]);
    }
  }

  command(args = []) {
    if (!this.socket || this.closed) {
      return Promise.reject(new Error('Redis connection is not open'));
    }
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.socket.write(encodeCommand(args));
    });
  }

  close() {
    this.closed = true;
    if (this.socket) {
      this.socket.end();
      this.socket.destroy();
      this.socket = null;
    }
  }
}

class RedisPhase3Queue {
  constructor(config = {}) {
    this.config = config;
    this.enabled = !!config.redisEnabled;
    this.redis = parseRedisUrl(config.redisUrl);
    this.pendingKey = config.redisQueuePendingKey;
    this.processingKey = config.redisQueueProcessingKey;
    this.deadKey = config.redisQueueDeadKey;
    this.blockingTimeoutSec = Number(config.redisBlockingTimeoutSec || 5);
  }

  isEnabled() {
    return this.enabled;
  }

  async withConnection(fn) {
    const connection = await RedisConnection.connect(this.redis);
    try {
      await connection.bootstrap();
      return await fn(connection);
    } finally {
      connection.close();
    }
  }

  async enqueue(jobId) {
    if (!this.enabled) {
      return null;
    }
    return this.withConnection((connection) => {
      return connection.command(['RPUSH', this.pendingKey, String(jobId)]);
    });
  }

  async dequeue(workerId = '') {
    if (!this.enabled) {
      return null;
    }
    const jobId = await this.withConnection((connection) => {
      return connection.command([
        'BLMOVE',
        this.pendingKey,
        this.processingKey,
        'LEFT',
        'RIGHT',
        String(this.blockingTimeoutSec)
      ]);
    });
    if (!jobId) {
      return null;
    }
    return {
      jobId: String(jobId),
      workerId
    };
  }

  async ack(jobId) {
    if (!this.enabled) {
      return null;
    }
    return this.withConnection((connection) => {
      return connection.command(['LREM', this.processingKey, '0', String(jobId)]);
    });
  }

  async removePending(jobId) {
    if (!this.enabled) {
      return null;
    }
    return this.withConnection((connection) => {
      return connection.command(['LREM', this.pendingKey, '0', String(jobId)]);
    });
  }

  async listProcessing() {
    if (!this.enabled) {
      return [];
    }
    const values = await this.withConnection((connection) => {
      return connection.command(['LRANGE', this.processingKey, '0', '-1']);
    });
    return Array.isArray(values) ? values.map((item) => String(item)) : [];
  }

  async requeueFromProcessing(jobId) {
    if (!this.enabled) {
      return null;
    }
    return this.withConnection(async (connection) => {
      await connection.command(['LREM', this.processingKey, '0', String(jobId)]);
      return connection.command(['RPUSH', this.pendingKey, String(jobId)]);
    });
  }

  async moveToDead(jobId, reason = '') {
    if (!this.enabled) {
      return null;
    }
    return this.withConnection(async (connection) => {
      await connection.command(['LREM', this.processingKey, '0', String(jobId)]);
      if (reason) {
        await connection.command(['LPUSH', `${this.deadKey}:reasons`, `${jobId}:${reason}`]);
      }
      return connection.command(['LPUSH', this.deadKey, String(jobId)]);
    });
  }

  async recoverStaleProcessingJobs(options = {}) {
    if (!this.enabled) {
      return {
        acked: [],
        requeued: [],
        dead: []
      };
    }

    const classifyJob = options.classifyJob || (async () => 'requeue');
    const jobIds = await this.listProcessing();
    const result = {
      acked: [],
      requeued: [],
      dead: []
    };

    for (const jobId of jobIds) {
      const action = await classifyJob(jobId);
      if (action === 'ack') {
        await this.ack(jobId);
        result.acked.push(jobId);
        continue;
      }
      if (action === 'dead') {
        await this.moveToDead(jobId, 'stale-processing');
        result.dead.push(jobId);
        continue;
      }
      await this.requeueFromProcessing(jobId);
      result.requeued.push(jobId);
    }

    return result;
  }
}

module.exports = {
  RedisPhase3Queue
};
