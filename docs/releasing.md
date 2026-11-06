# Release packages

Publishing requires maintainer approval. The release workflow uses npm trusted publishing through GitHub Actions OIDC, without an npm token.

1. Run `pnpm check` on the release commit with Node.js 24. The release job uses Node.js 24, which includes npm CLI 11.5.1 or later for trusted publishing. CI checks both Node.js 20 and 24.
2. Verify the `npm` GitHub environment and its approval rules. Both packages must have an npm trusted publisher for GitHub Actions with owner `points-playground`, repository `launch-buddy-sdk`, workflow `release.yml`, environment `npm`, and `npm publish` allowed.
3. Tag the reviewed release commit `web-v0.1.0` or `server-v0.5.0`, matching that package's manifest. Pushing a matching tag starts the release workflow for that package only.
4. Verify the npm version, provenance, and tarball contents.

Provenance is generated automatically by [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/). The workflow keeps `id-token: write` so npm can authenticate through OIDC.

A tag runs all checks before publishing. The tagged commit must be an ancestor of `main`. Invalid tags and mismatched versions stop before publication. Tags are not created by CI.
