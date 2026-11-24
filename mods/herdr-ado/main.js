import { View } from 'gpui-kit';
import { InputState, ScrollHandle } from 'gpui-base';
import {
  appHome, checking, closeOverlay, exec, focused, hc, nextCommand, openOverlay,
  panes, props, readTextFile, run, setShared, shared, spaces, window as herdrWindow, writeTextFile,
} from 'herdr';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import { createAz } from './core/az.js';
import { isWebUrl, opener } from './core/browser.js';
import { DEFAULT_CONFIG, validateConfig } from './core/config.js';
import { resolveRemote } from './core/remote.js';
import {
  adoPaneIds, chooseCwd, existingPanel, filtered, keyAction, newPaneId, pruneRegistry,
  select, tabs, terminalName, terminalPlan, viewTitle,
} from './ui/logic.js';
import { actions } from './ui/actions.js';
import { cards } from './ui/cards.js';
import { detail } from './ui/detail.js';
import { panel } from './ui/panel.js';
import { modal } from './ui/modal.js';

async function tempFile(text) {
  const dir = `${appHome()}/mods/herdr-ado/.tmp`;
  await mkdir(dir, { recursive: true });
  const path = `${dir}/${randomUUID()}.json`;
  await writeFile(path, text);
  return { path, remove: () => unlink(path) };
}
const PANE_POLL_MS = 50;
const PANE_POLL_TICKS = 100;
const repoKey = (repo) => `${repo.org}/${repo.project}/${repo.repo}`;
const spaceKey = (space, cwd) => JSON.stringify([space?.id, cwd, space?.machine]);

export default class Ado extends View {
  init(_props, cx) {
    this.launcher = Boolean(props()?.overlay && props()?.mode !== 'window');
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.config = DEFAULT_CONFIG;
    this.az = createAz({ run: exec, tempFile });
    this.cache = new Map();
    this.lastCwd = new Map();
    this.rows = [[], [], [], []];
    this.index = 0;
    this.tab = 0;
    this.view = null;
    this.viewToken = 0;
    this.input = InputState.new({ placeholder: 'Comment…' });
    this.configInput = InputState.new({ placeholder: 'Config JSON' });
    this.input.on('submit', (_event, context) => this.submitComment(context));
    if (checking()) return;
    if (this.launcher) {
      this.float();
      closeOverlay(props().overlay);
      return;
    }
    if (props()?.mode === 'pane') {
      const tab = focused()?.tab;
      const before = adoPaneIds(panes(), tab);
      const registry = shared('herdr-ado.panels') ?? [];
      // A registered panel already in this tab makes this copy a duplicate, unless it is that panel restored.
      const restored = before.length === 1 && registry.includes(before[0]);
      this.pending = Boolean(existingPanel(null, panes(), registry, tab)) && !restored;
      if (!this.pending) this.start(cx);
      this.claimPane(cx, tab, before);
      return;
    }
    if (props()?.mode === 'window') setShared('herdr-ado.window', props().overlay);
    this.start(cx);
  }
  // A split mod pane is not in panes() at init (it shows up ~1.5 s later) and gets no props().pane, so poll for
  // the new id: close it if the tab already has a panel, otherwise register it as the tab's panel.
  claimPane(cx, tab, before) {
    let ticks = 0;
    const task = cx.timer.every(PANE_POLL_MS, (context) => {
      const current = panes();
      const mine = newPaneId(before, current, tab);
      ticks += 1;
      if (!mine && ticks < PANE_POLL_TICKS) return;
      task.cancel();
      const registry = shared('herdr-ado.panels') ?? [];
      const existing = mine && existingPanel(mine, current, registry, tab);
      if (existing) {
        run('pane.close', { pane: mine });
        run('pane.focus', { pane: existing });
        this.closed = true;
        return;
      }
      // No new id means a restored copy; alone in its tab, the one ADO pane is this one.
      const own = mine || (before.length === 1 ? before[0] : null);
      if (own) setShared('herdr-ado.panels', pruneRegistry(registry, current, own));
      if (!this.pending) return;
      this.pending = false;
      this.start(context);
      context.notify();
    });
  }
  start(cx) {
    cx.spawn(async (context) => {
      try {
        const path = `${appHome()}/mods/herdr-ado/config.json`;
        let text = await readTextFile(path);
        if (text === null) {
          text = `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`;
          try {
            await writeTextFile(path, text, null);
          } catch {
            text = await readTextFile(path);
          }
        }
        this.configText = text;
        this.config = validateConfig(JSON.parse(text));
        localStorage.setItem('config', JSON.stringify(this.config));
      } catch (error) {
        this.message = `Config: ${error.message}`;
      }
      context.timer.every(this.config.refresh_seconds * 1000, (timer) => this.refresh(timer));
      this.follow(context);
      context.notify();
    });
    cx.spawn(async (context) => {
      for (;;) {
        const command = await nextCommand();
        if (command === 'focus') this.handle.focus();
        if (command === 'float') this.float();
        context.notify();
      }
    });
  }
  follow(cx) {
    const all = spaces();
    const focus = focused();
    const space = all.find((item) => item.id === focus?.space) || all.find((item) => item.active);
    if (space && focus?.space === space.id && focus.terminal && focus.cwd) {
      this.lastCwd.set(space.id, focus.cwd);
    }
    const cwd = chooseCwd(space, focus, this.lastCwd.get(space?.id), panes());
    const key = spaceKey(space, cwd);
    if (key === this.spaceKey) return;
    this.spaceKey = key;
    this.space = space;
    this.cwd = cwd;
    this.message = null;
    this.repo = null;
    this.rows = [[], [], [], []];
    if (!space) return;
    this.loading = true;
    cx.spawn(async (context) => {
      try {
        const repo = await resolveRemote(exec, cwd, space.machine) ||
          (await this.az.findReposByName(space.name))[0];
        if (this.spaceKey !== key) return;
        if (this.view && (!repo || repoKey(repo) !== repoKey(this.viewRepo))) this.view = null;
        this.repo = repo && { ...repo, machine: space.machine };
        this.rows = this.cache.get(this.repo && repoKey(this.repo)) || [[], [], [], []];
        this.refresh(context);
      } catch (error) {
        if (this.spaceKey === key) this.message = this.az.errorMessage(error);
      } finally {
        if (this.spaceKey === key) this.loading = false;
        context.notify();
      }
    });
  }
  refresh(cx) {
    if (!this.repo || this.refreshing) return;
    const repo = this.repo;
    this.refreshing = true;
    cx.spawn(async (context) => {
      const jobs = [this.az.fetchPrs(repo), this.az.fetchRuns(repo, this.config.run_limit),
        this.az.fetchWorkItems(repo, this.config.work_item_hidden_states),
        this.config.security_tab ? this.az.fetchAlerts(repo) : Promise.resolve([])];
      const result = await Promise.allSettled(jobs);
      const rows = result.map((entry, index) => entry.status === 'fulfilled' ? entry.value : this.rows[index]);
      this.cache.set(repoKey(repo), rows);
      if (this.repo === repo) {
        this.rows = rows;
        this.message = result.filter((entry) => entry.status === 'rejected')
          .map((entry) => this.az.errorMessage(entry.reason)).join(' · ') || null;
        this.updated = new Date().toLocaleTimeString();
      }
      this.refreshing = false;
      if (this.repo && this.repo !== repo) this.refresh(context);
      context.notify();
    });
  }
  float() {
    const windowId = shared('herdr-ado.window');
    if (windowId) {
      closeOverlay(windowId);
      setShared('herdr-ado.window', null);
      return;
    }
    const id = openOverlay({
      kind: 'window', key: 'herdr-ado', keep: true, mod: 'herdr-ado',
      props: { mode: 'window' }, width: 440, height: 0.8,
    });
    setShared('herdr-ado.window', id);
  }
  closeWindow() {
    setShared('herdr-ado.window', null);
    closeOverlay(props().overlay);
  }
  toPane() {
    run('pane.split', { direction: 'right', mod: 'herdr-ado', props: { mode: 'pane' } });
    this.closeWindow();
  }
  open(url, cx) {
    if (!url) return;
    if (!isWebUrl(url)) {
      this.message = 'Not opening a link that is not https://';
      cx.notify();
      return;
    }
    cx.spawn(async (context) => {
      try {
        const result = await exec(opener(herdrWindow()?.platform), [url]);
        if (result.code !== 0) throw new Error(result.stderr.trim() || `exit code ${result.code}`);
      } catch (error) {
        this.message = `Could not open browser: ${error.message || error}`;
      }
      context.notify();
    });
  }
  terminal(cx) {
    if (!this.repo || !this.space) return;
    if (this.space.machine) {
      this.message = 'terminal view needs a local space';
      cx.notify();
      return;
    }
    const repo = this.repo;
    const space = this.space;
    cx.spawn(async (context) => {
      try {
        const found = await hc(['get', terminalName(repo), '--json']);
        let existing = null;
        if (found.code === 0) existing = JSON.parse(found.stdout);
        let node = '';
        if (existing?.state !== 'live') {
          const result = await exec('node', ['-p', 'process.execPath']);
          if (result.code !== 0) throw new Error(result.stderr);
          node = result.stdout.trim();
        }
        let address;
        for (const call of terminalPlan(repo, space, node, appHome(), existing)) {
          if (call.type === 'hc') {
            const result = await hc(call.args);
            if (result.code !== 0) throw new Error(result.stderr);
            address = JSON.parse(result.stdout).address;
            if (!address) throw new Error('hc did not return a terminal address');
          } else {
            const args = { ...call.args, terminal: call.args.terminal === '$address' ? address : call.args.terminal };
            try { run(call.name, args); } catch (error) {
              if (!call.fallback) throw error;
              run(call.fallback.name, call.fallback.args);
            }
          }
        }
      } catch (error) {
        this.message = String(error);
      }
      context.notify();
    });
  }
  visible() {
    return filtered(this.rows[this.tab], this.tab, this.voteOnly, this.failuresOnly);
  }
  detail(kind, row, cx) {
    this.view = { kind, id: row.id, title: viewTitle(kind, row), token: ++this.viewToken };
    this.viewRepo = this.repo;
    this.detailText = null;
    this.editor = null;
    this.detailUrl = null;
    this.message = null;
    this.loadDetail(cx);
  }
  back(cx) {
    this.view = null;
    this.handle.focus();
    cx.notify();
  }
  key(event, cx) {
    const key = event.key_char || event.key;
    if (this.confirmation) {
      if (!this.busy) {
        if (this.confirmation.error && ['enter', 'escape'].includes(key)) this.closeModal(cx);
        else if (!this.confirmation.error && (key === 'y' || key === 'enter')) this.perform(cx);
        else if (!this.confirmation.error && (key === 'n' || key === 'escape')) this.closeModal(cx);
      }
      cx.stop_propagation();
      return;
    }
    if (this.picker) {
      if (key === 'escape') this.closeModal(cx);
      else if (['j', 'down', 'k', 'up'].includes(key)) this.picker.index = select(this.picker.index,
        ['j', 'down'].includes(key) ? 1 : -1, this.picker.states.length);
      else if (key === 'enter') this.pickState(this.picker.index, cx);
      cx.stop_propagation();
      cx.notify();
      return;
    }
    if (this.comment) {
      if (key === 'escape') this.closeModal(cx);
      cx.stop_propagation();
      return;
    }
    if (this.view) {
      if (key === 'escape' || key === 'backspace') this.back(cx);
      else if (key === 'o') this.open(this.detailUrl, cx);
      else if (key === 'r') this.loadDetail(cx);
      cx.stop_propagation();
      return;
    }
    if (this.editingConfig) {
      if (key === 'escape') {
        this.editingConfig = false;
        this.handle.focus();
        cx.notify();
      }
      return;
    }
    if (this.help && key === 'escape') {
      this.help = false;
      cx.notify();
      return;
    }
    if (['j', 'down', 'k', 'up', 'g', 'G'].includes(key)) {
      const delta = key === 'g' ? -Infinity : key === 'G' ? Infinity : ['j', 'down'].includes(key) ? 1 : -1;
      this.index = select(this.index, delta, this.visible().length);
      this.scroll.scroll_to_item(this.index);
    } else if (key === 'tab' || /^[1-4]$/.test(key)) {
      this.tab = key === 'tab' ? (this.tab + 1) % tabs(this.config).length :
        Math.min(Number(key) - 1, tabs(this.config).length - 1);
      this.index = 0;
    } else this.action(keyAction(key, this.tab), cx);
    cx.stop_propagation();
    cx.notify();
  }
}

Object.assign(Ado.prototype, actions, cards, detail, panel, modal);
