# @launch-buddy/web

Browser visits and SPA navigation for Launch Buddy, with no runtime dependencies. React support uses an optional React peer dependency.

```sh
npm install @launch-buddy/web
```

```ts
import { init } from '@launch-buddy/web';
init({ projectKey: 'lb_public_your_project_key' });
```

For React or Next.js App Router:

```tsx
import { LaunchBuddy } from '@launch-buddy/web/react';
<LaunchBuddy projectKey="lb_public_your_project_key" />
```

Replace the placeholder with your project's public key. Mount once in your root layout. The component renders nothing and starts in a client effect. Initialization lasts for the document's lifetime. Repeated calls reuse the first configuration.

Options: `projectKey`, `endpoint?`, `pathPrefixes?`, `debug?`. The client exposes `anonymousId()`, `pageView()`, `heartbeat()`, and `version`. Imports and `init` are safe on the server; `init` returns `undefined` there. History API changes and `popstate` trigger page views when the pathname changes. Browser events preserve the hosted v1.js contract, including its legacy SDK name.

Install `@launch-buddy/server` separately for signup and payment helpers. Never expose a server key in browser code.

See the [setup, API, and privacy guide](https://github.com/points-playground/launch-buddy-sdk#readme).

## Licence

MIT.
