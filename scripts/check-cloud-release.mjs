import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(new URL('../src/shared/cloudConfig.json', import.meta.url), 'utf8'));
const url = new URL(config.gatewayUrl || 'http://localhost');
if (url.protocol !== 'https:' || ['localhost','127.0.0.1'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
  console.error('Public releases need the deployed HTTPS Scobe AI gateway URL in src/shared/cloudConfig.json. Provider API keys must stay on the server.'); process.exit(1);
}
console.log('Public Scobe AI gateway configured.');
