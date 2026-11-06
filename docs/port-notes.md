# SDK port

Source: points-playground/launch-buddy, origin/main at `44df25fa696fbbca7e8b16187d894fb097931c8c` (2026-11-06).

The server source and behavior tests were copied from `packages/server`. A filtered history import would pull unrelated private monorepo history into a new public repository. This copy records the exact source instead. The server version changes from 0.4.1 to 0.5.0 and requires Node 20. Runtime exports and API remain unchanged. Tests retain provider, identity, retry, and privacy assertions. Private contract-package schema assertions were replaced by the existing explicit payload assertions; the private contracts package is not shipped.

The browser source comes from `apps/web/public/sdk/v1.js`. The original script is retained as a test fixture. Typed `init` replaces script-attribute parsing. Options expose endpoint, debug, and path-prefix filtering. The default endpoint is explicit because an npm module has no script URL. The on-wire SDK name stays `@launch-buddy/next` version `0.1.0` for parity. Its globals, singleton, cookie, storage behavior, check-token handling, campaign filtering, heartbeat, and history hooks remain compatible with v1.js.

React is a thin effect adapter with a preserved `use client` directive. It has no Next.js dependency. Document-lifetime tracking intentionally survives unmount, as the script does, and repeated initialization reuses the first client.

Decided: two installs, because server crypto and credentials belong in a separate package. To undo: add a server re-export in a later version.

## Verification plan

- Blocking first steps: pin the source and preserve the browser fixture before changing it.
- Independent workstreams: n/a, one implementation owner with tightly coupled package and fixture changes.
- Shared mutable state: a document-level browser singleton matches v1.js and prevents duplicate Strict Mode tracking.
- Smallest safe decomposition: browser parity, server port, then actual tarball consumers and release configuration.

Model the Domain shaped typed options, event payloads, client methods, and delivery outcomes. Boundary Discipline keeps browser storage guards and network failures at their existing boundaries. Laziness Protocol keeps the React component independent of framework routers. Test Behavior Not Implementation and Prove It Works require running actual packed exports as ESM and CommonJS, rather than checking source text alone.

Architecture alternatives: a fresh browser rewrite with a framework router adapter, or a typed port of the hosted tracker with History API observation. The typed port keeps the wire contract testable against the exact fixture and avoids Next.js as a browser dependency. A new router adapter would duplicate the same navigation ownership.
