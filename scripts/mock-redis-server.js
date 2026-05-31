const net = require('net');

const lists = new Map();
const waiters = new Map();

function getList(key) {
  if (!lists.has(key)) {
    lists.set(key, []);
  }
  return lists.get(key);
}

function getWaiters(key) {
  if (!waiters.has(key)) {
    waiters.set(key, []);
  }
  return waiters.get(key);
}

function encodeSimpleString(value) {
  return Buffer.from(`+${value}\r\n`, 'utf8');
}

function encodeError(value) {
  return Buffer.from(`-${value}\r\n`, 'utf8');
}

function encodeInteger(value) {
  return Buffer.from(`:${Number(value)}\r\n`, 'utf8');
}

function encodeBulkString(value) {
  if (value === null || value === undefined) {
    return Buffer.from(`$-1\r\n`, 'utf8');
  }
  const buffer = Buffer.from(String(value), 'utf8');
  return Buffer.concat([
    Buffer.from(`$${buffer.length}\r\n`, 'utf8'),
    buffer,
    Buffer.from('\r\n', 'utf8')
  ]);
}

function encodeArray(values) {
  if (values === null) {
    return Buffer.from(`*-1\r\n`, 'utf8');
  }
  const chunks = [Buffer.from(`*${values.length}\r\n`, 'utf8')];
  for (const value of values) {
    if (Array.isArray(value)) {
      chunks.push(encodeArray(value));
    } else if (value === null || value === undefined) {
      chunks.push(encodeBulkString(null));
    } else {
      chunks.push(encodeBulkString(value));
    }
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
    let cursor = lineEnd + 2;
    let consumed = lineEnd + 2 - offset;
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

  if (prefix === '+' || prefix === '-' || prefix === ':') {
    const raw = buffer.slice(offset + 1, lineEnd).toString('utf8');
    return {
      bytes: lineEnd + 2 - offset,
      value: raw
    };
  }

  return null;
}

function tryResolveWaiters(key) {
  const queue = getList(key);
  const queueWaiters = getWaiters(key);
  while (queue.length > 0 && queueWaiters.length > 0) {
    const waiter = queueWaiters.shift();
    clearTimeout(waiter.timer);
    const sourceList = getList(waiter.sourceKey);
    if (sourceList.length === 0) {
      waiter.socket.write(encodeBulkString(null));
      continue;
    }
    const item = waiter.from === 'LEFT' ? sourceList.shift() : sourceList.pop();
    const destination = getList(waiter.destinationKey);
    if (waiter.to === 'LEFT') {
      destination.unshift(item);
    } else {
      destination.push(item);
    }
    waiter.socket.write(encodeBulkString(item));
  }
}

function handleCommand(command, socket) {
  const [rawName, ...args] = command;
  const name = String(rawName || '').trim().toUpperCase();

  if (name === 'AUTH' || name === 'SELECT') {
    socket.write(encodeSimpleString('OK'));
    return;
  }

  if (name === 'RPUSH') {
    const [key, value] = args;
    const queue = getList(String(key));
    queue.push(String(value));
    socket.write(encodeInteger(queue.length));
    tryResolveWaiters(String(key));
    return;
  }

  if (name === 'LPUSH') {
    const [key, value] = args;
    const queue = getList(String(key));
    queue.unshift(String(value));
    socket.write(encodeInteger(queue.length));
    tryResolveWaiters(String(key));
    return;
  }

  if (name === 'LRANGE') {
    const [key, startRaw, endRaw] = args;
    const queue = getList(String(key));
    const start = Number(startRaw);
    let end = Number(endRaw);
    if (end === -1) {
      end = queue.length - 1;
    }
    const slice = queue.slice(start, end + 1);
    socket.write(encodeArray(slice));
    return;
  }

  if (name === 'LREM') {
    const [key, countRaw, valueRaw] = args;
    const queue = getList(String(key));
    const count = Number(countRaw);
    const value = String(valueRaw);
    let removed = 0;
    if (count === 0) {
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        if (queue[index] === value) {
          queue.splice(index, 1);
          removed += 1;
        }
      }
    }
    socket.write(encodeInteger(removed));
    return;
  }

  if (name === 'BLMOVE') {
    const [sourceKeyRaw, destinationKeyRaw, fromRaw, toRaw, timeoutRaw] = args;
    const sourceKey = String(sourceKeyRaw);
    const destinationKey = String(destinationKeyRaw);
    const from = String(fromRaw).toUpperCase();
    const to = String(toRaw).toUpperCase();
    const timeoutSec = Number(timeoutRaw || 0);
    const sourceList = getList(sourceKey);
    if (sourceList.length > 0) {
      const item = from === 'LEFT' ? sourceList.shift() : sourceList.pop();
      const destination = getList(destinationKey);
      if (to === 'LEFT') {
        destination.unshift(item);
      } else {
        destination.push(item);
      }
      socket.write(encodeBulkString(item));
      return;
    }

    const waiter = {
      socket,
      sourceKey,
      destinationKey,
      from,
      to,
      timer: null
    };
    waiter.timer = setTimeout(() => {
      const queueWaiters = getWaiters(sourceKey);
      const index = queueWaiters.indexOf(waiter);
      if (index >= 0) {
        queueWaiters.splice(index, 1);
      }
      socket.write(encodeBulkString(null));
    }, timeoutSec * 1000);
    getWaiters(sourceKey).push(waiter);
    return;
  }

  socket.write(encodeError(`ERR unsupported command ${name}`));
}

function createServer(port = 6379) {
  return net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const parsed = parseRespValue(buffer, 0);
        if (!parsed) {
          break;
        }
        buffer = buffer.slice(parsed.bytes);
        handleCommand(parsed.value || [], socket);
      }
    });
    socket.on('error', () => {});
  }).listen(port, '127.0.0.1', () => {
    console.log(`[mock-redis] listening on redis://127.0.0.1:${port}`);
  });
}

const port = Number(process.env.MOCK_REDIS_PORT || 6379);
createServer(port);
