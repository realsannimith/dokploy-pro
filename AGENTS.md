# Dokploy Pro agent instructions

## Releasing Dokploy Pro

Only publish or create a release when the user explicitly asks. This fork uses
`canary` as its working and default branch and publishes images to
`ghcr.io/realsannimith/dokploy-pro`.

Keep unrelated worktree changes out of release commits. This repository is
often edited by more than one task at a time, so stage the exact files that
belong to the requested change rather than using `git add .`.

### Validate before publishing

Run checks that cover the changed area and report any unrelated existing
failures. At minimum for server or terminal changes, run:

```bash
pnpm exec biome check <changed-files>
pnpm --filter=dokploy run build-server
```

Run the relevant Vitest files as well. Use a broader build or typecheck when the
change warrants it. Do not claim that a release is ready if its relevant checks
failed.

### Canary release

A normal push to `canary` is the canary release mechanism:

1. Confirm the intended commit is on `canary` and only the requested files are
   staged.
2. Commit and push to `origin canary`.
3. `.github/workflows/build-image.yml` runs automatically as
   **Build Dokploy Pro Images**.
4. Wait for that workflow to finish successfully for the exact pushed commit.
   A separate `autofix.ci` result is not the image release result.
5. The workflow publishes these moving tags:
   - `ghcr.io/realsannimith/dokploy-pro:custom`
   - `ghcr.io/realsannimith/dokploy-pro:monitoring-custom`

Useful verification commands:

```bash
gh run list --repo realsannimith/dokploy-pro --branch canary --limit 10
gh run watch <run-id> --repo realsannimith/dokploy-pro --exit-status
```

After a successful canary image build, update an existing installation with:

```bash
curl -sSL https://raw.githubusercontent.com/realsannimith/dokploy-pro/canary/install.sh | bash -s update
```

The installer defaults to the `custom` tag and sets `RELEASE_TAG=custom`, so the
in-app updater continues tracking this fork's canary image.

### Versioned stable release

Stable releases are created only through `.github/workflows/release.yml`. Do
not manually edit a tag, create a GitHub release, or retag container images as a
substitute for this workflow.

1. Make sure the desired code is committed and pushed to `canary`, with its
   canary image build green.
2. Choose the SemVer bump: `patch`, `minor`, or `major`.
3. Dispatch the release workflow from `canary`:

```bash
gh workflow run release.yml \
  --repo realsannimith/dokploy-pro \
  --ref canary \
  -f bump=patch
```

4. Find and watch the resulting **Release Dokploy Pro** run:

```bash
gh run list --repo realsannimith/dokploy-pro --workflow release.yml --limit 5
gh run watch <run-id> --repo realsannimith/dokploy-pro --exit-status
```

The version source is `apps/dokploy/package.json` and must use the `vX.Y.Z`
format. If its current version has never been tagged, the first release uses
that version unchanged. Otherwise, the workflow increments the requested
SemVer part, commits `chore: release vX.Y.Z` back to `canary`, builds images from
that exact commit, and creates the GitHub tag and release only after both image
builds succeed.

A successful versioned release publishes:

- Application: `vX.Y.Z`, `latest`, and `custom`
- Monitoring: `monitoring-vX.Y.Z`, `monitoring-latest`, and
  `monitoring-custom`

Do not report the release as complete until the release workflow, version tag,
GitHub release, and versioned image build are all confirmed.

To pin an installation to a stable release instead of the moving canary tag:

```bash
curl -sSL https://raw.githubusercontent.com/realsannimith/dokploy-pro/canary/install.sh \
  | DOKPLOY_TAG=vX.Y.Z bash -s update
```

Use the same command with an earlier published version to roll back. The
installer carries that selected tag into `RELEASE_TAG`, so later in-app updates
remain on the pinned release channel.

### Fork-specific cautions

- Use `build-image.yml` and `release.yml` for this fork. Do not use the upstream
  Docker Hub deployment workflow in `.github/workflows/deploy.yml`; it is
  manually disabled here and depends on upstream secrets.
- Never overwrite `custom`, `latest`, or version tags manually. Let the GitHub
  workflows produce all application and monitoring tags together.
- Record the commit SHA and workflow URL in the final handoff so the published
  artifact can be traced to its source.
