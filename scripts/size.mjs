import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const bytes = gzipSync(readFileSync(new URL('../packages/web/dist/index.js', import.meta.url))).length;
console.log(`Browser entry: ${bytes} bytes gzip (budget: <3072 bytes)`);
if (bytes >= 3072) throw new Error('Browser entry exceeds 3 KB gzip');
