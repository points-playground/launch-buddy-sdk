import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { maxWorkers: Number(process.env.WORKQ_CPUS ?? 4) } });
