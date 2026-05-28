class Phase3BrowserRuntime {
  constructor(options = {}) {
    this.mode = options.mode || 'compat';
  }

  async launch() {
    throw new Error('Phase3BrowserRuntime.launch() 尚未接入原生浏览器实现');
  }

  async close() {
    return undefined;
  }

  async navigateToOAuth() {
    throw new Error('Phase3BrowserRuntime.navigateToOAuth() 尚未接入原生浏览器实现');
  }

  async oauthLoginAndAuthorize() {
    throw new Error('Phase3BrowserRuntime.oauthLoginAndAuthorize() 尚未接入原生浏览器实现');
  }
}

module.exports = {
  Phase3BrowserRuntime
};
