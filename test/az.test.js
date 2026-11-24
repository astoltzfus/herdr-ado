import test from 'node:test';
import assert from 'node:assert/strict';
import { createAz } from '../mods/herdr-ado/core/az.js';
const r = { org: 'org', project: 'project', repo: 'repo' };
const pr = { id: 7, headSha: 'abc', projectId: 'p', repoId: 'r', checks: [], mergeStatus: 'succeeded' };
let az = createAz({});
function fake(responses) {
  const calls = [];
  const fake = { calls: () => calls, restore: () => {}, body: '', removed: false };
  az = createAz({
    run: async (_command, args) => {
      calls.push(args);
      const hit = responses.find((response) => new RegExp(response.match).test(args.join(' ')));
      if (!hit) throw new Error(`No fake response: ${args.join(' ')}`);
      return { code: hit.code || 0, stderr: hit.stderr || '', stdout: typeof hit.stdout === 'string'
        ? hit.stdout : JSON.stringify(hit.stdout ?? '') };
    },
    tempFile: async (text) => {
      fake.body = text; fake.removed = false;
      return { path: '/fake/body', remove: async () => { fake.removed = true; } };
    },
  });
  return fake;
}
test('policies, merge strategy, votes and threads', () => {
  const mapped = az.mapPolicies([
    {
      status: 'rejected',
      configuration: { type: { id: 'fa4e907d-c16b-4a4c-9dfa-4916e5d171ab' }, settings: { allowSquash: true } },
    },
    { status: 'approved', configuration: { isBlocking: true, settings: { displayName: 'CI' } } },
    { status: 'rejected', configuration: { isBlocking: false, type: { displayName: 'optional' } } },
  ]);
  assert.equal(mapped.checkState, 'pass');
  assert.equal(mapped.checks.length, 2);
  assert.equal(az.strategyFor(mapped, 'merge'), 'squash');
  assert.equal(az.reviewSummary([{ vote: -10 }]), 'rejected');
  assert.equal(az.reviewSummary([{ vote: -5 }]), 'waiting for author');
  assert.equal(az.reviewSummary([{ vote: 10 }, { vote: 0, isRequired: true }]), 'review required');
  assert.equal(az.reviewSummary([{ vote: 5, isRequired: true }]), 'approved');
  assert.equal(
    az.countThreads([
      { status: 'active', comments: [{ commentType: 'text' }] },
      { status: 'closed', comments: [{ commentType: 'text' }] },
      { status: 'pending', comments: [{ commentType: 'system' }] },
    ]),
    1,
  );
  assert.equal(az.canComplete({ ...pr, checks: [{ blocking: true, state: 'skip' }] }), false);
});
test('errors and WIQL are mapped', () => {
  for (const [err, word] of [
    [{ code: 'ENOENT' }, 'Azure CLI not found'],
    [{ stderr: "ERROR: 'devops' is not in the 'az' command group" }, 'extension missing'],
    [{ stderr: 'ERROR: TF400813' }, 'Not signed in'],
    [{ stderr: 'ERROR: VS2150009' }, 'Advanced Security'],
    [{ stderr: 'noise\nERROR: specific\nmore' }, 'specific'],
  ])
    assert.match(az.errorMessage(err), new RegExp(word));
  assert.match(az.wiql(["Won't"], 'Klowd Studio'), /'Won''t'/);
  // @project is unbound under `az boards query`, so the project must be a literal.
  assert.match(az.wiql(['Done'], "Bob's Project"), /\[System\.TeamProject\] = 'Bob''s Project'/);
  assert.doesNotMatch(az.wiql(['Done'], 'Klowd Studio'), /@project/);
});
test('empty output, explicit flags and changed head refusal', async () => {
  const f = fake([
    { match: 'boards query', stdout: '' },
    { match: 'repos pr show', stdout: { lastMergeSourceCommit: { commitId: 'new' } } },
  ]);
  try {
    assert.deepEqual(await az.fetchWorkItems(r, ['Done']), []);
    await assert.rejects(az.approvePr(r, pr), /changed since/);
    const args = f.calls()[0];
    for (const x of ['--org', '--project', '--only-show-errors', '--detect']) assert.ok(args.includes(x));
  } finally {
    f.restore();
  }
});
test('completion uses repos pr update, pinned to the head the user saw', async () => {
  const f = fake([
    { match: 'repos pr show', stdout: { lastMergeSourceCommit: { commitId: 'abc' } } },
    { match: 'repos pr update', stdout: {} },
  ]);
  await az.completePr(r, pr, 'squash', true, false);
  const update = f.calls().find((args) => args.includes('update'));
  assert.ok(!f.calls().some((args) => args.includes('invoke')));
  for (const [flag, value] of [['--status', 'completed'], ['--squash', 'true'], ['--delete-source-branch', 'true']])
    assert.equal(update[update.indexOf(flag) + 1], value);
});
test('completion refuses a PR pushed since it was shown', async () => {
  fake([{ match: 'repos pr show', stdout: { lastMergeSourceCommit: { commitId: 'new' } } }]);
  await assert.rejects(az.completePr(r, pr, 'noFastForward', false, false), /changed since you looked/);
});
test('auto-complete is one update call with the merge options', async () => {
  const f = fake([{ match: 'repos pr update', stdout: {} }]);
  await az.completePr(r, pr, 'noFastForward', false, true);
  assert.equal(f.calls().length, 1);
  const update = f.calls()[0];
  assert.equal(update[update.indexOf('--auto-complete') + 1], 'true');
  assert.equal(update[update.indexOf('--squash') + 1], 'false');
  assert.ok(!update.includes('--status'));
});
test('rebase completion is refused because az cannot express it', async () => {
  fake([]);
  await assert.rejects(az.completePr(r, pr, 'rebase', false, false), /browser/);
});
test('retry plan and log cleaning', () => {
  assert.equal(
    az.retryPlan({ sourceBranch: 'refs/heads/main' }, [{ type: 'Stage', result: 'failed', identifier: 'build' }]).stages
      .length,
    1,
  );
  assert.equal(az.retryPlan({ sourceBranch: 'refs/heads/main' }, []).stages.length, 0);
  assert.throws(() => az.retryPlan({ sourceBranch: 'refs/pull/1/merge' }, []), /requeue/);
});
test('failed logs retain the tail and strip timestamps and escapes', async () => {
  const f = fake([
    {
      match: 'resource logs',
      stdout: {
        value: [
          '2026-01-01T00:00:00Z first',
          '2026-01-01T00:00:01Z \u001b[31msecond\u001b[0m',
          '2026-01-01T00:00:02Z third',
        ],
      },
    },
  ]);
  try {
    const records = [
      { id: 'stage', type: 'Stage', name: 'Build' },
      { id: 'job', parentId: 'stage', type: 'Job', name: 'Linux' },
      { id: 'task', parentId: 'job', type: 'Task', name: 'Test', result: 'failed', log: { id: 3 } },
    ];
    const logs = await az.fetchRunLogs(r, { id: 9 }, records, 2);
    assert.equal(logs[0].name, 'Build › Linux › Test');
    assert.deepEqual(logs[0].lines, ['second', 'third']);
  } finally {
    f.restore();
  }
});
test('stage retry and classic queue use their distinct request bodies', async () => {
  const f = fake([{ match: 'devops invoke', stdout: {} }]);
  try {
    await az.retryRun(
      r,
      { id: 1, definitionId: 4, sourceBranch: 'refs/heads/main', sha: 'abc' },
      { stages: [{ identifier: 'build' }] },
    );
    assert.deepEqual(JSON.parse(f.body), { forceRetryAllJobs: false, state: 'retry' });
    await az.retryRun(r, { id: 1, definitionId: 4, sourceBranch: 'refs/heads/main', sha: 'abc' }, { stages: [] });
    assert.deepEqual(JSON.parse(f.body), {
      definition: { id: 4 },
      sourceBranch: 'refs/heads/main',
      sourceVersion: 'abc',
    });
  } finally {
    f.restore();
  }
});

test('each az command receives only its supported scope flags', async () => {
  const cli = fake([{ match: '.', stdout: '[]' }]);
  const scope = ['--org', 'https://dev.azure.com/org', '--only-show-errors', '-o', 'json'];
  const cases = [
    [['repos', 'pr', 'list'], true, true, true],
    [['repos', 'show'], true, true, true],
    [['repos', 'list'], true, true, true],
    [['boards', 'query'], true, true, true],
    [['repos', 'pr', 'show'], false, true, true],
    [['repos', 'pr', 'set-vote'], false, true, true],
    [['repos', 'pr', 'update'], false, true, true],
    [['repos', 'pr', 'policy', 'list'], false, true, true],
    [['boards', 'work-item', 'show'], false, true, true],
    [['boards', 'work-item', 'update'], false, true, true],
    [['devops', 'project', 'list'], false, true, true],
    [['devops', 'invoke'], false, true, true],
    [['devops', 'configure'], false, false, false],
    [['account', 'show'], false, false, false],
  ];
  try {
    // Run each command bare as well as with an argument: `repos list` is called with nothing after it.
    for (const [prefix, project, detect, org] of cases) {
      for (const args of [prefix, [...prefix, '--example']]) {
        await az.command(args, r);
        const expected = [
          ...args,
          ...(project ? ['--project', 'project'] : []),
          ...(detect ? ['--detect', 'false'] : []),
          ...(org ? scope : scope.slice(2)),
        ];
        assert.deepEqual(cli.calls().at(-1), expected, args.join(' '));
      }
    }
  } finally {
    cli.restore();
  }
});

test('configure INI resolves both organization URL forms', async () => {
  for (const organization of ['https://dev.azure.com/contoso/', 'https://contoso.visualstudio.com/']) {
    const cli = fake([
      { match: '^devops configure', stdout: `[defaults]\norganization = ${organization}\nproject = Klowd Studio\n` },
      { match: '^repos show', stdout: { id: 'repo-id' } },
    ]);
    try {
      const freshAz = az;
      assert.deepEqual(await freshAz.findReposByName('repo'), [
        { org: 'contoso', project: 'Klowd Studio', repo: 'repo' },
      ]);
      assert.deepEqual(cli.calls()[0], ['devops', 'configure', '--list', '--only-show-errors']);
    } finally {
      cli.restore();
    }
  }
});

test('logs walk through phase to stage and hide implicit names', async () => {
  const cli = fake([{ match: 'resource logs', stdout: { value: ['line'] } }]);
  try {
    const records = [
      { id: 'stage', type: 'Stage', name: '__default' },
      { id: 'phase', parentId: 'stage', type: 'Phase', name: 'Phase' },
      { id: 'job', parentId: 'phase', type: 'Job', name: 'Job' },
      { id: 'task', parentId: 'job', type: 'Task', name: 'Tests', result: 'failed', log: { id: 1 } },
    ];
    assert.equal((await az.fetchRunLogs(r, { id: 1 }, records, 300))[0].name, 'Tests');
    records[0].name = 'Build';
    records[2].name = 'Linux';
    assert.equal((await az.fetchRunLogs(r, { id: 1 }, records, 300))[0].name, 'Build › Linux › Tests');
  } finally {
    cli.restore();
  }
});

test('alerts use the CLI-compatible preview version', async () => {
  const cli = fake([
    { match: '^repos show', stdout: { id: 'id', project: { id: 'project-id' } } },
    { match: '^devops invoke', stdout: { value: [] } },
  ]);
  try {
    await az.fetchAlerts({ org: 'alerts-org', project: 'project', repo: 'repo' });
    const args = cli.calls().at(-1);
    assert.equal(args[args.indexOf('--api-version') + 1], '7.2-preview');
  } finally {
    cli.restore();
  }
});
