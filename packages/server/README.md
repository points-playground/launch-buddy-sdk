# @launch-buddy/server

Server-side signup and payment reporting for Launch Buddy. Never import this package into browser code.

## Install

```sh
npm install @launch-buddy/server
```

Requires Node.js 20 or later. Version 0.5.0 preserves the 0.4.1 API. See the [root guide](https://github.com/points-playground/launch-buddy-sdk#server-signups-and-stripe) for signup and Stripe examples.

## Create a client

```ts
import { createLaunchBuddyServer } from '@launch-buddy/server';

const serverKey = process.env.LAUNCH_BUDDY_SERVER_KEY;
if (!serverKey) throw new Error('Set LAUNCH_BUDDY_SERVER_KEY');
const client = createLaunchBuddyServer({ serverKey });
await client.signup({ userId: 'your-internal-user-id' });
```

Options: `serverKey` (required), `endpoint`, and `fetch`. The default endpoint is `https://launchbuddy.points-playground.com/api/v1/server/events`.

## API

- `client.signup({ userId, source?, idempotencyKey?, occurredAt?, anonymousId?, sessionId? })`. Sources: `better-auth`, `clerk`, or `custom` (default). The default idempotency key derives from source and user ID.
- `client.payment({ customerId, providerEventId, transactionId, amount, currency, occurredAt? })`. Amount is a positive safe integer in the currency's smallest unit. Currency is a three-letter code.
- `client.verifyInstallation({ source })`. Sends a non-counting installation handshake. Source also accepts `stripe`.
- `anonymousIdFrom(request | headers | cookieString)`. Reads a single valid UUID from the `lb_aid` cookie. Returns `undefined` for missing, malformed, or ambiguous cookies.
- `createBetterAuthSignupAfterHook(client, { getJourneyIdentifiers? }?)`. Connect to `databaseHooks.user.create.after`. It reads the request cookie when available and isolates tracking failures from account creation.
- `trackVerifiedClerkWebhook(client, { event, webhookId, journey? })`. Tracks `user.created` after your signature check. Reads `launchBuddyAnonymousId` from user unsafe metadata when available.
- `trackVerifiedStripeEvent(client, { event })`. Tracks `invoice.paid` and paid one-time Checkout sessions after your signature check. Ignores subscription Checkout sessions.

Delivery methods return `{ status: 'sent', eventId, duplicate, newCustomer? }` or `{ status: 'failed', reason, statusCode? }`. Provider adapters can also return `{ status: 'ignored' }`. Reasons: `invalid_input`, `network_error`, or `http_rejected`. Handle delivery failures according to your app's retry policy.

Provider helpers do not authenticate webhooks. Keep the server key on the backend. Identifiers are hashed with that key before transport. Do not pass emails or card details. Browser journey IDs are untrusted analytics hints.

## Licence

MIT.
