# Contributing

Small, focused contributions are welcome. Open an issue describing the problem and acceptance criteria before starting a feature or fix. Discuss integrations or architectural changes first.

1. Fork/clone the repository and install Node.js 24+.
2. Create an issue-specific worktree from the latest default branch:
   ```sh
   git fetch origin
   git worktree add ../openaipa-issue-42 -b feat/42-short-description origin/main
   cd ../openaipa-issue-42
   npm ci
   ```
3. Implement the change. Add tests for meaningful behavior, especially authorization, data isolation and failure paths. Never commit real credentials or mail.
4. Run `npm run check`, `npm test`, and `npm run build`. Include limits of testing in the PR.
5. Commit, push your branch, and open a PR with `Closes #42`. End its description and your final completion comment with the required **Proof of Done** below. A maintainer reviews and merges it.
6. From the primary checkout after merge, run `git pull --ff-only` and `node scripts/cleanup-worktrees.mjs --apply`. Without `--apply` the script reports candidates. It also handles closed, unmerged PRs whose exact branch heads match, per this project's workflow. Inspect skips; never force away extra work.

Runtime data and `.env` block automatic cleanup. Keep development data outside disposable worktrees when practical; migrate configuration deliberately before removing them. Fork PR branches are intentionally not deleted by the helper.

Server code is TypeScript with explicit module boundaries; UI code is React. Use accessible labels, real empty/error states and restrained visual styling. Avoid adding dependencies for functionality already supported by Node. Read [architecture](docs/architecture.md) for integration and worker extension points.

## Proof of Done

Every issue requires evidence of completion before its PR is ready for review. Add `## Proof of Done` as the final section of the PR description and of the final completion comment on the PR. Use the [PR template](.github/pull_request_template.md).

- Map the issue's acceptance criteria to the implemented result and concrete evidence (files, artifacts, checks and actual results).
- Include screenshots when useful, especially for visible UI changes. Capture relevant states and viewport sizes; use before/after comparisons where helpful. Embed images or link reviewer-accessible artifacts with captions, rather than local file paths.
- Remove secrets, personal data and unrelated browser/application content from screenshots. Visual evidence supplements tests; it does not prove functional correctness on its own.
- If screenshots do not add value, briefly explain why. State unverified behavior, skipped checks and remaining limitations honestly, and update the evidence after revisions.

By contributing, you agree your contribution is available under the MIT license.
