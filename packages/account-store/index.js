const path = require('path');
const { ACCOUNT_STATUS } = require('../shared-types');
const { nowIso, readJsonFile, writeJsonFile, fileExists } = require('../shared-utils');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function mapUsernameRecord(record = {}) {
  return {
    id: normalizeEmail(record.email),
    email: String(record.email || '').trim(),
    password: String(record.password || '').trim(),
    name: String(record.name || '').trim(),
    birthDate: String(record.birthDate || '').trim(),
    phone: String(record.phone || '').trim(),
    phoneCountryCode: String(record.phoneCountryCode || '').trim(),
    phoneCountryDialCode: String(record.phoneCountryDialCode || '').trim(),
    phoneCountryName: String(record.phoneCountryName || '').trim(),
    heroSmsCountry: record.heroSmsCountry ?? null,
    status: String(record.status || '').trim() || ACCOUNT_STATUS.EMAIL_BOUND,
    emailPassword: String(record.emailPassword || '').trim(),
    refreshToken: String(record.refreshToken || '').trim(),
    clientId: String(record.clientId || '').trim(),
    externalEmailProvider: String(record.externalEmailProvider || '').trim(),
    externalEmailSourceFile: String(record.externalEmailSourceFile || '').trim(),
    externalEmailSourceLine: Number.isFinite(Number(record.externalEmailSourceLine))
      ? Number(record.externalEmailSourceLine)
      : null,
    createdAt: String(record.createdAt || '').trim() || nowIso(),
    updatedAt: nowIso(),
    lastTokenAt: String(record.lastTokenAt || '').trim(),
    lastTokenFile: String(record.lastTokenFile || '').trim(),
    lastFailureReason: String(record.lastFailureReason || '').trim()
  };
}

class JsonCompatAccountRepository {
  constructor(config) {
    this.config = config;
    this.cacheFile = config.accountsCacheFile;
    this.sourceFile = config.sourceUsernameFile;
  }

  syncFromSource() {
    const sourceRecords = readJsonFile(this.sourceFile, []);
    const mapped = sourceRecords
      .filter((item) => normalizeEmail(item.email) && String(item.password || '').trim())
      .map(mapUsernameRecord);
    writeJsonFile(this.cacheFile, mapped);
    return {
      count: mapped.length,
      cacheFile: this.cacheFile,
      sourceFile: this.sourceFile
    };
  }

  list() {
    if (!fileExists(this.cacheFile)) {
      this.syncFromSource();
    }
    return readJsonFile(this.cacheFile, []);
  }

  getByEmail(email, options = {}) {
    if (options.refresh) {
      this.syncFromSource();
    }
    const normalized = normalizeEmail(email);
    return this.list().find((item) => normalizeEmail(item.email) === normalized) || null;
  }

  updateStatus(email, status, patch = {}) {
    const normalized = normalizeEmail(email);
    const accounts = this.list();
    let updated = null;
    for (let index = accounts.length - 1; index >= 0; index -= 1) {
      if (normalizeEmail(accounts[index].email) !== normalized) {
        continue;
      }
      accounts[index] = {
        ...accounts[index],
        ...patch,
        status,
        updatedAt: nowIso()
      };
      updated = accounts[index];
      break;
    }
    if (!updated) {
      return null;
    }
    writeJsonFile(this.cacheFile, accounts);
    this.syncBackToSource(email, updated);
    return updated;
  }

  noteLatestToken(email, tokenFile, patch = {}) {
    return this.updateStatus(email, ACCOUNT_STATUS.OAUTH_DONE, {
      ...patch,
      lastTokenAt: nowIso(),
      lastTokenFile: tokenFile,
      lastFailureReason: ''
    });
  }

  syncBackToSource(email, patch = {}) {
    if (!fileExists(this.sourceFile)) {
      return null;
    }
    const normalized = normalizeEmail(email);
    const sourceRecords = readJsonFile(this.sourceFile, []);
    for (let index = sourceRecords.length - 1; index >= 0; index -= 1) {
      if (normalizeEmail(sourceRecords[index].email) !== normalized) {
        continue;
      }
      sourceRecords[index] = {
        ...sourceRecords[index],
        status: patch.status || sourceRecords[index].status,
        lastTokenAt: patch.lastTokenAt || sourceRecords[index].lastTokenAt || '',
        lastTokenFile: patch.lastTokenFile || sourceRecords[index].lastTokenFile || '',
        lastFailureReason: patch.lastFailureReason || ''
      };
      writeJsonFile(this.sourceFile, sourceRecords);
      return sourceRecords[index];
    }
    return null;
  }
}

module.exports = {
  JsonCompatAccountRepository
};
