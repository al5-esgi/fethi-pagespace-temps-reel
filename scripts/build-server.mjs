import { build } from 'esbuild'
await build({ entryPoints: ['src/server.ts'], outfile: 'dist/server.js', bundle: true,
  platform: 'node', target: 'node24', format: 'esm', packages: 'external' })
