const path = require('path');
const { ARTIFACT_TYPE } = require('../shared-types');
const {
  copyFileEnsured,
  ensureDir,
  nowIso,
  readJsonFile,
  sanitizeEmail,
  sha256File,
  writeJsonFile
} = require('../shared-utils');

class FileArtifactRepository {
  constructor(config) {
    this.config = config;
    this.baseDir = config.artifactsDir;
    ensureDir(this.baseDir);
  }

  getJobDir(jobId) {
    return path.join(this.baseDir, jobId);
  }

  getManifestFile(jobId) {
    return path.join(this.getJobDir(jobId), 'artifacts.json');
  }

  list(jobId) {
    return readJsonFile(this.getManifestFile(jobId), []);
  }

  append(jobId, artifact) {
    const manifestFile = this.getManifestFile(jobId);
    const current = readJsonFile(manifestFile, []);
    current.push(artifact);
    writeJsonFile(manifestFile, current);
    return artifact;
  }

  saveTokenFromSource(jobId, email, sourcePath) {
    const filename = `codex-${sanitizeEmail(email)}-free.json`;
    const targetPath = path.join(this.getJobDir(jobId), filename);
    copyFileEnsured(sourcePath, targetPath);
    const artifact = {
      artifactType: ARTIFACT_TYPE.TOKEN,
      fileName: filename,
      filePath: targetPath,
      sha256: sha256File(targetPath),
      createdAt: nowIso()
    };
    this.append(jobId, artifact);
    return artifact;
  }
}

module.exports = {
  FileArtifactRepository
};
