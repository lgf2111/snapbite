import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve(process.cwd(), 'scripts/check-bundle.mjs');
const dirs: string[] = [];

function bundle(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'snapbite-bundle-'));
  dirs.push(dir);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
const run = (dir: string) => spawnSync('node', [script, dir], { encoding: 'utf8' });

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('deploy guard (scripts/check-bundle.mjs)', () => {
  it('passes a same-origin bundle', () => {
    const res = run(bundle({ 'App-x.js': 'fetch(`${""}/api/auth/me`)' }));
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('same-origin');
  });

  it('aborts when the Worker URL is baked in: the cross-site build', () => {
    const res = run(
      bundle({
        'index-x.js': 'const a=1',
        'App-x.js': 'const u="https://snapbite-worker.lgf2111.workers.dev";fetch(u+"/api/me")',
      }),
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('workers.dev');
    expect(res.stderr).toContain('App-x.js');
  });

  it('only reads scripts, not source maps or other assets', () => {
    const res = run(bundle({ 'x.js.map': 'workers.dev', 'a.css': 'workers.dev', 'ok.js': '1' }));
    expect(res.status).toBe(0);
  });
});
