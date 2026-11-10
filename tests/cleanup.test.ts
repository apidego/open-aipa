import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const script = resolve('scripts/cleanup-worktrees.mjs');
let dir: string;
let main: string;
let worktree: string;
let bin: string;
let head: string;
function git(args: string[], cwd = main) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function run(apply = true) {
  return execFileSync(process.execPath, [script, ...(apply ? ['--apply'] : [])], {
    cwd: main,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
}
function gh(state = 'MERGED', oid = head) {
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env node\nconst fs = require('node:fs'); const a = process.argv.slice(2); if(a[0]==='repo') console.log(JSON.stringify({nameWithOwner:'test/repo',defaultBranchRef:{name:'main'}})); else if(a[0]==='pr') console.log(JSON.stringify([{number:1,state:${JSON.stringify(state)},headRefOid:${JSON.stringify(oid)},isCrossRepository:false,closingIssuesReferences:[{number:1,url:'https://github.com/test/repo/issues/1'}]}])); else if(a[1]==='view') console.log('{"state":"OPEN"}'); else fs.writeFileSync(${JSON.stringify(join(dir, 'issue-closed'))}, a.join(' '));\n`,
    { mode: 0o755 },
  );
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pa-cleanup-'));
  main = join(dir, 'main');
  worktree = join(dir, 'feature');
  bin = join(dir, 'bin');
  mkdirSync(main);
  mkdirSync(bin);
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(join(main, '.gitignore'), '.env\ndata/\n');
  git(['add', '.gitignore']);
  git(['commit', '-m', 'initial']);
  git(['init', '--bare', join(dir, 'remote.git')]);
  git(['remote', 'add', 'origin', join(dir, 'remote.git')]);
  git(['push', '-u', 'origin', 'main']);
  git(['worktree', 'add', '-b', 'feat/1-test', worktree]);
  git(['commit', '--allow-empty', '-m', 'feature'], worktree);
  git(['push', '-u', 'origin', 'feat/1-test'], worktree);
  head = git(['rev-parse', 'HEAD'], worktree);
  gh();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
it('removes exactly matched closed PR worktrees, both branches, and closes the issue', () => {
  run();
  expect(existsSync(main)).toBe(true);
  expect(existsSync(worktree)).toBe(false);
  expect(git(['branch', '--list', 'feat/1-test'])).toBe('');
  expect(git(['ls-remote', '--heads', 'origin', 'refs/heads/feat/1-test'])).toBe('');
  expect(readFileSync(join(dir, 'issue-closed'), 'utf8')).toContain('--reason completed');
});
it('dry run does not mutate worktrees or issues', () => {
  expect(run(false)).toContain('Would remove');
  expect(existsSync(worktree)).toBe(true);
  expect(existsSync(join(dir, 'issue-closed'))).toBe(false);
});
it('preserves open PRs and local commits beyond the PR head', () => {
  gh('OPEN');
  run();
  expect(existsSync(worktree)).toBe(true);
  gh('CLOSED', 'different-head');
  run();
  expect(existsSync(worktree)).toBe(true);
});
it('preserves dirty worktrees and ignored configuration/data', () => {
  writeFileSync(join(worktree, 'notes.txt'), 'valuable work');
  run();
  expect(existsSync(worktree)).toBe(true);
  rmSync(join(worktree, 'notes.txt'));
  writeFileSync(join(worktree, '.env'), 'secret');
  run();
  expect(existsSync(worktree)).toBe(true);
  rmSync(join(worktree, '.env'));
  mkdirSync(join(worktree, 'data'));
  run();
  expect(existsSync(worktree)).toBe(true);
});
it('preserves remote commits not included in the closed PR', () => {
  git(['commit', '--allow-empty', '-m', 'remote work'], worktree);
  git(['push'], worktree);
  git(['reset', '--hard', head], worktree);
  expect(run()).toContain('remote has different commits');
  expect(existsSync(worktree)).toBe(true);
});
