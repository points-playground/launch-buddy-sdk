# Launch Buddy SDK

Launch Buddy shows founders visits, signups, and payments during a launch. These packages send those signals from your website and server to your Launch Buddy project.

## Install

Requires Node.js 20 or later for development and server use.

```sh
npm install @launch-buddy/web
npm install @launch-buddy/server
```

Use the public key (`lb_public_…`) from your project in browser code. Store the server key (`lb_secret_…`) in `LAUNCH_BUDDY_SERVER_KEY` on your server.

The packages are prepared for npm. They are not published yet. Until the first release, build this repository and install local tarballs with `npm pack` in each package directory.

## Next.js App Router

```tsx
// app/layout.tsx
import { LaunchBuddy } from '@launch-buddy/web/react';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LaunchBuddy projectKey={process.env.NEXT_PUBLIC_LAUNCH_BUDDY_PROJECT_KEY!} />
        {children}
      </body>
    </html>
  );
}
```

Set `NEXT_PUBLIC_LAUNCH_BUDDY_PROJECT_KEY` in `.env.local` to your project's test key for local development. Use your project's live key in production. Localhost belongs on the test key, not the live key. Put `LAUNCH_BUDDY_SERVER_KEY` in `.env.local` without a `NEXT_PUBLIC_` prefix, and use the matching server key for each environment. The client component renders nothing and starts tracking after mount. It works with React 18 and 19 and is safe during server rendering. It observes History API navigation and `popstate`, so Next.js route changes need no router dependency. Query and hash changes alone do not create another page view.

Render it once. Initialization lasts for the document's lifetime, including after component unmount. React Strict Mode and repeated `init` calls reuse the first client and configuration. Use a full page reload to change projects or options. Existing script-tag installations still work; if both integrations are present, the first one initialized owns tracking.

## Plain JavaScript

```ts
import { init } from '@launch-buddy/web';

const client = init({ projectKey: import.meta.env.VITE_LAUNCH_BUDDY_PROJECT_KEY });
```

Read the key from your bundler's public environment variables. The example uses Vite's `VITE_LAUNCH_BUDDY_PROJECT_KEY`. For other bundlers, use their public environment variable support. In Next.js, keep `NEXT_PUBLIC_LAUNCH_BUDDY_PROJECT_KEY`.

`init` returns a client with `anonymousId()`, `pageView()`, `heartbeat()`, and `version`, or `undefined` on the server or for invalid options. It sends the first page view automatically. It sends heartbeats every 30 seconds while visible and when the page becomes visible.

Optional settings are `endpoint`, `debug`, and `pathPrefixes`. The default endpoint is `https://launchbuddy.points-playground.com/api/v1/events`. A path prefix matches the exact path and its slash-delimited descendants. An empty array excludes every path. With no array, all paths are tracked. Debug mode logs delivery failures. Delivery methods resolve to `sent`, `skipped`, or `failed` results.

## Server signups and Stripe

Import server helpers from `@launch-buddy/server`. There is no `@launch-buddy/web/server` export: two installs keep server dependencies and Node crypto outside the browser package.

```ts
// lib/launch-buddy.ts: import only on your server
import { createLaunchBuddyServer } from '@launch-buddy/server';

const serverKey = process.env.LAUNCH_BUDDY_SERVER_KEY;
if (!serverKey) throw new Error('Set LAUNCH_BUDDY_SERVER_KEY');
export const launchBuddy = createLaunchBuddyServer({ serverKey });
```

After your application saves a new account:

```ts
import { anonymousIdFrom } from '@launch-buddy/server';
import { launchBuddy } from './lib/launch-buddy';

await launchBuddy.signup({
  userId: createdUser.id,
  anonymousId: anonymousIdFrom(request),
});
```

The cookie is an analytics hint, never authentication evidence. Signups count without it. Keep account creation independent of tracking delivery.

In a Stripe webhook, pass the verified event only after your existing signature check:

```ts
import { trackVerifiedStripeEvent } from '@launch-buddy/server';
import { launchBuddy } from './lib/launch-buddy';

const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
const result = await trackVerifiedStripeEvent(launchBuddy, { event });
```

The helper handles `invoice.paid` and paid one-time `checkout.session.completed` events. It ignores subscription Checkout sessions to avoid counting the invoice twice. Amounts use the currency's smallest unit. Handle failed delivery in your webhook's retry policy. These helpers do not verify provider signatures.

For Better Auth, set `databaseHooks.user.create.after` to `createBetterAuthSignupAfterHook(launchBuddy)`. For Clerk, call `trackVerifiedClerkWebhook(launchBuddy, { event, webhookId })` after signature verification. For custom payment integrations, use `launchBuddy.payment({ customerId, providerEventId, transactionId, amount, currency })`. See the [server package reference](packages/server/README.md).

## Agent prompt

Copy this prompt into your coding agent:

```text
Add Launch Buddy to this app so I can watch my launch.
1. Install @launch-buddy/web with the package manager this repo uses. Install @launch-buddy/server only if this site has a backend that records signups or payments.
2. Read the browser key from your bundler's public environment variables. For Next.js, use NEXT_PUBLIC_LAUNCH_BUDDY_PROJECT_KEY and render <LaunchBuddy projectKey={process.env.NEXT_PUBLIC_LAUNCH_BUDDY_PROJECT_KEY!} /> from @launch-buddy/web/react once in the root layout. For plain JavaScript, call init({ projectKey }) from @launch-buddy/web once in the browser. In Vite, read projectKey from import.meta.env.VITE_LAUNCH_BUDDY_PROJECT_KEY. For React with Vite, pass that key to <LaunchBuddy /> once near the root. Set the variable to my project's test key in .env.local for local development and to my project's live key in the production environment. Localhost belongs on the test key, not the live key.
3. If the backend records signups or payments, put LAUNCH_BUDDY_SERVER_KEY in .env.local without a NEXT_PUBLIC_ prefix. Use the matching test server key locally and live server key in the production server environment. Create a server-only client with createLaunchBuddyServer() from @launch-buddy/server, using LAUNCH_BUDDY_SERVER_KEY from the server environment. If the backend creates accounts, find that code (Better Auth, Clerk or your own). Right after it succeeds, call client.signup({ userId, anonymousId: anonymousIdFrom(request) }). For Better Auth, use createBetterAuthSignupAfterHook(client). For Clerk, call trackVerifiedClerkWebhook(client, { event, webhookId }) only after verifying its signature.
4. If the backend has a Stripe webhook, after the signature check passes, call trackVerifiedStripeEvent(client, { event }) with the verified event. It extracts the amount and currency. Send no emails and no card details. Never expose the server key in browser code.
5. Run the app and open the home page. Ask me to confirm that the visit shows up in Launch Buddy, since you cannot see my dashboard. If no visit shows up, pass debug: true to init (or debug={true} to <LaunchBuddy />) and reload the page to check the browser console for delivery failures. Then list every file you changed.
```

## Privacy

Browser events send the pathname, anonymous visitor and session IDs, locale, time, project key, and referrer origin. They include allowlisted campaign tags and the presence of Google, Meta, Microsoft, or X ad-click parameters. They omit query strings, hashes, full referrers, click ID values, and user agent strings. Valid setup-check tokens are sent until expiry and removed from the URL.

The browser stores `launch_buddy_visitor_id` in localStorage, mirrors it in the first-party `lb_aid` cookie for one year, and stores `launch_buddy_session_id` in sessionStorage. If storage is blocked, IDs stay in memory for this initialization. The cookie links a signup to a visit when your backend forwards it. Configure path prefixes and consent handling to match your app's requirements. Call `init` or mount the component only when tracking is allowed.

Server helpers send opaque, keyed hashes of user and Stripe identifiers, stable event IDs, timestamps, source, amount, and currency. Raw user IDs, Stripe IDs, emails, account records, and card details stay in your app. The receiving service also sees ordinary network request metadata, such as the request IP.

## Develop

```sh
pnpm install --frozen-lockfile
pnpm check
```

Checks cover type declarations, lint, legacy request parity, browser storage guards, React SSR and navigation, server behavior, packed ESM and CJS consumers, and the browser entry's gzip budget of less than 3 KB. Packed-consumer fixtures live under `.cache` in this checkout and are removed after each run.

Releases run from version tags. Publishing requires approval and uses npm trusted publishing through GitHub Actions OIDC, without an npm token. Provenance is generated automatically. See [release instructions](docs/releasing.md).

## Licence

[MIT](LICENSE).
