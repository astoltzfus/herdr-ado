import * as views from '../core/views.js';
import { ESC, green, red, yellow, cyan, dim, bold, inverse } from './ansi.js';
import { seg, renderLine, wrapText } from './text.js';
import { isFailedRun, prCard, runCard, workItemCard, alertCard } from './cards.js';

const HEADER_LINES = 3;
const FOOTER_LINES = 1;
const GUTTER = 2;
const PAGE_STEP = 5;
const KEY = {
  up: ['\x1b[A', '\x1bOA', 'k'],
  down: ['\x1b[B', '\x1bOB', 'j'],
  pageUp: '\x1b[5~',
  pageDown: '\x1b[6~',
  shiftTab: '\x1b[Z',
  escape: '\x1b',
  ctrlC: '\x03',
  enter: '\r',
  tab: '\t',
};
// One token per key press: CSI/SS3 escape sequences, a lone ESC, or one character.
const KEY_TOKEN = /\x1b\[[0-9;?]*[~A-Za-z]|\x1bO[A-Za-z]|\x1b|[\s\S]/gu;

// ---------------------------------------------------------------- app

// Dependencies are injected so the UI can be tested without a terminal or CLI.

function createApp({
  az,
  currentSpace,
  spaceFolder = async () => null,
  config,
  repo = null,
  terminal,
  now = Date.now,
  resolveRemote = async () => null,
}) {
  const TABS = [
    {
      title: 'PRs',
      load: (r) => az.fetchPrs(r),
      card: prCard,
      key: (x) => x.id,
      filter: (x, s) => !s.voteOnly || (x.isReviewer && x.myVote === 0 && !x.isAuthor),
      count: (x) => String(x.length),
      hint: '⏎ view · c policies · a approve · m complete · v my vote',
    },
    {
      title: 'CI',
      load: (r) => az.fetchRuns(r, config.run_limit),
      card: runCard,
      key: (x) => x.id,
      filter: (x, s) => !s.failuresOnly || isFailedRun(x),
      count: (x) => `${x.length} ${x.filter(isFailedRun).length}✗`,
      hint: '⏎ view · R retry · f failures',
    },
    {
      title: 'Work',
      load: (r) => az.fetchWorkItems(r, config.work_item_hidden_states),
      card: workItemCard,
      key: (x) => x.id,
      filter: () => true,
      count: (x) => String(x.length),
      hint: '⏎ view · s state · c comment',
    },
    ...(config.security_tab
      ? [
          {
            title: 'Vulns',
            load: (r) => az.fetchAlerts(r),
            card: alertCard,
            key: (x) => x.id,
            filter: () => true,
            count: (x) => String(x.length),
            hint: '⏎ open',
          },
        ]
      : []),
  ];
  const HELP = [
    ['Any tab', ''],
    ['1–4, tab', 'switch tab'],
    ['j k, ↑ ↓', 'move (g G top/bottom)'],
    ['r', 'refresh'],
    ['o', 'open in browser'],
    ['q, esc', 'close'],
    ['PRs', ''],
    ['enter / c', 'PR / policies'],
    ['a / m', 'approve / complete'],
    ['v', 'needs my vote'],
    ['CI', ''],
    ['enter / R / f', 'view / retry / failures'],
    ['Work', ''],
    ['enter / s / c', 'view / state / comment'],
    ...(config.security_tab
      ? [
          ['Vulns', ''],
          ['enter', 'open alert'],
        ]
      : []),
  ];

  const emptyTabs = (value) => TABS.map(() => value);
  const replaceAt = (list, index, value) => list.map((item, i) => (i === index ? value : item));

  let state = {
    space: null,
    folder: null,
    repo,
    otherMatches: 0,
    notice: null,
    tab: 0,
    rows: emptyTabs([]),
    errors: emptyTabs(null),
    selected: emptyTabs(null), // key of the selected row per tab, so re-sorts never move the selection
    scroll: emptyTabs(0),
    loading: false,
    refreshQueued: false,
    busy: false,
    updatedAt: null,
    message: null,
    confirm: null,
    help: false,
    voteOnly: false,
    picker: null,
    input: null,
    failuresOnly: false,
  };

  function setState(patch) {
    state = { ...state, ...patch };
    render();
  }

  const visibleRows = () => state.rows[state.tab].filter((row) => TABS[state.tab].filter(row, state));

  function cursorIndex(rows) {
    const index = rows.findIndex((row) => TABS[state.tab].key(row) === state.selected[state.tab]);
    return Math.max(0, index);
  }

  const selectedRow = () => {
    const rows = visibleRows();
    return rows[cursorIndex(rows)];
  };

  const listHeight = () => Math.max(1, terminal.rows() - HEADER_LINES - FOOTER_LINES);

  // ------------------------------------------------------------ render

  function headerLines(width) {
    const time = state.updatedAt ? state.updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const status = state.loading ? seg('  refreshing…', yellow) : seg(time && `  ${time}`, dim);
    const filters = [state.voteOnly && 'my vote', state.failuresOnly && 'failures'].filter(Boolean);
    const title = [
      seg(state.repo ? `${state.repo.project}/${state.repo.repo}` : state.space || 'herdr-ado', bold),
      seg(state.repo ? `  ${state.repo.org}` : '', dim),
      seg(state.otherMatches ? ` (+${state.otherMatches} same name)` : '', dim),
      status,
      seg(filters.length ? `  only: ${filters.join(', ')}` : '', cyan),
    ];
    const tabs = TABS.flatMap((tab, i) => {
      const count = state.errors[i] ? '!' : state.repo ? tab.count(state.rows[i]) : '-';
      return [seg(` ${i + 1} ${tab.title} ${count} `, i === state.tab ? (t) => inverse(bold(t)) : undefined), seg(' ')];
    });
    return [renderLine(title, width), renderLine(tabs, width), dim('─'.repeat(width))];
  }

  function bodyLines(width) {
    if (state.picker)
      return [
        bold('Choose a state'),
        ...state.picker.states.map((entry, index) => {
          const selected = index === state.picker.index;
          const label = `${selected ? '▌' : ' '} ${index + 1} ${entry.name}`;
          return renderLine([seg(label, selected ? cyan : dim)], width);
        }),
      ];
    if (state.help) {
      return HELP.map(([key, text]) =>
        text ? renderLine([seg(`  ${key.padEnd(11)} `, cyan), seg(text)], width) : bold(key),
      );
    }
    if (state.notice) return wrapText(state.notice.text, width, state.notice.paint).map((l) => renderLine(l, width));
    const error = state.errors[state.tab];
    if (error)
      return wrapText(
        error === 'Advanced Security is not enabled for this repository' ? `${error}.` : error,
        width,
        error === 'Advanced Security is not enabled for this repository' ? yellow : red,
      ).map((l) => renderLine(l, width));

    const rows = visibleRows();
    if (rows.length === 0) return state.loading || !state.repo ? [] : [dim('Nothing to show.')];

    const cursor = cursorIndex(rows);
    const cardWidth = Math.max(1, width - GUTTER);
    const lines = rows.flatMap((row, index) => {
      const gutter = index === cursor ? cyan('▌ ') : '  ';
      const card = TABS[state.tab].card(row, cardWidth, now()).map((l) => gutter + renderLine(l, cardWidth));
      return [...card, ''].map((text) => ({ text, index }));
    });
    const height = listHeight();
    const first = lines.findIndex((l) => l.index === cursor);
    const last = lines.findLastIndex((l) => l.index === cursor);
    const scroll = Math.min(Math.max(state.scroll[state.tab], last - height + 1), first);
    state = { ...state, scroll: replaceAt(state.scroll, state.tab, scroll) };
    return lines.slice(scroll, scroll + height).map((l) => l.text);
  }

  function footerLine(width) {
    if (state.input) return renderLine([seg(`comment #${state.input.item.id}: ${state.input.text}▏`, yellow)], width);
    if (state.confirm)
      return renderLine([seg('[y/N] ', (t) => bold(yellow(t))), seg(state.confirm.prompt, yellow)], width);
    if (state.message) return renderLine([seg(state.message.text, state.message.paint)], width);
    const hint = state.help ? 'any key to go back' : width < 50 ? 'j/k select · enter view · ? keys' :
      `${TABS[state.tab].hint} · ? keys`;
    return renderLine([seg(hint, dim)], width);
  }

  function render() {
    // One spare column so a full-width line never triggers the terminal's autowrap.
    const width = Math.max(1, terminal.columns() - 1);
    const body = bodyLines(width).slice(0, listHeight());
    const padding = Array.from({ length: listHeight() - body.length }, () => '');
    const lines = [...headerLines(width), ...body, ...padding, footerLine(width)].slice(
      0,
      Math.max(1, terminal.rows()),
    );
    terminal.write(`${ESC}H${lines.map((line) => `${line}${ESC}K`).join('\r\n')}${ESC}J`);
  }

  // ------------------------------------------------------------ data

  // → { repo, otherMatches, notice } for the repo named after `space`.
  async function findRepo(space, folder) {
    try {
      const remote = await resolveRemote(folder);
      if (remote) return { repo: remote, otherMatches: 0, notice: null };
      const matches = await az.findReposByName(space);
      if (!matches.length)
        return {
          repo: null,
          otherMatches: 0,
          notice: {
            text:
              `No Azure DevOps repo for "${space}": ` +
              'cd into an ADO clone, or rename this Space to the repo name, then press r.',
            paint: yellow,
          },
        };
      return { repo: matches[0], otherMatches: matches.length - 1, notice: null };
    } catch (err) {
      return {
        repo: null,
        otherMatches: 0,
        notice: { text: `Could not look up "${space}": ${az.errorMessage(err)}`, paint: red },
      };
    }
  }

  async function refresh(tabIndexes = TABS.map((_, i) => i)) {
    if (state.loading) {
      state = { ...state, refreshQueued: true };
      return;
    }
    if (!state.repo && !state.space) return;
    const space = state.space;
    const folder = state.folder;
    setState({ loading: true, refreshQueued: false });
    const stale = () => state.space !== space || state.folder !== folder;

    if (!state.repo) {
      setState({ notice: { text: `Looking for an Azure DevOps repo named "${space}"…`, paint: dim } });
      const found = await findRepo(space, folder);
      if (!stale()) setState(found);
    }
    const currentRepo = state.repo;
    if (currentRepo && !stale()) {
      const results = await Promise.allSettled(tabIndexes.map((i) => TABS[i].load(currentRepo)));
      if (!stale() && state.repo === currentRepo) {
        const resultFor = (i) => results[tabIndexes.indexOf(i)];
        state = {
          ...state,
          rows: state.rows.map((rows, i) => (resultFor(i)?.status === 'fulfilled' ? resultFor(i).value : rows)),
          errors: state.errors.map((error, i) => {
            const result = resultFor(i);
            if (!result) return error;
            return result.status === 'rejected' ? az.errorMessage(result.reason) : null;
          }),
          updatedAt: new Date(now()),
        };
      }
    }
    const again = stale() || state.refreshQueued;
    setState({ loading: false, refreshQueued: false });
    if (again) await refresh();
  }

  // Herdr names a Space after its root pane's folder, so a `cd` into another
  // repo shows up here as a new Space name.
  async function watchSpace() {
    try {
      const space = await currentSpace();
      if (!space) throw new Error('No current Space');
      const { label } = space;
      const folder = await spaceFolder(space);
      if (label === state.space && folder === state.folder) {
        if (state.notice?.source === 'herdr') setState({ notice: null });
        return;
      }
      setState({
        space: label,
        folder,
        repo: null,
        otherMatches: 0,
        notice: null,
        rows: emptyTabs([]),
        errors: emptyTabs(null),
        selected: emptyTabs(null),
        scroll: emptyTabs(0),
        updatedAt: null,
        message: null,
        confirm: null,
        input: null,
        picker: null,
      });
      await refresh();
    } catch (err) {
      setState({
        notice: {
          source: 'herdr',
          text: `Could not read the current Space from Herdr: ${az.errorMessage(err)}`,
          paint: red,
        },
      });
    }
  }

  async function runAction(label, action) {
    setState({ busy: true, message: { text: `${label}…`, paint: yellow } });
    try {
      await action();
      setState({ message: { text: `${label} ✓`, paint: green } });
    } catch (err) {
      setState({ message: { text: `${label} failed: ${az.errorMessage(err)}`, paint: red } });
    }
    setState({ busy: false });
    await refresh();
  }

  function confirm(prompt, action) {
    if (state.busy) return setState({ message: { text: 'Still working on the last action…', paint: yellow } });
    return setState({ confirm: { prompt, action } });
  }

  // ------------------------------------------------------------ input

  function moveCursor(delta) {
    const rows = visibleRows();
    if (rows.length === 0) return;
    const index = Math.max(0, Math.min(rows.length - 1, cursorIndex(rows) + delta));
    setState({ selected: replaceAt(state.selected, state.tab, TABS[state.tab].key(rows[index])) });
  }

  function switchTab(tab) {
    setState({ tab: (tab + TABS.length) % TABS.length, message: null });
  }

  function openUrl(url) {
    terminal.openUrl(url, (err) =>
      setState({ message: { text: `Could not open browser: ${err.message}`, paint: red } }),
    );
  }

  async function loadPage(label, work) {
    if (state.busy) return;
    const repo = state.repo;
    setState({ busy: true, message: { text: `Loading ${label}…`, paint: yellow } });
    try {
      const text = await work();
      if (state.repo === repo) {
        terminal.pageText(text);
        render();
        setState({ message: null });
      }
    } catch (e) {
      setState({ message: { text: az.errorMessage(e), paint: red } });
    } finally {
      setState({ busy: false });
    }
  }
  function handlePrKey(key, pr, r) {
    const ref = `#${pr.id} ${pr.title}`;
    if (key === KEY.enter)
      return loadPage(`#${pr.id}`, async () => views.prText(await az.showPr(r, pr), await az.fetchThreads(r, pr)));
    if (key === 'c') return loadPage(`#${pr.id}`, async () => views.policiesText(pr, await az.fetchPolicies(r, pr)));
    if (key === 'o') return openUrl(pr.url);
    if (key === 'a') return confirm(`approve ${ref}`, () => runAction(`Approve #${pr.id}`, () => az.approvePr(r, pr)));
    if (key === 'm') {
      if (pr.isDraft) return setState({ message: { text: `#${pr.id} is a draft`, paint: red } });
      let strategy;
      try {
        strategy = az.strategyFor(pr, config.merge_method);
      } catch (err) {
        return setState({ message: { text: az.errorMessage(err), paint: red } });
      }
      const auto = !az.canComplete(pr);
      const blocked =
        pr.checks
          .filter((c) => c.blocking && c.state !== 'pass')
          .map((c) => c.name)
          .join(', ') ||
        pr.mergeStatus ||
        'merge conditions';
      return confirm(
        auto ? `set auto-complete on ${ref} (${strategy}); blocked by: ${blocked}` : `complete ${ref} (${strategy})`,
        () => runAction(`Complete #${pr.id}`, () => az.completePr(r, pr, strategy, config.delete_source_branch, auto)),
      );
    }
  }
  async function handleRunKey(key, run, r) {
    if (key === 'o') return openUrl(run.url);
    if (key === KEY.enter)
      return loadPage(`#${run.number}`, async () => {
        const records = await az.fetchTimeline(r, run);
        return isFailedRun(run)
          ? views.logsText(await az.fetchRunLogs(r, run, records, config.log_tail_lines))
          : views.runText(run, records);
      });
    if (key === 'R') {
      if (!isFailedRun(run)) return setState({ message: { text: 'Only failed runs can be retried', paint: red } });
      if (state.busy) return setState({ message: { text: 'Still working on the last action…', paint: yellow } });
      setState({ busy: true, message: { text: `Loading #${run.number}…`, paint: yellow } });
      try {
        const plan = az.retryPlan(run, await az.fetchTimeline(r, run));
        if (state.repo !== r) {
          setState({ busy: false, message: null });
          return;
        }
        setState({ busy: false, message: null });
        const prompt = plan.stages.length
          ? plan.stages.length === 1 && plan.stages[0].identifier === '__default'
            ? `retry failed jobs of ${run.pipeline} #${run.number}`
            : `retry failed stages ${plan.stages.map((x) => x.name).join(', ')} of ${run.pipeline} #${run.number}`
          : `queue a new run of ${run.pipeline} on ${run.branch} at ${String(run.sha || '').slice(0, 7)}`;
        return confirm(prompt, () => runAction(`Retry ${run.pipeline}`, () => az.retryRun(r, run, plan)));
      } catch (e) {
        setState({ busy: false, message: { text: az.errorMessage(e), paint: red } });
      }
    }
  }
  async function handleWorkItemKey(key, item, r) {
    if (key === 'o') return openUrl(item.url);
    if (key === KEY.enter)
      return loadPage(`#${item.id}`, async () =>
        views.workItemText(await az.showWorkItem(r, item), await az.workComments(r, item)),
      );
    if (key === 'c') {
      if (!state.busy) setState({ input: { item, repo: r, text: '' }, message: null });
      return;
    }
    if (key === 's') {
      if (state.busy) return;
      setState({ busy: true, message: { text: `Loading #${item.id}…`, paint: yellow } });
      try {
        const states = (await az.workStates(r, item)).filter((x) => x.name !== item.state);
        if (state.repo === r) setState({ picker: { item, repo: r, states, index: 0 }, message: null });
      } catch (e) {
        setState({ message: { text: az.errorMessage(e), paint: red } });
      } finally {
        setState({ busy: false });
      }
    }
  }
  function handleAlertKey(key, alert) {
    if (key === KEY.enter || key === 'o') return openUrl(alert.url);
  }
  const ROW_HANDLERS = [handlePrKey, handleRunKey, handleWorkItemKey, handleAlertKey];

  function handleInputKey(key) {
    const input = state.input;
    if (key === KEY.escape) return setState({ input: null });
    if (key === KEY.enter) {
      setState({ input: null });
      if (!input.text.trim()) return;
      const preview = input.text.length > 40 ? `${input.text.slice(0, 40)}…` : input.text;
      return confirm(`comment on #${input.item.id} ${input.item.title}: "${preview}"`, () =>
        runAction(`Comment #${input.item.id}`, () => az.commentWorkItem(input.repo, input.item, input.text)),
      );
    }
    if (key === '\x7f' || key === '\b')
      return setState({ input: { ...input, text: [...input.text].slice(0, -1).join('') } });
    if (key.length && !/[\u0000-\u001f\u007f-\u009f]/u.test(key) && [...input.text].length < 2000)
      return setState({ input: { ...input, text: input.text + key } });
    return;
  }

  function handlePickerKey(key) {
    const p = state.picker;
    if (key === KEY.escape) return setState({ picker: null });
    if (KEY.down.includes(key) || KEY.up.includes(key))
      return setState({
        picker: {
          ...p,
          index: Math.max(0, Math.min(p.states.length - 1, p.index + (KEY.down.includes(key) ? 1 : -1))),
        },
      });
    if (/^[1-9]$/.test(key) && Number(key) <= p.states.length)
      return setState({ picker: { ...p, index: Number(key) - 1 } });
    if (key === KEY.enter && p.states[p.index]) {
      const target = p.states[p.index].name;
      setState({ picker: null });
      return confirm(`move #${p.item.id} ${p.item.title}: ${p.item.state} → ${target}`, () =>
        runAction(`Move #${p.item.id}`, () => az.updateState(p.repo, p.item, target)),
      );
    }
    return;
  }

  function handleKey(key) {
    if (state.input) return handleInputKey(key);
    if (state.picker) return handlePickerKey(key);
    if (state.confirm) {
      const { action } = state.confirm;
      setState({ confirm: null, message: null });
      if (key === 'y' || key === 'Y') return action();
      return undefined;
    }
    if (state.help) return setState({ help: false });
    if (key === 'q' || key === KEY.escape || key === KEY.ctrlC) return terminal.quit();
    if (key === '?') return setState({ help: true });
    if (KEY.down.includes(key)) return moveCursor(1);
    if (KEY.up.includes(key)) return moveCursor(-1);
    if (key === KEY.pageDown) return moveCursor(PAGE_STEP);
    if (key === KEY.pageUp) return moveCursor(-PAGE_STEP);
    if (key === 'g') return moveCursor(-Infinity);
    if (key === 'G') return moveCursor(Infinity);
    if (key === KEY.tab) return switchTab(state.tab + 1);
    if (key === KEY.shiftTab) return switchTab(state.tab - 1);
    if (/^[1-4]$/.test(key) && Number(key) <= TABS.length) return switchTab(Number(key) - 1);
    if (key === 'r') return refresh();
    if (key === 'v' && state.tab === 0) return setState({ voteOnly: !state.voteOnly });
    if (key === 'f' && state.tab === 1) return setState({ failuresOnly: !state.failuresOnly });

    // A notice or error replaces the list; never act on rows the user cannot see.
    if (state.notice || state.errors[state.tab]) return undefined;
    const row = selectedRow();
    return row ? ROW_HANDLERS[state.tab](key, row, state.repo) : undefined;
  }

  // Returns the promise of the last key's work so tests can await it.
  function handleInput(data) {
    return (String(data).match(KEY_TOKEN) || []).reduce((_, key) => handleKey(key), undefined);
  }

  return { render, refresh, watchSpace, handleInput, getState: () => state };
}


export { createApp };
