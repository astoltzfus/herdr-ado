import test from 'node:test';
import assert from 'node:assert/strict';
import { isWebUrl, opener } from '../mods/herdr-ado/core/browser.js';

test('only https links reach the system opener', () => {
  assert.ok(isWebUrl('https://dev.azure.com/contoso/Klowd-io/_git/storefront/pullrequest/101'));
  assert.ok(isWebUrl('HTTPS://contoso.visualstudio.com/x'));
  for (const url of ['http://dev.azure.com/x', 'file:///etc/passwd', '-a Calculator', 'javascript:alert(1)',
    'https://dev.azure.com/x y', '', null, undefined, 42]) {
    assert.equal(isWebUrl(url), false, String(url));
  }
});

test('opener picks open on macOS and xdg-open elsewhere', () => {
  assert.equal(opener('macos'), 'open');
  assert.equal(opener('darwin'), 'open');
  assert.equal(opener('linux'), 'xdg-open');
  assert.equal(opener(undefined), 'xdg-open');
});
