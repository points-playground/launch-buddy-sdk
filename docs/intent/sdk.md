# Intent: Launch Buddy SDK on npm, open source

## Requirements, in Einar's words
- On the landing sign-off (2026-11-06): "the script based integration sucks imo, i think it should just be a npm package type thing? plus like a agent prompt that can be copied"
- Proposal: "A: Publish on npm. You create a free npm organisation "launch-buddy" in your tab; I publish @launch-buddy/web". Einar: "yeah lets publish on n pm and you can make a open source github repo under our org (for the sdk)"

## Done when
1. `npm install @launch-buddy/web` works, and adding one component to a Next.js root layout (or one init call in any site) records page visits in Launch Buddy, the same as the script tag does today.
2. Signups and Stripe connect through the same package family (`@launch-buddy/server` for the server helper), installed from npm, not from a file on our site.
3. The code lives in a public repo, github.com/points-playground/launch-buddy-sdk, MIT licence, with a README a founder can follow.
4. The app's setup screens and the landing page show the install command plus a copyable agent prompt; pasting that prompt into Claude Code sets up a fresh Next.js app end to end.
5. Existing sites using the script tag keep working.

## Approach
A separate public monorepo with two packages, `@launch-buddy/web` (browser tracker plus a React component) and `@launch-buddy/server` (today's server helper), published from GitHub Actions with npm provenance. Not picked: publishing from the private app repo, because you asked for an open-source repo and the app code must stay private.

## Out of scope
Packages for frameworks other than plain JS and React/Next.js, an iPhone SDK change, a docs site, and removing the script tag.
