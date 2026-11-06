import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const directory = fileURLToPath(new URL('../', import.meta.url));
const cache = join(directory, '.cache');
mkdirSync(cache, { recursive: true });
const root = mkdtempSync(join(cache, 'packed-consumer-'));
function run(command, args, cwd = root) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const consumer = `
const assert = require('node:assert/strict');
const web = require('@launch-buddy/web');
const { LaunchBuddy } = require('@launch-buddy/web/react');
const sdk = require('@launch-buddy/server');
const React = require('react');
const { renderToString } = require('react-dom/server');
(async () => {
  assert.equal(web.init({ projectKey: 'lb_public_test_1234567890' }), undefined);
  assert.equal(renderToString(React.createElement(LaunchBuddy, { projectKey: 'lb_public_test_1234567890' })), '');
  const events = [];
  const anonymousId = '00000000-0000-4000-8000-000000000001';
  assert.equal(sdk.anonymousIdFrom('lb_aid=' + anonymousId), anonymousId);
  const client = sdk.createLaunchBuddyServer({
    serverKey: 'lb_secret_' + 'a'.repeat(43),
    fetch: async (_url, init) => { events.push(JSON.parse(init.body)); return new Response('{"duplicate":false}', { status: 202 }); },
  });
  assert.equal((await client.verifyInstallation({ source: 'custom' })).status, 'sent');
  assert.equal((await client.signup({ userId: 'custom-user' })).status, 'sent');
  await sdk.createBetterAuthSignupAfterHook(client)({ id: 'better-auth-user' });
  assert.equal((await sdk.trackVerifiedClerkWebhook(client, { event: { type: 'user.created', data: { id: 'clerk-user' } }, webhookId: 'hook-1' })).status, 'sent');
  assert.equal((await sdk.trackVerifiedStripeEvent(client, { event: {
    id: 'stripe-1', type: 'invoice.paid', data: { object: { id: 'invoice-1', customer: 'customer-1', amount_paid: 1000, currency: 'usd' } },
  } })).status, 'sent');
  assert.deepEqual(events.map(event => event.type), ['installation', 'signup', 'signup', 'signup', 'payment']);
  assert.deepEqual(events.map(event => event.sdk.version), Array(5).fill('0.5.0'));
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('', { url: 'https://site.example/pricing?secret=hidden' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  const requests = [];
  dom.window.fetch = async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: 202 }); };
  const browser = web.init({ projectKey: 'lb_public_test_1234567890' });
  await browser.heartbeat();
  dom.window.history.pushState({}, '', '/welcome');
  await new Promise(resolve => dom.window.setTimeout(resolve, 5));
  assert.deepEqual(requests.map(request => [request.body.type, request.body.path]), [['page_view', '/pricing'], ['heartbeat', undefined], ['page_view', '/welcome']]);
  assert.equal(requests[0].url, 'https://launchbuddy.points-playground.com/api/v1/events');
  assert.equal(JSON.stringify(requests).includes('secret'), false);
  dom.window.close();
  console.log('packed consumer OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
`;
try {
  for (const name of ['web', 'server']) {
    run('npm', ['pack', '--pack-destination', root], join(directory, 'packages', name));
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, dependencies: { react: '19.2.1', 'react-dom': '19.2.1' } }));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', './launch-buddy-web-0.1.0.tgz', './launch-buddy-server-0.5.0.tgz']);
  writeFileSync(join(root, 'consumer.cjs'), consumer);
  assert.equal(run(process.execPath, ['consumer.cjs']), 'packed consumer OK\n');
  const esm = consumer.replaceAll(/const (\w+|\{[^\n]+\}) = require\('([^']+)'\);/g, 'const $1 = await import("$2");');
  writeFileSync(join(root, 'consumer.mjs'), esm);
  assert.equal(run(process.execPath, ['consumer.mjs']), 'packed consumer OK\n');
  mkdirSync(join(root, 'app/api/signup'), { recursive: true });
  writeFileSync(join(root, 'app/layout.tsx'), `import { LaunchBuddy } from '@launch-buddy/web/react';\nexport default function Layout() { return <html><body><LaunchBuddy projectKey="lb_public_test_1234567890" /></body></html>; }\n`);
  writeFileSync(join(root, 'app/api/signup/route.ts'), `import { createLaunchBuddyServer, anonymousIdFrom, trackVerifiedStripeEvent } from '@launch-buddy/server';\nconst sdk = createLaunchBuddyServer({ serverKey: 'lb_secret_' + 'a'.repeat(43) });\nexport async function POST(request: Request) { return sdk.signup({userId: 'user', anonymousId: anonymousIdFrom(request)}); }\nvoid trackVerifiedStripeEvent;\n`);
  const types = `import { init, type LaunchBuddyClient } from '@launch-buddy/web';\nimport { LaunchBuddy } from '@launch-buddy/web/react';\nimport { createLaunchBuddyServer } from '@launch-buddy/server';\nconst client: LaunchBuddyClient | undefined = init({ projectKey: 'lb_public_test_1234567890' });\nvoid client; void LaunchBuddy; void createLaunchBuddyServer;\n`;
  for (const ext of ['mts', 'cts']) writeFileSync(join(root, `consumer.${ext}`), types);
  for (const [module, resolution] of [['NodeNext', 'NodeNext'], ['Node16', 'Node16'], ['ESNext', 'bundler']]) {
    run(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--jsx', 'react-jsx', '--module', module, '--moduleResolution', resolution, '--target', 'ES2022', 'consumer.mts', 'consumer.cts', 'app/layout.tsx', 'app/api/signup/route.ts']);
  }
  for (const format of ['js', 'cjs']) assert.match(readFileSync(join(root, `node_modules/@launch-buddy/web/dist/react.${format}`), 'utf8'), /^"use client";/);
  console.log('Packed web + server: npm install, ESM, CJS, SSR, browser routes, and Next.js-like TypeScript fixture passed');
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally { rmSync(root, { recursive: true, force: true }); }
