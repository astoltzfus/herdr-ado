import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: options.cwd,
      timeout: options.timeout,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, AZURE_CORE_NO_COLOR: 'true', AZURE_CORE_ONLY_SHOW_ERRORS: 'true' },
    }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') return reject(error);
      resolve({ code: error?.code || 0, stdout, stderr });
    });
  });
}

export async function tempFile(text) {
  const dir = await mkdtemp(join(tmpdir(), 'herdr-ado-'));
  const path = join(dir, 'body.json');
  try {
    await writeFile(path, text);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  return { path, remove: () => rm(dir, { recursive: true, force: true }) };
}
