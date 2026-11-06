import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('keeps the copyable README prompt equal to AGENT_PROMPT.md', () => {
  const prompt = readFileSync('AGENT_PROMPT.md', 'utf8');
  const readme = readFileSync('README.md', 'utf8');
  expect(readme.split('```text\n')[1]?.split('```')[0]).toBe(prompt);
});
