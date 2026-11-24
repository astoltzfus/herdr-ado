import { notify } from 'herdr';
import { confirmTitle, confirmVerb, failed, promptText } from './logic.js';

export const actions = {
  confirm(action, row, extra, work) {
    this.confirmation = { title: confirmTitle(action, row, extra), verb: confirmVerb(action, extra),
      text: promptText(action, row, extra), work, label: `${action} #${row.id}` };
  },
  submitComment(cx) {
    if (!this.comment) return;
    const text = this.input.value().trim();
    const row = this.comment;
    const repo = this.repo;
    this.comment = null;
    this.handle.focus();
    if (text) this.confirm('comment', row, { text }, () => this.az.commentWorkItem(repo, row, text));
    cx.notify();
  },
  perform(cx) {
    const pending = this.confirmation;
    if (!pending || this.busy || pending.error) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async (context) => {
      try {
        await pending.work();
        this.confirmation = null;
        this.message = `${pending.label} ✓`;
        notify({ title: 'Azure DevOps', body: this.message, level: 'info' });
      } catch (error) {
        pending.error = this.az.errorMessage(error);
        this.message = `${pending.label}: ${pending.error}`;
        notify({ title: 'Azure DevOps', body: this.message, level: 'error' });
      } finally {
        this.busy = false;
        this.refresh(context);
        context.notify();
      }
    });
  },
  action(action, cx, row = this.visible()[this.index]) {
    if (action === 'refresh') return this.refresh(cx);
    if (action === 'float') return this.float();
    if (action === 'terminal') return this.terminal(cx);
    if (action === 'help') {
      this.help = !this.help;
      cx.notify();
      return;
    }
    if (action === 'vote') {
      this.voteOnly = !this.voteOnly;
      this.index = 0;
      cx.notify();
      return;
    }
    if (action === 'failures') {
      this.failuresOnly = !this.failuresOnly;
      this.index = 0;
      cx.notify();
      return;
    }
    if (!row || !this.repo) return;
    const repo = this.repo;
    if (action === 'open' || (action === 'view' && this.tab === 3)) return this.open(row.url, cx);
    if (action === 'view') return this.detail(['pr', 'run', 'workitem'][this.tab], row, cx);
    if (action === 'policies') return this.detail('policies', row, cx);
    if (this.busy) return;
    if (action === 'approve') this.confirm(action, row, {}, () => this.az.approvePr(repo, row));
    if (action === 'complete') {
      try {
        if (row.isDraft) throw new Error(`#${row.id} is a draft`);
        const strategy = this.az.strategyFor(row, this.config.merge_method);
        const auto = !this.az.canComplete(row);
        const word = strategy === 'noFastForward' ? 'merge' : strategy;
        this.confirm(action, row, { strategy: word, auto },
          () => this.az.completePr(repo, row, strategy, this.config.delete_source_branch, auto));
      } catch (error) {
        this.message = this.az.errorMessage(error);
      }
    }
    if (action === 'comment') {
      this.comment = row;
      this.input.set_value('');
      this.input.focus();
    }
    if (action === 'state' || action === 'retry') {
      this.busy = true;
      cx.spawn(async (context) => {
        try {
          if (action === 'state') {
            const states = (await this.az.workStates(repo, row)).filter((entry) => entry.name !== row.state);
            if (this.repo === repo) this.picker = { row, states, index: 0 };
          } else {
            if (!failed(row)) throw new Error('Only failed runs can be retried');
            const plan = this.az.retryPlan(row, await this.az.fetchTimeline(repo, row));
            if (this.repo === repo) this.confirm(action, row, { plan }, () => this.az.retryRun(repo, row, plan));
          }
        } catch (error) {
        this.message = this.az.errorMessage(error);
      }
        finally {
          this.busy = false;
          context.notify();
        }
      });
    }
    cx.notify();
  },
  pickState(index, cx) {
    const picker = this.picker;
    const state = picker?.states[index]?.name;
    const repo = this.repo;
    if (!state) return;
    this.picker = null;
    this.confirm('state', picker.row, { state }, () => this.az.updateState(repo, picker.row, state));
    cx.notify();
  }
};
