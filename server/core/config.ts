import { resolve } from 'node:path';
export interface Config {
  url: string;
  dataDir: string;
  encryptionKey: string;
  setupToken: string;
  chatContextTokens?: number;
  googleClientId: string;
  googleClientSecret: string;
}
export function configFromEnv(): Config {
  const url = process.env.APP_URL || 'http://localhost:3000';
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== url)
    throw new Error('APP_URL must be an origin without a trailing slash');
  if (
    parsed.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) &&
    process.env.ALLOW_INSECURE_HTTP !== 'true'
  )
    throw new Error(
      'Remote APP_URL requires HTTPS; set ALLOW_INSECURE_HTTP=true only for a trusted LAN.',
    );
  if (
    !/^[a-f0-9]{64}$/i.test(process.env.ENCRYPTION_KEY || '') ||
    (process.env.SETUP_TOKEN || '').length < 32
  )
    throw new Error('Run npm run setup to generate ENCRYPTION_KEY and SETUP_TOKEN.');
  const chatContextTokens = Number(process.env.CHAT_CONTEXT_TOKENS || 32768);
  if (!Number.isInteger(chatContextTokens) || chatContextTokens < 8192 || chatContextTokens > 65536)
    throw new Error('CHAT_CONTEXT_TOKENS must be an integer from 8192 to 65536.');
  return {
    chatContextTokens,
    url,
    dataDir: resolve(process.env.DATA_DIR || './data'),
    encryptionKey: process.env.ENCRYPTION_KEY!,
    setupToken: process.env.SETUP_TOKEN!,
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  };
}
