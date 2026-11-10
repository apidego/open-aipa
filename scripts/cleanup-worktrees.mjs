#!/usr/bin/env node
// Only remove clean, unchanged worktrees whose exact PR head is closed.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
const apply = process.argv.includes('--apply');
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const git = (args, cwd) => run('git', args, cwd);
const origin = git(['remote', 'get-url', 'origin']);
const repo = JSON.parse(
  run('gh', ['repo', 'view', origin, '--json', 'nameWithOwner,defaultBranchRef']),
);
const entries = git(['worktree', 'list', '--porcelain'])
  .split('\n\n')
  .filter(Boolean)
  .map((block) =>
    Object.fromEntries(
      block.split('\n').map((line) => {
        const i = line.indexOf(' ');
        return i < 0 ? [line, true] : [line.slice(0, i), line.slice(i + 1)];
      }),
    ),
  );
const primary = entries[0]?.worktree;
if (!primary) throw new Error('Cannot determine primary checkout');
console.log(`${apply ? 'Apply' : 'Dry run'}: closed PR worktrees in ${repo.nameWithOwner}`);
for (const entry of entries.slice(1)) {
  const path = entry.worktree;
  const branch = typeof entry.branch === 'string' ? entry.branch.replace('refs/heads/', '') : '';
  if (
    !branch ||
    branch === repo.defaultBranchRef.name ||
    entry.locked ||
    entry.prunable ||
    resolve(path) === resolve(process.cwd())
  )
    continue;
  if (git(['status', '--porcelain'], path)) {
    console.log(`Keep ${branch}: uncommitted/untracked changes`);
    continue;
  }
  if (existsSync(join(path, '.env')) || existsSync(join(path, 'data'))) {
    console.log(`Keep ${branch}: local configuration or runtime data; relocate manually first`);
    continue;
  }
  const prs = JSON.parse(
    run('gh', [
      'pr',
      'list',
      '--repo',
      repo.nameWithOwner,
      '--head',
      branch,
      '--state',
      'all',
      '--json',
      'number,state,headRefOid,isCrossRepository,closingIssuesReferences',
      '--limit',
      '100',
    ]),
  );
  if (prs.some((pr) => pr.state === 'OPEN')) continue;
  const pr = prs.find(
    (pr) =>
      !pr.isCrossRepository &&
      ['CLOSED', 'MERGED'].includes(pr.state) &&
      pr.headRefOid === entry.HEAD,
  );
  if (!pr) {
    console.log(`Keep ${branch}: no closed PR matches the current commit`);
    continue;
  }
  const remote = git(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], primary).split(
    /\s/,
  )[0];
  if (remote && remote !== pr.headRefOid) {
    console.log(`Keep ${branch}: remote has different commits`);
    continue;
  }
  console.log(`${apply ? 'Remove' : 'Would remove'} ${path}, branch ${branch}, PR #${pr.number}`);
  if (!apply) continue;
  for (const issue of pr.closingIssuesReferences || []) {
    if (!issue.url?.startsWith(`https://github.com/${repo.nameWithOwner}/issues/`)) continue;
    const state = JSON.parse(
      run('gh', [
        'issue',
        'view',
        String(issue.number),
        '--repo',
        repo.nameWithOwner,
        '--json',
        'state',
      ]),
    );
    if (state.state === 'OPEN')
      run('gh', [
        'issue',
        'close',
        String(issue.number),
        '--repo',
        repo.nameWithOwner,
        '--reason',
        pr.state === 'MERGED' ? 'completed' : 'not planned',
      ]);
  }
  // No --force: Git will refuse worktree removal if changes appeared during checks.
  git(['worktree', 'remove', path], primary);
  if (remote)
    git(
      [
        'push',
        `--force-with-lease=refs/heads/${branch}:${remote}`,
        'origin',
        `:refs/heads/${branch}`,
      ],
      primary,
    );
  git(['branch', '-D', branch], primary);
}
if (apply) git(['worktree', 'prune'], primary);
