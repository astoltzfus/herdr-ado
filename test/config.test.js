import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, validateConfig } from '../mods/herdr-ado/core/config.js';
test('configuration supplies defaults, clamps refresh and rejects invalid values', () => {
  assert.deepEqual(validateConfig(), DEFAULT_CONFIG);
  assert.equal(validateConfig({ refresh_seconds: 1 }).refresh_seconds, 30);
  assert.throws(() => validateConfig({ merge_method: 'invalid' }), /merge_method/);
  assert.throws(() => validateConfig({ run_limit: 101 }), /run_limit/);
  assert.throws(() => validateConfig({ log_tail_lines: 49 }), /log_tail_lines/);
  assert.throws(() => validateConfig({ security_tab: 'yes' }), /invalid config/);
});
