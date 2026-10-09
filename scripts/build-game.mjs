// Builds one game from its source, the way the store will serve it, and
// checks it. Used by both workflows: on a pull request to show what would be
// published, and on main to make the zip that gets published.
//
//   node scripts/build-game.mjs games/<id>.json <outDir>
//
// Writes <outDir>/<id>.zip and appends a report to $GITHUB_STEP_SUMMARY.
// Exits non-zero when a check fails. Never needs a secret: it clones and
// builds code from anyone, so it must only run where no secret is available.
//
// On a pull request, PR_AUTHOR (the pull request's author) and BASE_REF (the
// branch it targets) let it check that only a game's owner changes it.

import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

const STORE = 'https://pocketvibe-store.mertcobanov.workers.dev';
const MAINTAINERS = ['cobanov'];
const GENRES = ['Arcade', 'Shooter', 'Racing', 'Puzzle', 'Platformer', 'Sports'];
const MAX_ZIP = 50 * 1024 * 1024;
const MAX_UNPACKED = 200 * 1024 * 1024;

const [file, outArg] = process.argv.slice(2);
const out = resolve(outArg ?? 'dist');
mkdirSync(out, { recursive: true });
const failures = [];
const warnings = [];
const facts = [];
const fail = (message) => failures.push(message);

function report(title) {
  const lines = [`### ${title}`, ''];
  for (const f of facts) lines.push(`- ${f}`);
  for (const w of warnings) lines.push(`- Warning: ${w}`);
  for (const f of failures) lines.push(`- **Failed:** ${f}`);
  const text = lines.join('\n') + '\n\n';
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  console.log(text);
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...options });
}

function size(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    total += statSync(path).isDirectory() ? size(path) : statSync(path).size;
  }
  return total;
}

// ---------- The game's file in this repository ----------

const id = basename(file ?? '', '.json');
let entry;
try {
  entry = JSON.parse(readFileSync(file, 'utf8'));
} catch {
  fail(`${file} is not valid JSON.`);
}
if (entry) {
  if (entry.id !== id) fail(`"id" must be "${id}", the file's name.`);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) fail('The id must be lowercase letters, digits and dashes.');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(entry.owner ?? '')) fail('"owner" must be a GitHub username.');
  const source = entry.source ?? {};
  if (!/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(source.repo ?? '')) fail('"source.repo" must be a GitHub repository address, like https://github.com/you/your-game.');
  if (!/^[0-9a-f]{40}$/.test(source.commit ?? '')) fail('"source.commit" must be a full commit hash (40 characters).');
  const path = source.path ?? '.';
  if (typeof path !== 'string' || path.startsWith('/') || path.split('/').includes('..')) fail('"source.path" must be a folder inside the repository.');
  // The youngest age the game suits, as the App Store rates apps. The iPhone
  // app lists only games rated for its own rating, so an unrated game is
  // missing there; the maintainer sets or checks it in review.
  if (entry.age === undefined) warnings.push('No "age" (4, 9, 13, 16 or 18): the iPhone app will not list the game until it has one.');
  else if (![4, 9, 13, 16, 18].includes(entry.age)) fail('"age" must be 4, 9, 13, 16 or 18.');
  const extra = Object.keys(entry).filter((k) => !['id', 'owner', 'age', 'source'].includes(k));
  if (extra.length) fail(`Unknown fields: ${extra.join(', ')}.`);
}

// Only a game's owner (or a maintainer) changes it, and a new game belongs to
// whoever opens its pull request.
const author = process.env.PR_AUTHOR;
let before = null; // the game's file before this pull request, if it had one
if (entry && author) {
  try {
    before = JSON.parse(run('git', ['show', `origin/${process.env.BASE_REF ?? 'main'}:${file}`], { stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    // A new game.
  }
  const maintainer = MAINTAINERS.includes(author);
  if (before && before.owner !== author && !maintainer) fail(`${id} belongs to ${before.owner}; only they can update it.`);
  if (before && entry.owner !== before.owner && !maintainer) fail('A game\'s owner can only be changed by a maintainer.');
  if (!before && entry.owner !== author && !maintainer) fail(`"owner" must be ${author}, who opened this pull request.`);
}

if (failures.length) {
  report(id || file);
  process.exit(1);
}

// ---------- Build it from source ----------

const work = mkdtempSync(join(tmpdir(), 'pocketvibe-'));
const repoDir = join(work, 'repo');
const built = join(work, 'built');
let manifest;
try {
  run('git', ['init', '-q', repoDir]);
  run('git', ['-C', repoDir, 'fetch', '-q', '--depth', '1', entry.source.repo, entry.source.commit]);
  run('git', ['-C', repoDir, 'checkout', '-q', 'FETCH_HEAD']);
  const project = resolve(repoDir, entry.source.path ?? '.');
  if (project !== repoDir && !project.startsWith(repoDir + sep)) throw new Error('source.path leaves the repository');
  const manifestPath = join(project, 'pocketvibe.json');
  if (!existsSync(manifestPath)) throw new Error(`no pocketvibe.json in ${entry.source.path ?? '.'}`);
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!existsSync(join(repoDir, 'LICENSE')) && !existsSync(join(project, 'LICENSE'))) {
    warnings.push('The repository has no LICENSE file. Games in the store are open source; MIT is a good default.');
  }

  // No install scripts: a game needs its packages, not code that runs on install.
  if (!existsSync(join(project, 'package-lock.json'))) throw new Error('no package-lock.json; run npm install and commit it');
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: project, stdio: ['ignore', 'ignore', 'inherit'] });
  const vite = join(project, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(vite)) throw new Error('vite is not in the game\'s dependencies');
  run(process.execPath, [vite, 'build', '--outDir', built, '--emptyOutDir', '--logLevel', 'warn'], { cwd: project, stdio: ['ignore', 'ignore', 'inherit'] });

  // The listing and the cover sit beside the build, as the store wants them.
  writeFileSync(join(built, 'pocketvibe.json'), JSON.stringify({ entry: 'index.html', ...manifest }, null, 2));
  for (const name of ['cover.png', 'cover.jpg']) {
    if (existsSync(join(project, name))) {
      cpSync(join(project, name), join(built, name));
      break;
    }
  }
} catch (e) {
  fail(`The build failed: ${e.message.split('\n')[0]}`);
}

// ---------- Check what was built ----------

if (manifest) {
  const version = manifest.version ?? '';
  facts.push(`**${manifest.title ?? id}** ${version} by ${manifest.author || entry.owner}, from ${entry.source.repo} at \`${entry.source.commit.slice(0, 12)}\``);
  if (manifest.id !== id) fail(`pocketvibe.json says "id": "${manifest.id}", but this file is ${id}.json.`);
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail('pocketvibe.json: "version" must look like 1.0.0.');
  if (!manifest.title) fail('pocketvibe.json: "title" is missing.');
  if (!manifest.description) warnings.push('pocketvibe.json has no "description".');
  if (manifest.genre && !GENRES.includes(manifest.genre)) warnings.push(`"genre" is not one of ${GENRES.join(', ')}.`);
  if (!manifest.controls) warnings.push('pocketvibe.json has no "controls".');

  // Compared with what the store has now: a change must raise the version.
  try {
    const catalog = await (await fetch(`${STORE}/catalog.json`)).json();
    const current = catalog.games.find((g) => g.id === id);
    const parts = (v) => v.split('.').map(Number);
    const newer = (a, b) => {
      const [x, y] = [parts(a), parts(b)];
      for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
      return false;
    };
    if (!current) facts.push('A new game in the store.');
    else if (current.version === version && before && before.source?.commit !== entry.source.commit) {
      fail(`The source changed but "version" is still ${version}, the store's; raise it.`);
    } else if (current.version === version) facts.push(`Already in the store at ${version}; nothing to publish.`);
    else if (newer(version, current.version)) facts.push(`Updates the store's ${current.version} to ${version}.`);
    else fail(`The store already has ${current.version}; raise "version" above it.`);
  } catch {
    warnings.push('Could not reach the store to compare versions.');
  }
}
if (existsSync(built) && !failures.length) {
  if (!existsSync(join(built, 'cover.png')) && !existsSync(join(built, 'cover.jpg'))) fail('No cover.png (480x270) next to pocketvibe.json.');
  const entryFile = manifest?.entry || 'index.html';
  if (!existsSync(join(built, entryFile))) fail(`The build has no ${entryFile}.`);
  const unpacked = size(built);
  if (unpacked > MAX_UNPACKED) fail(`The game is ${(unpacked / 1e6).toFixed(0)} MB unpacked; the limit is 200 MB.`);
  const zip = join(out, `${id}.zip`);
  rmSync(zip, { force: true });
  run('zip', ['-qr', '-X', zip, '.'], { cwd: built });
  const zipped = statSync(zip).size;
  if (zipped > MAX_ZIP) fail(`The zip is ${(zipped / 1e6).toFixed(1)} MB; the limit is 50 MB.`);
  facts.push(`Built: ${(zipped / 1e6).toFixed(2)} MB zipped, ${(unpacked / 1e6).toFixed(2)} MB unpacked.`);
}
rmSync(work, { recursive: true, force: true });

report(manifest?.title ? `${manifest.title} (${id})` : id);
process.exit(failures.length ? 1 : 0);
