const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

function readJsonFile(filePath, fallback) {
  if (!fileExists(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tempFile = `${filePath}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tempFile, filePath);
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function sanitizeEmail(email) {
  return String(email || 'unknown')
    .trim()
    .replace(/[@.]/g, '_')
    .replace(/[\\/:*?"<>|]/g, '_');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-User',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(body);
}

function sendText(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-User',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(body);
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-User');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function serveStaticFile(res, filePath) {
  if (!fileExists(filePath)) {
    sendText(res, 404, 'Not Found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const typeMap = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  };
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': typeMap[ext] || 'application/octet-stream',
    'Content-Length': body.length
  });
  res.end(body);
}

function splitBufferLines(buffer, callback) {
  let carry = '';
  buffer.on('data', (chunk) => {
    const pieces = `${carry}${chunk.toString('utf8')}`.split(/\r?\n/);
    carry = pieces.pop() || '';
    for (const line of pieces) {
      const normalized = String(line || '').trim();
      if (normalized) {
        callback(normalized);
      }
    }
  });
  buffer.on('end', () => {
    const normalized = String(carry || '').trim();
    if (normalized) {
      callback(normalized);
    }
  });
}

function detectLatestTokenFile(email, candidateDirs = []) {
  const filename = `codex-${sanitizeEmail(email)}-free.json`;
  const matches = [];
  for (const dir of candidateDirs) {
    if (!dir || !fileExists(dir)) {
      continue;
    }
    const fullPath = path.join(dir, filename);
    if (!fileExists(fullPath)) {
      continue;
    }
    const stats = fs.statSync(fullPath);
    matches.push({
      path: fullPath,
      mtimeMs: stats.mtimeMs,
      size: stats.size
    });
  }
  matches.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return matches[0] || null;
}

function copyFileEnsured(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function formatError(error) {
  if (!error) {
    return 'unknown error';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

module.exports = {
  copyFileEnsured,
  createId,
  detectLatestTokenFile,
  ensureDir,
  fileExists,
  formatError,
  nowIso,
  parseJsonBody,
  readJsonFile,
  sanitizeEmail,
  sendJson,
  sendText,
  serveStaticFile,
  setCors,
  sha256File,
  sleep,
  splitBufferLines,
  writeJsonFile
};
