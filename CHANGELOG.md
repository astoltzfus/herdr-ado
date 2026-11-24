# Changelog

## 0.3.0 — 2026-11-24

- Details (PR, policies, run log, work item) open inside the panel with a ◀ back button, instead of a new pane.
- Confirmations for approve, complete, retry, state change and comment are a dialog over the panel.
- CI run icons are coloured; Retry only shows on runs that failed.
- Ctrl-Alt-A focuses the panel already in the tab instead of opening another.
- Complete uses `az repos pr update` (merge or squash), fixing "does not support http method PATCH".
- Work tab finds items again: the WIQL query names the project instead of `@project`.

## 0.2.0 — 2026-11-23

Moved to a Herdr desktop mod with a shared core and a herdr-core terminal panel for mobile.

## 0.1.0 — 2026-11-23

First release: PRs, pipeline runs, work items and optional Advanced Security alerts.
