# Working on OpenAI PA

## Session start

1. Work from the primary checkout. Inspect `git status --short --branch` and `git worktree list`.
2. Run `node scripts/cleanup-worktrees.mjs --apply` (requires authenticated `gh`). Inspect the output. The script removes clean secondary worktrees and local/remote branches only when the matching PR is closed or merged and both branch heads still match that PR. It closes linked open issues (completed for merged PRs, not planned for closed PRs).
3. Never remove the primary/current worktree, open-PR worktrees, uncommitted changes, extra commits, `.env`, or runtime data. Report skips; preserve work rather than forcing deletion. `node_modules` and build output are disposable. Move valuable runtime data deliberately before retrying cleanup.
4. If the script is not available yet on the default branch, perform equivalent read-only checks with `git worktree list` and `gh pr list`; clean only verified safe worktrees. Do not remove the open bootstrap PR's worktree.

## Issue → worktree → PR

- Create or identify a GitHub issue for each feature or bug before implementation.
- Create a separate sibling worktree and branch: `git worktree add ../openaipa-issue-N -b feat/N-short-description origin/main`.
- Keep each PR focused. Link its issue with `Closes #N`. Never develop features directly on `main`.
- Run `npm run check`, meaningful tests (`npm test` for shared behavior), and `npm run build` before delivery. Commit and push completed work, then open a PR. Do not merge without an explicit instruction.
- After a merge, update the clean primary checkout with `git pull --ff-only` and run cleanup from there. Remote branch auto-deletion is enabled.
- Batch independent inspections, prefer targeted `rg` searches, and avoid large logs/diffs. Do not spawn agents for trivial or duplicate work.

## Architecture and safety

- Read `docs/architecture.md` before structural changes. Server modules own authentication/authorization; UI restrictions never substitute for server checks.
- All user-owned data queries must scope to the authenticated user. Only admins manage global secrets, prompts and users.
- Never log or commit secrets, sessions, mail content, `.env`, or database files. Mock external APIs in automated tests.
- New integrations implement `server/integrations/types.ts` and register explicitly. No arbitrary shell execution or dynamic untrusted plugins.
- Gmail is read-only. Sending email or other external write tools needs a separate issue with an explicit action approval design.
- Keep README concise; put implementation and operational details in `docs/`. UI follows a quiet, light dashboard with an icon-only/expanded sidebar; conversations stay immediately below dashboard.
