#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createAz } from '../core/az.js';
import { isWebUrl, opener } from '../core/browser.js';
import { DEFAULT_CONFIG, validateConfig } from '../core/config.js';
import { parseRepo, resolveRemote } from '../core/remote.js';
import { createApp } from './app.js';
import { ESC } from './ansi.js';
import { run, tempFile } from './node-runner.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node panel.js [<org>/<project>/<repo> | ADO URL]');
} else {
  const configPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'config.json');
  if (!existsSync(configPath)) writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  let config;
  try {
    config = validateConfig(JSON.parse(readFileSync(configPath, 'utf8')));
  } catch (error) {
    console.error(`herdr-ado: invalid config ${configPath}\n${error.message}`);
    process.exit(1);
  }
  const az = createAz({ run, tempFile });
  const restore = () => {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write(`${ESC}?25h${ESC}?1049l`);
  };
  const enter = () => {
    process.stdout.write(`${ESC}?1049h${ESC}?25l`);
    process.stdin.setRawMode(true);
    process.stdin.resume();
  };
  process.on('exit', restore);
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGHUP', () => process.exit(0));
  const terminal = {
    columns: () => process.stdout.columns || 80,
    rows: () => process.stdout.rows || 24,
    write: (text) => process.stdout.write(text),
    quit: () => process.exit(0),
    pageText: (text) => {
      restore();
      const result = spawnSync('less', ['-R'], { input: text, stdio: ['pipe', 'inherit', 'inherit'] });
      if (result.error?.code === 'ENOENT')
        spawnSync('more', [], { input: text, stdio: ['pipe', 'inherit', 'inherit'] });
      enter();
    },
    openUrl: (url, onError) => {
      if (!isWebUrl(url)) return onError(new Error('not an https:// link'));
      const child = spawn(opener(process.platform), [url], {
        stdio: 'ignore', detached: true,
      });
      child.on('error', onError);
      child.unref();
    },
  };
  const repo = process.argv[2] ? parseRepo(process.argv[2]) : null;
  if (process.argv[2] && !repo) throw new Error('Invalid repository; use org/project/repo or an ADO URL');
  const app = createApp({
    az, config, repo, terminal,
    currentSpace: async () => ({ label: basename(process.cwd()) }),
    spaceFolder: async () => process.cwd(),
    resolveRemote: (folder) => resolveRemote(run, folder, null),
  });
  enter();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (data) => app.handleInput(data));
  process.stdout.on('resize', app.render);
  app.render();
  if (repo) app.refresh();
  else app.watchSpace();
  setInterval(app.refresh, config.refresh_seconds * 1000);
}
