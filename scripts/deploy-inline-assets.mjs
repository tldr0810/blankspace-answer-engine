#!/usr/bin/env node
/**
 * Fallback deploy for environments whose HTTPS proxy rewrites the Authorization header on
 * api.cloudflare.com (which breaks Workers Assets uploads: they authenticate with a per-upload
 * JWT). Embeds dist/client into the Worker and serves it through an ASSETS shim instead.
 *
 *   npm run build && node scripts/deploy-inline-assets.mjs
 *
 * Normal deploys (`npx wrangler deploy`, Workers Builds) don't need this.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const clientDir = join(root, 'dist/client');
const workerDir = join(root, 'dist/blankspace_answer_engine');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = {};
for (const path of walk(clientDir)) {
  const rel = '/' + relative(clientDir, path);
  if (rel === '/.assetsignore') continue;
  const ext = rel.slice(rel.lastIndexOf('.'));
  files[rel] = { type: TYPES[ext] ?? 'application/octet-stream', body: readFileSync(path).toString('base64') };
}

writeFileSync(
  join(workerDir, 'inline-entry.js'),
  `import worker from './index.js';
export { RunTicker } from './index.js';

const FILES = ${JSON.stringify(files)};

function decode(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Mirrors not_found_handling: "single-page-application".
const ASSETS = {
  async fetch(input) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    let path = url.pathname;
    if (path.endsWith('/')) path += 'index.html';
    const file = FILES[path] ?? FILES['/index.html'];
    const immutable = path.startsWith('/assets/');
    return new Response(decode(file.body), {
      headers: {
        'content-type': file.type,
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
      },
    });
  },
};

const withAssets = (env) => Object.assign(Object.create(env), { ASSETS });

export default {
  fetch: (req, env, ctx) => worker.fetch(req, withAssets(env), ctx),
  scheduled: (event, env, ctx) => worker.scheduled?.(event, withAssets(env), ctx),
};
`,
);

const config = JSON.parse(readFileSync(join(workerDir, 'wrangler.json'), 'utf8'));
delete config.assets;
config.main = 'inline-entry.js';
writeFileSync(join(workerDir, 'wrangler.inline.json'), JSON.stringify(config, null, 2));

execFileSync('npx', ['wrangler', 'deploy', '--config', join(workerDir, 'wrangler.inline.json')], {
  stdio: 'inherit',
  cwd: root,
});
