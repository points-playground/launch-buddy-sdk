import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
for (const name of ['index.js', 'index.cjs', 'react.js', 'react.cjs']) {
  const source = readFileSync(new URL(`../packages/web/dist/${name}`, import.meta.url));
  const bytes = gzipSync(source).length;
  console.log(`${name}: ${source.length} bytes, ${bytes} bytes gzip`);
  if (name === 'index.js' && bytes >= 3072) throw new Error('Browser entry exceeds 3 KB gzip');
}
