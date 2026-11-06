import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const compiler = require.resolve("typescript/bin/tsc");
const directory = new URL("../", import.meta.url);
rmSync(new URL("dist/", directory), { recursive: true, force: true });
for (const config of ["tsconfig.build.json", "tsconfig.cjs.json"]) {
  execFileSync(process.execPath, [compiler, "-p", config], { cwd: directory, stdio: "inherit" });
}
writeFileSync(new URL("dist/cjs/package.json", directory), '{"type":"commonjs"}\n');
