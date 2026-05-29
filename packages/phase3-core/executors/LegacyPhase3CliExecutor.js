const { spawn } = require('child_process');
const { detectLatestTokenFile, fileExists, splitBufferLines } = require('../../shared-utils');

function shouldAbortForPhoneVerification(line = '') {
  const text = String(line || '').trim();
  if (!text) {
    return false;
  }

  return [
    /phone-verification/i,
    /contact-verification/i,
    /phone-otp/i,
    /\bselect-channel\b/i,
    /需要 SMS 验证码/i,
    /需要手机验证码/i,
    /检测到需要手机验证/i,
    /hit SMS verification/i
  ].some((pattern) => pattern.test(text));
}

function buildPhoneVerificationRequiredError(line = '') {
  const suffix = line ? `: ${line}` : '';
  const error = new Error(`检测到需要 phone-verification，本轮任务按策略直接失败${suffix}`);
  error.code = 'PHONE_VERIFICATION_REQUIRED';
  return error;
}

class LegacyPhase3CliExecutor {
  constructor(config) {
    this.config = config;
    this._activeChild = null;
  }

  kill() {
    if (this._activeChild && !this._activeChild.killed) {
      try {
        this._activeChild.kill('SIGTERM');
        setTimeout(() => {
          if (this._activeChild && !this._activeChild.killed) {
            this._activeChild.kill('SIGKILL');
          }
        }, 2000);
      } catch (_) {
        // ignore
      }
    }
  }

  async run(options = {}) {
    const { email, onEvent = () => {}, isCanceled = () => false } = options;
    const entrypoint = this.config.legacyEntrypoint;
    if (!fileExists(entrypoint)) {
      throw new Error(`legacy 入口不存在: ${entrypoint}`);
    }

    const args = [
      entrypoint,
      '--phase3',
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

    const runResult = await new Promise((resolve, reject) => {
      let settled = false;
      let abortError = null;

      const finish = (handler, value) => {
        if (settled) {
          return;
        }
        settled = true;
        handler(value);
      };

      const safeEmit = (event) => {
        try {
          onEvent(event);
        } catch (error) {
          console.error(`[auth-legacy-executor] onEvent failed: ${error.message}`);
        }
      };

      const child = spawn(process.execPath, args, {
        cwd: this.config.legacyProjectRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this._activeChild = child;

      const abortChild = (error) => {
        if (abortError) {
          return;
        }
        abortError = error;
        safeEmit({
          level: 'error',
          message: error.message,
          payload: {
            code: error.code || ''
          }
        });
        try {
          child.kill();
        } catch (killError) {
          console.error(`[auth-legacy-executor] child.kill failed: ${killError.message}`);
        }
      };

      const handleLine = (level) => (line) => {
        safeEmit({
          level,
          message: line
        });
        if (!abortError && shouldAbortForPhoneVerification(line)) {
          abortChild(buildPhoneVerificationRequiredError(line));
        }
      };

      splitBufferLines(child.stdout, handleLine('info'));
      splitBufferLines(child.stderr, handleLine('warn'));

      child.on('error', (error) => {
        this._activeChild = null;
        finish(reject, abortError || error);
      });

      child.on('exit', (code) => {
        this._activeChild = null;
        if (isCanceled()) {
          finish(reject, new Error('任务已被用户取消'));
          return;
        }
        if (abortError) {
          finish(reject, abortError);
          return;
        }
        if (code === 0) {
          finish(resolve);
          return;
        }
        finish(reject, new Error(`legacy Phase3 退出码异常: ${code}`));
      });
    });

    if (isCanceled()) {
      throw new Error('任务已被用户取消');
    }

    // abortError 通过 Promise rejection 传递，无需再检查

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