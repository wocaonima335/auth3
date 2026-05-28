const path = require('path');
const { loadRuntimeConfig } = require('../packages/runtime-config');
const { JsonCompatAccountRepository } = require('../packages/account-store');

async function main() {
  const config = loadRuntimeConfig(path.resolve(__dirname, '..'));
  const repository = new JsonCompatAccountRepository(config);
  const result = repository.syncFromSource();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
