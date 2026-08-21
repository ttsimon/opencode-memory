# GitHub Repository Settings

Use this checklist after the governance pull request has produced the real check names. Read each setting back after applying it.

## Repository Features

- [ ] Issues are enabled.
- [ ] Dependency graph is enabled.
- [ ] Dependabot alerts are enabled.
- [ ] Private vulnerability reporting is enabled.
- [ ] Secret scanning is enabled.
- [ ] Push protection is enabled.
- [ ] The Renovate GitHub App is installed for `ttsimon/opencode-memory`.

## Actions Policy

- [ ] Workflow permissions default to read-only repository contents.
- [ ] GitHub Actions may create pull requests for the Changesets release workflow.
- [ ] Only `.github/workflows/release.yml` receives `contents: write`, `pull-requests: write`, and `id-token: write`.
- [ ] All third-party Actions are pinned to full commit SHAs.

## Main Branch Protection

The initial repository has one maintainer. A solo maintainer cannot approve their own pull request, so protection requires pull requests and passing checks with `required approving reviews: 0`.

- [ ] Pull requests are required before merging.
- [ ] Branches must be up to date before merging.
- [ ] Review conversations must be resolved.
- [ ] Administrators are included.
- [ ] Force pushes are disabled.
- [ ] Branch deletion is disabled.

### Required status checks

- [ ] `quality`
- [ ] `test (ubuntu-latest)`
- [ ] `test (windows-latest)`
- [ ] `test (macos-latest)`
- [ ] `e2e (ubuntu-latest)`
- [ ] `e2e (windows-latest)`
- [ ] `pr-title`
- [ ] `codeql`
- [ ] `gitleaks`
- [ ] `dependency-review`

Use the exact names reported by the governance pull request. Do not configure guessed names before the first run completes.

## npm Trusted publishing

- [ ] The public npm package is `@ttsimon/opencode-memory`.
- [ ] Trusted publishing points to repository `ttsimon/opencode-memory` and workflow `.github/workflows/release.yml`.
- [ ] npm provenance is enabled.
- [ ] No long-lived `NPM_TOKEN` repository secret exists.
- [ ] Repository variable `NPM_PUBLISH_ENABLED` remains unset until the first release is explicitly approved, then is set to `true`.

If npm requires the package to exist before Trusted publishing can be configured, leave this item open and create the issue `Configure npm trusted publishing before first release`.
