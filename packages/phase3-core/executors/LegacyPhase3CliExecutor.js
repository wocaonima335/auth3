const { spawn } = require('child_process');
const { detectLatestTokenFile, fileExists, splitBufferLines } = require('../../shared-utils');

class LegacyPhase3CliExecutor {
  constructor(config) {
    this.config = config;
  }

  async run(options = {}) {
    const { email, onEvent = () => {} } = options;
    const entrypoint = this.config.legacyEntrypoint;
    if (!fileExists(entrypoint)) {
      throw new Error(`legacy 入口不存在: ${entrypoint}`);
    }

    const args = [
      entrypoint,
      '--stage=phase3-fetch-token',
      `--email=${email}`
    ];

    const env = {
      ...process.env,
      CONFIG_PROFILE: this.config.legacyConfigProfile
    };
    if (this.config.legacyConfigFile) {
      env.CONFIG_FILE = this.config.legacyConfigFile;
    }

    onEvent({
      level: 'info',
      message: `开始调用 legacy Phase3: ${email}`
    });

    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: this.config.legacyProjectRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      splitBufferLines(child.stdout, (line) => {
        onEvent({
          level: 'info',
          message: line
        });
      });

      splitBufferLines(child.stderr, (line) => {
        onEvent({
          level: 'warn',
          message: line
        });
      });

      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`legacy Phase3 退出码异常: ${code}`));
      });
    });

    const tokenMatch = detectLatestTokenFile(email, this.config.candidateTokenDirs);
    if (!tokenMatch) {
      throw new Error(`legacy Phase3 已完成，但没有在候选目录中找到 token: ${email}`);
    }

    onEvent({
      level: 'info',
      message: `找到 legacy token 文件: ${tokenMatch.path}`
    });

    return {
      tokenSourcePath: tokenMatch.path
    };
  }
}

module.exports = {
  LegacyPhase3CliExecutor
};
