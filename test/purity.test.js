import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
const root = new URL('../mods/herdr-ado/', import.meta.url);
test('shared logic uses only the runtime-neutral APIs', () => {
  const files = readdirSync(new URL('core/', root)).filter((name) => name.endsWith('.js'))
    .map((name) => `core/${name}`).concat('ui/logic.js');
  const forbidden = new RegExp('\\brequire\\s*\\(|(?:from|import\\s*\\()\\s*[\"\']' +
    '(?:node:|fs|os|path|child_process)|\\bsetTimeout\\b|\\bsetInterval\\b|' +
    '\\bprocess\\.|\\bBuffer\\b|\\bnew\\s+URL\\b');
  for (const file of files) assert.doesNotMatch(readFileSync(new URL(file, root), 'utf8'), forbidden, file);
});
