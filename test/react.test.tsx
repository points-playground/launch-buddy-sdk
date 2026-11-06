// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { LaunchBuddy } from '../packages/web/src/react';
import { init } from '../packages/web/src/index';

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  vi.useRealTimers();
});

it('renders no markup during SSR without accessing browser APIs', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, get() { throw new Error('SSR window access'); } });
  try {
    expect(renderToString(<LaunchBuddy projectKey="lb_public_test_1234567890" />)).toBe('');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
  }
});

it('mounts once in Strict Mode and tracks History API and popstate route changes', async () => {
  vi.useFakeTimers();
  const bodies: Record<string, unknown>[] = [];
  window.fetch = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
    bodies.push(JSON.parse(String(options?.body)));
    return new Response(null, { status: 202 });
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  root = createRoot(container);
  await act(() => root!.render(<StrictMode><LaunchBuddy projectKey="lb_public_test_1234567890" /></StrictMode>));
  expect(container.innerHTML).toBe('');
  expect(bodies.map(body => [body.type, body.path])).toEqual([['page_view', '/']]);
  expect(init({ projectKey: 'lb_public_test_1234567890' })).toBe(window.LaunchBuddy);
  window.history.pushState({}, '', '/pricing?secret=hidden');
  await vi.advanceTimersByTimeAsync(0);
  window.history.replaceState({}, '', '/welcome');
  await vi.advanceTimersByTimeAsync(0);
  window.history.replaceState({}, '', '/welcome?query=changed');
  await vi.advanceTimersByTimeAsync(0);
  window.history.replaceState({}, '', '/back');
  window.dispatchEvent(new PopStateEvent('popstate'));
  await vi.advanceTimersByTimeAsync(0);
  expect(bodies.map(body => [body.type, body.path])).toEqual([
    ['page_view', '/'], ['page_view', '/pricing'], ['page_view', '/welcome'], ['page_view', '/back'],
  ]);
  await vi.advanceTimersByTimeAsync(30000);
  expect(bodies.at(-1)).toMatchObject({ type: 'heartbeat', projectKey: 'lb_public_test_1234567890' });
});
