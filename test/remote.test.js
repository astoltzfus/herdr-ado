import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRemote, resolveRemote } from '../mods/herdr-ado/core/remote.js';
test('parses ADO remote forms and rejects others', () => {
  for (const url of [
    'https://user@dev.azure.com/acme/Klowd%20Studio/_git/repo.git',
    'https://acme.visualstudio.com/DefaultCollection/Klowd%20Studio/_git/repo',
    'git@ssh.dev.azure.com:v3/acme/Klowd%20Studio/repo',
    'ssh://git@ssh.dev.azure.com:22/v3/acme/Klowd%20Studio/repo',
    'acme@vs-ssh.visualstudio.com:v3/acme/Klowd%20Studio/repo',
    'ssh://acme@vs-ssh.visualstudio.com:22/v3/acme/Klowd%20Studio/repo',
  ])
    assert.deepEqual(parseRemote(url), { org: 'acme', project: 'Klowd Studio', repo: 'repo' });
  assert.equal(parseRemote('https://github.com/acme/repo'), null);
});
test('tries upstream, origin, then other remotes', async () => {
  const calls = [];
  const runner = async (_command, args) => {
    calls.push(args);
    const joined = args.join(' ');
    const stdout = joined.endsWith('remote') ? 'origin\nupstream\nother' :
      joined.includes('rev-parse') ? 'upstream/main' : joined.includes('get-url upstream') ?
        'https://github.com/a/b' : 'https://dev.azure.com/o/p/_git/r';
    return { code: 0, stdout, stderr: '' };
  };
  assert.equal((await resolveRemote(runner, '/folder', null)).repo, 'r');
  assert.deepEqual(calls.filter((args) => args.includes('get-url')).map((args) => args.at(-1)),
    ['upstream', 'origin']);
});
