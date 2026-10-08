// Publishes the zips the build job made to the store. It runs with the
// store's token, so it never runs a game's code: it only reads each zip's
// pocketvibe.json and sends the zip with the owner named in this repository.
//
//   POCKETVIBE_STORE_TOKEN=... node scripts/publish-games.mjs <dir>

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const STORE = 'https://pocketvibe-store.mertcobanov.workers.dev';
const dir = process.argv[2] ?? 'dist';
const token = process.env.POCKETVIBE_STORE_TOKEN;
if (!token) {
  console.error('POCKETVIBE_STORE_TOKEN is not set.');
  process.exit(1);
}

const zips = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.zip')) : [];
const lines = ['### Published', ''];
let failed = false;
for (const name of zips) {
  const id = basename(name, '.zip');
  try {
    // The owner comes from this repository, never from what a build wrote.
    const entry = JSON.parse(readFileSync(join('games', `${id}.json`), 'utf8'));
    const manifest = JSON.parse(execFileSync('unzip', ['-p', join(dir, name), 'pocketvibe.json'], { encoding: 'utf8' }));
    if (manifest.id !== id || entry.id !== id) throw new Error(`the zip is for "${manifest.id}", not ${id}`);
    const data = readFileSync(join(dir, name));
    const res = await fetch(`${STORE}/api/ci/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-PocketVibe-Owner': entry.owner, 'Content-Type': 'application/zip' },
      body: data,
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.error ?? res.statusText);
    lines.push(`- ${manifest.title} (${id}) ${manifest.version}: ${result.message}`);
  } catch (e) {
    failed = true;
    lines.push(`- **${id}: ${e.message}**`);
  }
}
if (!zips.length) lines.push('- Nothing to publish.');
const text = lines.join('\n') + '\n';
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
console.log(text);
process.exit(failed ? 1 : 0);
