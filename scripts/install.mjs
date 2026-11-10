import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
if (existsSync('.env')) {
  console.log(
    '.env already exists. Keeping existing secrets. Open APP_URL to continue the browser wizard.',
  );
  process.exit(0);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(
  '\nOpenAI PA · Installation\nThe browser wizard creates your admin account and configures OpenAI.\n',
);
const url =
  (await rl.question('Application URL [http://localhost:3000]: ')).trim() ||
  'http://localhost:3000';
const parsed = new URL(url);
if (
  parsed.origin !== url ||
  (!url.startsWith('https:') && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
)
  throw new Error('Use a HTTPS origin or local HTTP origin, without trailing slash.');
const setupToken = randomBytes(32).toString('hex');
writeFileSync(
  '.env',
  `APP_URL=${url}\nHOST=127.0.0.1\nPORT=3000\nDATA_DIR=./data\nENCRYPTION_KEY=${randomBytes(32).toString('hex')}\nSETUP_TOKEN=${setupToken}\n`,
  { mode: 0o600, flag: 'wx' },
);
console.log(
  `\nConfiguration created. Keep .env private and backed up.\n\nSetup token: ${setupToken}\n\nRun docker compose up --build -d, then open ${url}.\nOr run npm ci && npm run build && npm start (Node.js 24+).\n`,
);
rl.close();
