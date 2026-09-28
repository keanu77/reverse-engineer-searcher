import { access, cp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const source = new URL('../frontend/dist/', import.meta.url);
const destination = new URL('../backend/public/', import.meta.url);
// Check the completed build before replacing this ignored, generated directory.
await access(new URL('index.html', source));
let sha = [process.env.GIT_SHA, process.env.GIT_COMMIT_SHA, process.env.ZEABUR_GIT_COMMIT_SHA, process.env.SOURCE_COMMIT].find(value => /^[a-f0-9]{40}$/i.test(value || ''));
if (!sha) {
  try { sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { sha = 'unknown'; }
}
await writeFile(new URL('version.json', source), JSON.stringify({ sha, builtAt: new Date().toISOString() }) + '\n');
await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
console.log('Published current frontend build; removed obsolete bundles.');
