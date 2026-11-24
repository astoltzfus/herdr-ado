import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url)));
test('desktop manifest and package metadata', () => {
  assert.deepEqual(read('mods/herdr-ado/mod.json'), { place: 'none', focusable: true, overlay: { width: 1, height: 1 } });
  assert.equal(read('package.json').type, 'module');
  // The newest CHANGELOG entry names the current version.
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.equal(read('package.json').version, changelog.match(/^## (\S+)/m)[1]);
  assert.equal(read('mods/herdr-ado/package.json').type, 'module');
  assert.ok(existsSync(new URL('../mods/herdr-ado/main.js', import.meta.url)));
});
