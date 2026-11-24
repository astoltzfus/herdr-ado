export const DEFAULT_CONFIG = {
  refresh_seconds: 120,
  merge_method: 'merge',
  delete_source_branch: false,
  run_limit: 20,
  log_tail_lines: 300,
  security_tab: false,
  work_item_hidden_states: ['Closed', 'Done', 'Removed', 'Completed', 'Cut'],
};
const MERGE_METHODS = ['merge', 'squash', 'rebase', 'rebaseMerge'];
const MIN_REFRESH_SECONDS = 30;
const MAX_RUN_LIMIT = 100;
export function validateConfig(input = {}) {
  const config = { ...DEFAULT_CONFIG, ...input };
  if (!MERGE_METHODS.includes(config.merge_method)) {
    throw new Error(`merge_method must be one of ${MERGE_METHODS.join(', ')}`);
  }
  const runLimit = Number(config.run_limit);
  if (!Number.isInteger(runLimit) || runLimit < 1 || runLimit > MAX_RUN_LIMIT) {
    throw new Error(`run_limit must be a whole number from 1 to ${MAX_RUN_LIMIT}`);
  }
  if (!Number.isInteger(config.log_tail_lines) || config.log_tail_lines < 50 || config.log_tail_lines > 5000)
    throw new Error('log_tail_lines must be a whole number from 50 to 5000');
  if (
    typeof config.security_tab !== 'boolean' ||
    typeof config.delete_source_branch !== 'boolean' ||
    !Array.isArray(config.work_item_hidden_states) ||
    !config.work_item_hidden_states.every((s) => typeof s === 'string') ||
    !config.work_item_hidden_states.length
  )
    throw new Error('invalid config values');
  return {
    ...config,
    run_limit: runLimit,
    refresh_seconds: Math.max(MIN_REFRESH_SECONDS, Number(config.refresh_seconds) || 0),
  };
}
