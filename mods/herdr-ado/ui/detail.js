import { EditorState } from 'gpui-base';
import { settings } from 'herdr';
import * as views from '../core/views.js';
import { failed } from './logic.js';

export const detail = {
  loadDetail(cx) {
    if (!this.view) return;
    const detail = { ...this.view, token: ++this.viewToken };
    this.view = detail;
    const repo = this.viewRepo;
    this.detailLoading = true;
    this.detailError = false;
    this.detailText = null;
    this.editor = null;
    this.detailUrl = null;
    cx.notify();
    cx.spawn(async (context) => {
      try {
        const { kind, id } = detail;
        let content;
        let url;
        if (kind === 'pr' || kind === 'policies') {
          const raw = await this.az.showPr(repo, { id });
          const pr = { id, title: raw.title, projectId: raw.repository?.project?.id, repoId: raw.repository?.id };
          url = `https://dev.azure.com/${encodeURIComponent(repo.org)}/${encodeURIComponent(repo.project)}` +
            `/_git/${encodeURIComponent(repo.repo)}/pullrequest/${id}`;
          content = kind === 'pr' ? views.prMarkdown(raw, await this.az.fetchThreads(repo, pr)) :
            views.policiesText(pr, await this.az.fetchPolicies(repo, pr));
        } else if (kind === 'workitem') {
          const item = await this.az.showWorkItem(repo, { id });
          content = views.workItemMarkdown(item, await this.az.workComments(repo, { id }));
          url = `https://dev.azure.com/${encodeURIComponent(repo.org)}/` +
            `${encodeURIComponent(repo.project)}/_workitems/edit/${id}`;
        } else {
          const item = (await this.az.fetchRuns(repo, this.config.run_limit)).find((entry) => entry.id === id);
          if (!item) throw new Error('Run no longer in the recent runs list');
          url = item.url;
          const records = await this.az.fetchTimeline(repo, item);
          content = failed(item) ? views.logsText(await this.az.fetchRunLogs(repo, item, records,
            this.config.log_tail_lines)) : views.runText(item, records);
        }
        if (this.view?.token !== detail.token) return;
        this.detailUrl = url;
        this.detailText = content;
        this.editor = EditorState.new({ readonly: true, value: content, font_family: settings().font_family });
      } catch (error) {
        if (this.view?.token !== detail.token) return;
        this.detailError = true;
        this.detailText = this.az.errorMessage(error);
      } finally {
        if (this.view?.token === detail.token) {
          this.detailLoading = false;
          context.notify();
        }
      }
    });
  }
};
