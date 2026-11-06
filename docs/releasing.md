# Release packages

Publishing requires maintainer approval. This work prepares the workflow without creating tokens, tags, or releases.

1. Run `pnpm check` on the release commit.
2. After approval, configure the `npm` GitHub environment and its approval rules. Add the approved npm token as the repository secret `NPM_TOKEN`.
3. Tag the reviewed release commit `web-v0.1.0` or `server-v0.5.0`, matching that package's manifest. Pushing a matching tag starts the release workflow for that package only.
4. Verify the npm version, provenance, and tarball contents.
5. After the first publish, configure npm trusted publishing for this repository and workflow. Replace token authentication with OIDC, then remove the token secret.

A tag runs all checks before publishing. Invalid tags and mismatched versions stop before publication. Tags are not created by CI.
