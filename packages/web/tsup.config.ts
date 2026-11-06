import { defineConfig } from "tsup";
export default defineConfig([
  { entry: ["src/index.ts"], format: ["esm", "cjs"], dts: true, minify: true, clean: true, splitting: false },
  { entry: ["src/react.tsx"], format: ["esm", "cjs"], dts: true, minify: true, splitting: false, external: ["react"], banner: { js: '"use client";' } },
]);
