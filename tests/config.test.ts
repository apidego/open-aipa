import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { configFromEnv } from '../server/core/config.js';

beforeEach(() => {
  vi.stubEnv('ENCRYPTION_KEY', 'a'.repeat(64));
  vi.stubEnv('SETUP_TOKEN', 'b'.repeat(64));
  vi.stubEnv('ALLOW_INSECURE_HTTP', 'false');
});
afterEach(() => vi.unstubAllEnvs());
describe('HTTP opt-in', () => {
  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
    'https://pa.example.com',
  ])('preserves accepted default origin %s', (url) => {
    vi.stubEnv('APP_URL', url);
    expect(configFromEnv().url).toBe(url);
  });
  it.each(['', 'false', '1', 'TRUE'])(
    'rejects network HTTP unless the opt-in is exactly true (%s)',
    (flag) => {
      vi.stubEnv('APP_URL', 'http://192.168.1.50:3000');
      vi.stubEnv('ALLOW_INSECURE_HTTP', flag);
      expect(() => configFromEnv()).toThrow('requires HTTPS');
    },
  );
  it('accepts explicitly enabled network HTTP', () => {
    vi.stubEnv('APP_URL', 'http://192.168.1.50:3000');
    vi.stubEnv('ALLOW_INSECURE_HTTP', 'true');
    expect(configFromEnv().url).toBe('http://192.168.1.50:3000');
  });
  it.each([
    'ftp://192.168.1.50',
    'http://192.168.1.50/path',
    'http://192.168.1.50/',
    'http://user:pass@192.168.1.50',
  ])('still rejects invalid origins with opt-in (%s)', (url) => {
    vi.stubEnv('APP_URL', url);
    vi.stubEnv('ALLOW_INSECURE_HTTP', 'true');
    expect(() => configFromEnv()).toThrow();
  });
});
const installer = resolve('scripts/install.mjs');
it('installer requires opt-in, writes private persistent secrets and never overwrites them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-install-'));
  try {
    const run = (args: string[], url: string) =>
      spawnSync(process.execPath, [installer, ...args], {
        cwd: dir,
        input: `${url}\n`,
        encoding: 'utf8',
      });
    expect(run([], 'http://192.168.1.50:3333').status).not.toBe(0);
    expect(existsSync(join(dir, '.env'))).toBe(false);
    expect(run(['--allow-insecure-http'], 'http://192.168.1.50:3333').status).toBe(0);
    const env = readFileSync(join(dir, '.env'), 'utf8');
    expect(env).toContain('PUBLISH_ADDRESS=0.0.0.0');
    expect(env).toContain('PUBLISH_PORT=3333');
    expect(env).toContain('ALLOW_INSECURE_HTTP=true');
    expect(env).toMatch(/ENCRYPTION_KEY=[a-f0-9]{64}/);
    expect(env).toMatch(/SETUP_TOKEN=[a-f0-9]{64}/);
    expect(statSync(join(dir, '.env')).mode & 0o777).toBe(0o600);
    expect(run([], 'http://localhost:3000').status).toBe(0);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(env);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
it('installer preserves loopback-only publishing by default', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-install-'));
  try {
    const result = spawnSync(process.execPath, [installer], {
      cwd: dir,
      input: '\n',
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    const env = readFileSync(join(dir, '.env'), 'utf8');
    expect(env).toContain('PUBLISH_ADDRESS=127.0.0.1');
    expect(env).toContain('ALLOW_INSECURE_HTTP=false');
  } finally {
    rmSync(dir, { recursive: true });
  }
});
