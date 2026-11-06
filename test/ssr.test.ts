import { expect, it } from 'vitest';
import { init } from '../packages/web/src/index';
it('can import and call init on a server without browser globals', () => {
  expect(init({ projectKey: 'lb_public_test_1234567890' })).toBeUndefined();
});
