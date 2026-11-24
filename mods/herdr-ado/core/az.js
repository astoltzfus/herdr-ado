const PR_CONCURRENCY = 6;
const REPO_CONCURRENCY = 4;
const MERGE_STRATEGY_POLICY_ID = 'fa4e907d-c16b-4a4c-9dfa-4916e5d171ab';
import { sanitize } from '../terminal/text.js';
const orgUrl = (r) => `https://dev.azure.com/${encodeURIComponent(r.org)}`;
const webBase = (r) => `${orgUrl(r)}/${encodeURIComponent(r.project)}`;
const repoBase = (r) => `${webBase(r)}/_git/${encodeURIComponent(r.repo)}`;
// The Azure DevOps extension exposes different scope flags on each command.
// Values are [project, detect, org], in command-prefix order.
const COMMAND_FLAGS = [
  ['repos pr policy list', false, true, true],
  ['repos pr set-vote', false, true, true],
  ['repos pr update', false, true, true],
  ['repos pr show', false, true, true],
  ['repos pr list', true, true, true],
  ['repos show', true, true, true],
  ['repos list', true, true, true],
  ['boards query', true, true, true],
  ['boards work-item show', false, true, true],
  ['boards work-item update', false, true, true],
  ['devops project list', false, true, true],
  ['devops invoke', false, true, true],
  ['devops configure', false, false, false],
  ['account show', false, false, false],
];

export function createAz({ run, tempFile }) {
// ---------------------------------------------------------------- runner

class AzError extends Error {
  constructor(result) {
    super(result.stderr || `Azure CLI exited with code ${result.code}`);
    this.name = 'AzError';
    this.code = result.code;
    this.stderr = result.stderr;
  }
}

async function command(args, repo, options = {}) {
  // Match bare commands without matching longer command names.
  const joined = `${args.join(' ')} `;
  const spec = COMMAND_FLAGS.find(([prefix]) => joined.startsWith(`${prefix} `));
  if (!spec) throw new Error(`Unsupported az command: ${args.join(' ')}`);
  const [, project, detect, org] = spec;
  const flags = [
    ...(project && repo?.project ? ['--project', repo.project] : []),
    ...(detect ? ['--detect', 'false'] : []),
    ...(org && repo?.org ? ['--org', orgUrl(repo)] : []),
    '--only-show-errors',
    ...(options.raw ? [] : ['-o', options.tsv ? 'tsv' : 'json']),
  ];
  const result = await run('az', [...args, ...flags], { timeout: options.timeout });
  if (result.code !== 0) throw new AzError(result);
  const { stdout } = result;
  if (options.raw || options.tsv) return stdout.trim();
  // Boards query emits no JSON at all when there are no matching work items.
  return stdout.trim() ? JSON.parse(stdout) : [];
}

function errorMessage(err) {
  const raw = String(err.stderr || err.message || err);
  if (err.code === 'ENOENT') return 'Azure CLI not found: install it (https://aka.ms/azcli) and run az login';
  if (/VS2150009/i.test(raw)) return 'Advanced Security is not enabled for this repository';
  if (/not in the 'az' command group|misspelled|unrecognized.*(?:devops|repos)/i.test(raw))
    return 'Azure DevOps extension missing: az extension add --name azure-devops';
  if (/az login|TF400813|\b401\b|AADSTS/i.test(raw))
    return 'Not signed in to Azure DevOps: run az login, or az devops login with a PAT';
  return (raw.split('\n').find((line) => /^\s*ERROR:/.test(line)) || raw.split('\n')[0])
    .replace(/^\s*ERROR:\s*/, '')
    .trim();
}

async function invoke(r, area, resource, routes, { method, body, query, version = '7.1', timeout } = {}) {
  const args = [
    'devops',
    'invoke',
    '--area',
    area,
    '--resource',
    resource,
    '--route-parameters',
    ...Object.entries(routes).map(([k, v]) => `${k}=${v}`),
    '--api-version',
    version,
  ];
  if (query) args.push('--query-parameters', ...Object.entries(query).map(([k, v]) => `${k}=${v}`));
  if (method) args.push('--http-method', method);
  let file;
  try {
    if (body !== undefined) {
      file = await tempFile(JSON.stringify(body));
      args.push('--in-file', file.path);
    }
    return await command(args, r, { timeout });
  } finally {
    if (file) await file.remove();
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
const value = (v) => (Array.isArray(v) ? v : v?.value || v?.comments || []);
let defaultsPromise;
const repoCache = new Map();
const userCache = new Map();
const stateCache = new Map();
let allReposPromise;
// ---------------------------------------------------------------- identity

async function defaults() {
  defaultsPromise ??= command(['devops', 'configure', '--list'], null, { raw: true })
    .then((output) => {
      // Configure emits INI even when JSON output is requested.
      const entries = Object.fromEntries(
        output
          .split('\n')
          .map((line) => line.match(/^\s*([^=]+?)\s*=\s*(.*?)\s*$/))
          .filter(Boolean)
          .map((match) => [match[1], match[2]]),
      );
      if (!entries.organization) return { org: '', project: entries.project };
      const match = entries.organization.match(
        /^https?:\/\/(?:dev\.azure\.com\/([^/]+)|([^.\/]+)\.visualstudio\.com)/i,
      );
      const org = match?.[1] || match?.[2] || '';
      return { org: decodeURIComponent(org || ''), project: entries.project };
    })
    .catch((e) => {
      defaultsPromise = undefined;
      throw e;
    });
  return defaultsPromise;
}

async function findReposByName(name) {
  const d = await defaults();
  if (!d.org || !d.project) return [];
  const r = { ...d, repo: name };
  try {
    const found = await command(['repos', 'show', '--repository', name], r);
    if (found?.id) return [r];
  } catch (e) {
    if (!/404|not found|does not exist/i.test(errorMessage(e))) throw e;
  }
  allReposPromise ??= (async () => {
    const projects = value(await command(['devops', 'project', 'list', '--top', '10000'], r));
    return (
      await mapLimit(projects, REPO_CONCURRENCY, async (p) =>
        value(await command(['repos', 'list'], { ...r, project: p.name })).map((x) => ({ ...x, projectName: p.name })),
      )
    ).flat();
  })().catch((e) => {
    allReposPromise = undefined;
    throw e;
  });
  return (await allReposPromise)
    .filter((x) => x.name?.toLowerCase() === name.toLowerCase())
    .sort(
      (a, b) =>
        Number(b.projectName === d.project) - Number(a.projectName === d.project) ||
        String(b.lastUpdateTime || b.pushedAt || '').localeCompare(String(a.lastUpdateTime || a.pushedAt || '')),
    )
    .map((x) => ({ org: d.org, project: x.projectName, repo: x.name }));
}

async function repoInfo(r) {
  const key = JSON.stringify(r);
  if (!repoCache.has(key))
    repoCache.set(
      key,
      command(['repos', 'show', '--repository', r.repo], r).catch((e) => {
        repoCache.delete(key);
        throw e;
      }),
    );
  return repoCache.get(key);
}
// The CLI resolves `me`; both lookups are optional so refreshes can still work.
async function whoAmI(r) {
  if (!userCache.has(r.org))
    userCache.set(
      r.org,
      Promise.allSettled([
        command(['repos', 'pr', 'list', '--creator', 'me', '--status', 'all', '--top', '1'], r),
        command(['account', 'show', '--query', 'user.name'], null, { tsv: true }),
      ]).then(([p, e]) => ({
        id: p.status === 'fulfilled' ? p.value[0]?.createdBy?.id : undefined,
        email: e.status === 'fulfilled' ? e.value.toLowerCase() : undefined,
      })),
    );
  return userCache.get(r.org);
}
const isMe = (identity, me) =>
  !!identity &&
  !!me &&
  ((me.id && identity.id === me.id) ||
    ((!me.id || !identity.id) && me.email && identity.uniqueName?.toLowerCase() === me.email));
// ---------------------------------------------------------------- PRs

function reviewSummary(reviewers = []) {
  if (reviewers.some((x) => x.vote === -10)) return 'rejected';
  if (reviewers.some((x) => x.vote === -5)) return 'waiting for author';
  if (reviewers.some((x) => x.vote >= 5) && reviewers.filter((x) => x.isRequired).every((x) => x.vote >= 5))
    return 'approved';
  return 'review required';
}
const checkState = (p) =>
  ({
    approved: 'pass',
    rejected: 'fail',
    broken: 'fail',
    queued: 'pending',
    running: 'pending',
    notApplicable: 'skip',
  })[p.status] || 'pending';
const isStrategy = (p) =>
  p.configuration?.type?.id?.toLowerCase() === MERGE_STRATEGY_POLICY_ID ||
  p.configuration?.type?.displayName === 'Require a merge strategy';
const policyName = (p) =>
  p.configuration?.settings?.displayName ||
  p.context?.buildDefinitionName ||
  p.configuration?.settings?.statusName ||
  p.configuration?.type?.displayName ||
  '?';
function mapPolicies(policies) {
  // Merge-strategy policy is satisfied at completion and is not a CI check.
  const strategy = policies.find(isStrategy);
  const settings = strategy?.configuration?.settings;
  const checks = policies
    .filter((p) => !isStrategy(p))
    .map((p) => ({
      name: policyName(p),
      state: checkState(p),
      blocking: !!p.configuration?.isBlocking,
      buildId: p.context?.buildId,
    }));
  const blocking = checks.filter((c) => c.blocking);
  const checkStateOverall = !blocking.length
    ? 'none'
    : ['fail', 'pending'].find((s) => blocking.some((c) => c.state === s)) || 'pass';
  return {
    checks,
    checkState: checkStateOverall,
    allowedStrategies: settings
      ? {
          squash: !!settings.allowSquash,
          noFastForward: !!settings.allowNoFastForward,
          rebase: !!settings.allowRebase,
          rebaseMerge: !!settings.allowRebaseMerge,
        }
      : undefined,
  };
}
const countThreads = (threads) =>
  threads.filter(
    (t) =>
      !t.isDeleted &&
      ['active', 'pending'].includes(String(t.status).toLowerCase()) &&
      t.comments?.some((c) => !c.isDeleted && c.commentType === 'text'),
  ).length;
async function fetchThreads(r, pr) {
  return value(
    await invoke(r, 'git', 'pullRequestThreads', {
      project: pr.projectId,
      repositoryId: pr.repoId,
      pullRequestId: pr.id,
    }),
  );
}

async function fetchPolicies(r, pr) {
  return value(await command(['repos', 'pr', 'policy', 'list', '--id', String(pr.id)], r));
}

function toPr(p, r, me) {
  return {
    id: p.pullRequestId,
    title: p.title,
    author: p.createdBy?.displayName || '',
    isAuthor: isMe(p.createdBy, me),
    isDraft: p.isDraft,
    url: `${repoBase(r)}/pullrequest/${p.pullRequestId}`,
    headSha: p.lastMergeSourceCommit?.commitId,
    sourceBranch: p.sourceRefName,
    targetBranch: p.targetRefName,
    review: reviewSummary(p.reviewers),
    myVote: p.reviewers?.find((x) => isMe(x, me))?.vote ?? 0,
    isReviewer: !!p.reviewers?.some((x) => isMe(x, me)),
    mergeStatus: p.mergeStatus,
    autoComplete: !!p.autoCompleteSetBy,
    projectId: p.repository?.project?.id,
    repoId: p.repository?.id,
    createdAt: p.creationDate,
  };
}

async function fetchPrs(r) {
  const [prs, me] = await Promise.all([
    command(['repos', 'pr', 'list', '--repository', r.repo, '--status', 'active', '--top', '100'], r),
    whoAmI(r),
  ]);
  return (
    await mapLimit(value(prs), PR_CONCURRENCY, async (p) => {
      const pr = toPr(p, r, me);
      const [policies, threads] = await Promise.all([fetchPolicies(r, pr), fetchThreads(r, pr)]);
      return { ...pr, ...mapPolicies(policies), threads: countThreads(threads) };
    })
  ).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function showPr(r, pr) {
  return command(['repos', 'pr', 'show', '--id', String(pr.id)], r);
}

async function approvePr(r, pr) {
  const current = await showPr(r, pr);
  // Votes are not commit-pinned by ADO; rechecking immediately before voting is the closest available safeguard.
  if (current.lastMergeSourceCommit?.commitId !== pr.headSha)
    throw new Error(`#${pr.id} changed since you looked (new push), press r`);
  return command(['repos', 'pr', 'set-vote', '--id', String(pr.id), '--vote', 'approve'], r);
}

function strategyFor(pr, method) {
  const requested = { merge: 'noFastForward', squash: 'squash', rebase: 'rebase', rebaseMerge: 'rebaseMerge' }[method];
  if (!pr.allowedStrategies || pr.allowedStrategies[requested]) return requested;
  const allowed = ['squash', 'noFastForward', 'rebase', 'rebaseMerge'].find((s) => pr.allowedStrategies[s]);
  if (!allowed) throw new Error('No merge strategy is allowed by the repository policy');
  return allowed;
}
const canComplete = (pr) =>
  !pr.isDraft && pr.mergeStatus === 'succeeded' && pr.checks.filter((c) => c.blocking).every((c) => c.state === 'pass');
// Not `devops invoke --resource pullRequests`: that name resolves to the org-level, read-only route
// (GET /_apis/git/pullRequests/{id}), so a PATCH fails. `repos pr update` uses the repository route, but it only
// offers squash or a merge commit.
const CLI_STRATEGIES = ['squash', 'noFastForward'];
async function completePr(r, pr, strategy, deleteSourceBranch, auto) {
  if (!CLI_STRATEGIES.includes(strategy))
    throw new Error(`az can't complete with ${strategy}; complete #${pr.id} in the browser (o)`);
  const args = ['repos', 'pr', 'update', '--id', String(pr.id), '--squash', String(strategy === 'squash'),
    '--delete-source-branch', String(Boolean(deleteSourceBranch))];
  if (auto) return command([...args, '--auto-complete', 'true'], r);
  // The CLI completes at whatever head it fetches, so recheck the commit the user saw.
  const current = await showPr(r, pr);
  if (current.lastMergeSourceCommit?.commitId !== pr.headSha)
    throw new Error(`#${pr.id} changed since you looked (new push), press r`);
  return command([...args, '--status', 'completed'], r);
}
// ---------------------------------------------------------------- CI

const branchName = (s = '') => s.replace(/^refs\/heads\//, '').replace(/^refs\/pull\/(\d+)\/merge$/, 'PR !$1');
function toRun(b) {
  return {
    id: b.id,
    pipeline: b.definition?.name,
    definitionId: b.definition?.id,
    number: b.buildNumber,
    status: b.status,
    result: b.result,
    branch: branchName(b.sourceBranch),
    sourceBranch: b.sourceBranch,
    sha: b.sourceVersion,
    reason: b.reason,
    requestedFor: b.requestedFor?.displayName,
    url: b._links?.web?.href,
    queuedAt: b.queueTime,
  };
}

async function fetchRuns(r, limit) {
  const info = await repoInfo(r);
  return value(
    await invoke(
      r,
      'build',
      'builds',
      { project: r.project },
      { query: { repositoryId: info.id, repositoryType: 'TfsGit', $top: limit, queryOrder: 'queueTimeDescending' } },
    ),
  ).map(toRun);
}

async function fetchTimeline(r, run) {
  const t = await invoke(r, 'build', 'timeline', { project: r.project, buildId: run.id }, { timeout: 120000 });
  return t.records || value(t);
}

async function fetchRunLogs(r, run, records, limit) {
  let tasks = records.filter((x) => x.type === 'Task' && x.result === 'failed' && x.log?.id);
  if (!tasks.length)
    tasks = records.filter(
      (x) => x.type === 'Task' && ['succeededWithIssues', 'partiallySucceeded'].includes(x.result) && x.log?.id,
    );
  const listing = await invoke(r, 'build', 'logs', { project: r.project, buildId: run.id }, { timeout: 120000 });
  return mapLimit(tasks, PR_CONCURRENCY, async (task) => {
    const count = value(listing).find((entry) => entry.id === task.log.id)?.lineCount || 0;
    const log = await invoke(r, 'build', 'logs', { project: r.project, buildId: run.id, logId: task.log.id }, {
      query: { startLine: Math.max(1, count - limit) }, timeout: 120000,
    });
    const parent = (id) => id == null ? undefined : records.find((entry) => entry.id === id);
    const job = parent(task.parentId);
    let ancestor = job;
    while (ancestor && ancestor.type !== 'Stage') ancestor = parent(ancestor.parentId);
    const stage = ancestor;
    const jobs = records.filter((record) => record.type === 'Job');
    return {
      name: [
        stage?.name === '__default' ? '' : stage?.name,
        job?.name === 'Job' && jobs.length === 1 ? '' : job?.name,
        task.name,
      ]
        .filter(Boolean)
        .join(' › '),
      lines: value(log)
        .slice(-limit)
        .map((line) =>
          sanitize(
            String(line)
              .replace(/^\S+Z /, '')
              .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''),
          ),
        ),
    };
  });
}

function retryPlan(run, records) {
  const stages = records.filter((x) => x.type === 'Stage' && x.result === 'failed' && x.identifier);
  if (stages.length) return { stages };
  if (/^refs\/pull\//.test(run.sourceBranch || ''))
    throw new Error('PR merge refs cannot be queued; requeue the PR policy from the PR checks view in the browser');
  return { stages: [] };
}

async function retryRun(r, run, plan) {
  if (plan.stages.length) {
    for (const stage of plan.stages)
      await invoke(
        r,
        'build',
        'stages',
        { project: r.project, buildId: run.id, stageRefName: stage.identifier },
        { method: 'PATCH', body: { forceRetryAllJobs: false, state: 'retry' } },
      );
  } else
    await invoke(
      r,
      'build',
      'builds',
      { project: r.project },
      {
        method: 'POST',
        body: { definition: { id: run.definitionId }, sourceBranch: run.sourceBranch, sourceVersion: run.sha },
      },
    );
}
// ---------------------------------------------------------------- work items

const FIELDS = ['System.Id', 'System.Title', 'System.State', 'System.WorkItemType', 'System.ChangedDate',
  'System.IterationPath', 'Microsoft.VSTS.Common.Priority'];
const wiqlString = (text) => `'${String(text).replace(/'/g, "''")}'`;

// The project is spelled out: `az boards query` doesn't bind @project, so a query using it matches nothing.
function wiql(hidden, project) {
  return `SELECT ${FIELDS.map((field) => `[${field}]`).join(',')} FROM WorkItems ` +
    `WHERE [System.AssignedTo] = @Me AND [System.TeamProject] = ${wiqlString(project)} ` +
    `AND [System.State] NOT IN (${hidden.map(wiqlString).join(',')}) ORDER BY [System.ChangedDate] DESC`;
}

function toWorkItem(w, r) {
  const f = w.fields || {};
  return {
    id: w.id,
    type: f['System.WorkItemType'],
    title: f['System.Title'],
    state: f['System.State'],
    iteration: String(f['System.IterationPath'] || '')
      .split('\\')
      .pop(),
    priority: f['Microsoft.VSTS.Common.Priority'],
    changedAt: f['System.ChangedDate'],
    url: `${webBase(r)}/_workitems/edit/${w.id}`,
  };
}

async function fetchWorkItems(r, hidden) {
  return value(await command(['boards', 'query', '--wiql', wiql(hidden, r.project)], r))
    .slice(0, 100)
    .map((item) => toWorkItem(item, r));
}
const showWorkItem = (r, w) => command(['boards', 'work-item', 'show', '--id', String(w.id), '--expand', 'all'], r);
const workComments = async (r, w) =>
  value(await invoke(r, 'wit', 'comments', { project: r.project, workItemId: w.id }, { version: '7.1-preview.4' }));
async function workStates(r, w) {
  const key = `${r.org}/${r.project}/${w.type}`;
  if (!stateCache.has(key))
    stateCache.set(
      key,
      invoke(r, 'wit', 'workItemTypeStates', { project: r.project, type: w.type })
        .then(value)
        .catch((e) => {
          stateCache.delete(key);
          throw e;
        }),
    );
  return stateCache.get(key);
}
const updateState = (r, w, state) =>
  command(['boards', 'work-item', 'update', '--id', String(w.id), '--state', state], r);
const htmlEscape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const commentWorkItem = (r, w, text) =>
  command(['boards', 'work-item', 'update', '--id', String(w.id), '--discussion', htmlEscape(text)], r);
// ---------------------------------------------------------------- alerts

function toAlert(a, r) {
  return {
    id: a.alertId,
    title: a.title || a.rule?.name || '',
    severity: String(a.severity || 'unknown').toLowerCase(),
    type: a.alertType,
    path: a.physicalLocations?.[0]?.filePath,
    firstSeen: a.firstSeen,
    url: `${repoBase(r)}/alerts/${a.alertId}`,
  };
}

async function fetchAlerts(r) {
  const info = await repoInfo(r);
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  return value(
    await invoke(
      r,
      'alert',
      'alerts',
      { project: info.project?.id, repository: info.id },
      { version: '7.2-preview', query: { top: 200 } },
    ),
  )
    .filter((a) => a.state === 1 || String(a.state).toLowerCase() === 'active')
    .map((alert) => toAlert(alert, r))
    .sort((a, b) => (rank[a.severity] ?? 4) - (rank[b.severity] ?? 4));
}
return {
  AzError,
  command,
  invoke,
  errorMessage,
  findReposByName,
  repoInfo,
  whoAmI,
  isMe,
  reviewSummary,
  checkState,
  mapPolicies,
  countThreads,
  fetchPrs,
  fetchThreads,
  fetchPolicies,
  showPr,
  approvePr,
  strategyFor,
  canComplete,
  completePr,
  fetchRuns,
  fetchTimeline,
  fetchRunLogs,
  retryPlan,
  retryRun,
  wiql,
  fetchWorkItems,
  showWorkItem,
  workComments,
  workStates,
  updateState,
  commentWorkItem,
  fetchAlerts,
};
}
