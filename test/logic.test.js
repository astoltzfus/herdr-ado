import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adoPaneIds, blockedBy, confirmTitle, confirmVerb, existingPanel, filtered, keyAction, newPaneId, promptText,
  pruneRegistry, runIcon, select, terminalName, terminalPlan, viewTitle,
}
  from '../mods/herdr-ado/ui/logic.js';
const repo = { org: 'org', project: 'Project', repo: 'Repo', machine: null };
test('pane helpers identify new panels and ignore unregistered panes', () => {
  const panes = [
    { pane: 'main', mod: 'herdr-ado', tab: 'a' },
    { pane: 'detail', mod: 'herdr-ado', tab: 'a' },
    { pane: 'other', mod: 'herdr-ado', tab: 'b' },
    { pane: 'terminal', tab: 'a' },
  ];
  assert.deepEqual(adoPaneIds([], 'a'), []);
  assert.deepEqual(adoPaneIds(panes, 'a'), ['main', 'detail']);
  assert.deepEqual(adoPaneIds(panes, 'missing'), []);
  assert.equal(newPaneId([], [], 'a'), null);
  assert.equal(newPaneId(['main', 'detail'], panes, 'a'), null);
  assert.equal(newPaneId(['main'], panes, 'a'), 'detail');
  assert.equal(newPaneId([], panes, 'b'), 'other');
  assert.equal(existingPanel('main', panes, [], 'a'), null);
  assert.equal(existingPanel('main', panes, ['stale', 'other', 'main'], 'a'), null);
  assert.equal(existingPanel('detail', panes, ['stale', 'other', 'main'], 'a'), 'main');
  const registry = ['stale', 'other', 'main'];
  assert.deepEqual(pruneRegistry(registry, panes, 'main'), ['other', 'main']);
  assert.deepEqual(pruneRegistry(registry, panes, 'new'), ['other', 'main', 'new']);
  assert.deepEqual(pruneRegistry(registry, []), []);
  assert.deepEqual(registry, ['stale', 'other', 'main']);
});
test('selection, filters, and keyboard actions', () => {
  assert.equal(select(0, -1, 3), 0);
  assert.equal(select(0, Infinity, 3), 2);
  assert.equal(filtered([{ isReviewer: true, myVote: 0 }, { isAuthor: true }], 0, true, false).length, 1);
  const runs = [{ status: 'completed', result: 'failed' }, { status: 'inProgress' }];
  assert.equal(filtered(runs, 1, false, true).length, 1);
  assert.equal(keyAction('c', 0), 'policies');
  assert.equal(keyAction('c', 2), 'comment');
  assert.equal(keyAction('R', 1), 'retry');
});
test('prompts and blocking', () => {
  const pr = { id: 1, title: 'Title', checks: [{ name: 'Build', blocking: true, state: 'fail' }] };
  assert.equal(blockedBy(pr), 'Build');
  assert.match(promptText('complete', pr, { auto: true, strategy: 'merge' }), /merge.*blocked by: Build/);
  assert.equal(promptText('approve', pr), 'approve #1 Title');
});
test('run icons distinguish completed results and pending runs', () => {
  const cases = [
    [{ status: 'completed', result: 'succeeded' }, { icon: '✓', state: 'pass' }],
    [{ status: 'completed', result: 'failed' }, { icon: '✗', state: 'fail' }],
    [{ status: 'completed', result: 'partiallySucceeded' }, { icon: '✗', state: 'fail' }],
    [{ status: 'completed', result: 'canceled' }, { icon: '⊘', state: 'skip' }],
    [{ status: 'completed', result: 'other' }, { icon: '✓', state: 'pass' }],
    [{ status: 'queued' }, { icon: '●', state: 'pending' }],
    [{ status: 'inProgress' }, { icon: '●', state: 'pending' }],
  ];
  for (const [run, expected] of cases) assert.deepEqual(runIcon(run), expected);
});
test('view titles identify each kind and run outcome', () => {
  const row = { id: 42, title: 'Fix it', type: 'Bug', pipeline: 'Build', number: 7 };
  assert.equal(viewTitle('pr', row), 'PR #42 · Fix it');
  assert.equal(viewTitle('policies', row), 'Policies · PR #42');
  assert.equal(viewTitle('workitem', row), 'Bug #42 · Fix it');
  assert.equal(viewTitle('run', { ...row, status: 'completed', result: 'failed' }), 'Logs · Build #7');
  assert.equal(viewTitle('run', { ...row, status: 'completed', result: 'succeeded' }), 'Run · Build #7');
});
test('terminal planner reuses a live terminal or starts with exact arguments', () => {
  const live = terminalPlan(repo, { folder: '/work' }, '', '/app', { state: 'live', address: 't1' });
  assert.equal(live[0].name, 'pane.focus');
  assert.equal(live[0].fallback.name, 'terminal.keep');
  const plan = terminalPlan(repo, { folder: '/work' }, '/bin/node', '/app', null);
  assert.deepEqual(plan[0].args, ['run', '--bg', '--json', '--no-parent', '--outlive-parent', '--no-notify',
    '--name', 'ado-project-repo', '--label', 'app=herdr-ado', '--label', 'herdr-ado.repo=org/Project/Repo',
    '--cwd', '/work', '--', '/bin/node', '/app/mods/herdr-ado/terminal/panel.js', 'org/Project/Repo']);
  assert.equal(plan[1].args.terminal, '$address');
  const long = terminalName({ ...repo, repo: 'a'.repeat(100) });
  assert.equal(long.length, 32);
  assert.match(long, /^[a-z0-9_-]+$/);
  assert.notEqual(long, terminalName({ ...repo, repo: `${'a'.repeat(99)}b` }));
});

test('cwd follows the focused terminal, remembered location, active tab, then space folder', async () => {
  const { chooseCwd } = await import('../mods/herdr-ado/ui/logic.js');
  const space = { id: 's', folder: '/default', tabs: [{ id: 'tab', active: true }] };
  const panes = [
    { tab: 'other', terminal: 'x', cwd: '/wrong', focused: true },
    { tab: 'tab', terminal: 'a', cwd: '/first' },
    { tab: 'tab', terminal: 'b', cwd: '/focused', focused: true },
    { tab: 'tab', terminal: null, cwd: '/mod' },
  ];
  assert.equal(chooseCwd(space, { space: 's', terminal: 'x', cwd: '/live' }, '/last', panes), '/live');
  assert.equal(chooseCwd(space, { space: 's', terminal: null, cwd: null }, '/last', panes), '/last');
  assert.equal(chooseCwd(space, { space: 'other', terminal: 'x', cwd: '/else' }, null, panes), '/focused');
  assert.equal(chooseCwd(space, null, null, [panes[1]]), '/first');
  assert.equal(chooseCwd(space, null, null, []), '/default');
  assert.equal(chooseCwd({ ...space, folder: '' }, null, null, []), null);
});

test('confirmation titles and verbs cover every action', () => {
  const row = { id: 42, pipeline: 'Build', number: 7 };
  const cases = [
    ['approve', {}, 'Approve PR #42?', 'Approve'],
    ['complete', { auto: false }, 'Complete PR #42?', 'Complete'],
    ['complete', { auto: true }, 'Set auto-complete on PR #42?', 'Set auto-complete'],
    ['retry', {}, 'Retry Build #7?', 'Retry'],
    ['state', { state: 'Done' }, 'Move #42 to Done?', 'Move'],
    ['comment', {}, 'Post comment on #42?', 'Post'],
  ];
  for (const [action, extra, title, verb] of cases) {
    assert.equal(confirmTitle(action, row, extra), title);
    assert.equal(confirmVerb(action, extra), verb);
  }
});
