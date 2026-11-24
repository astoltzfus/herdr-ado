function parseRemote(value) {
  let s = String(value || '').trim();
  let m = s.match(/^https:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+)\/?$/i);
  if (!m) {
    const v = s.match(
      /^https:\/\/(?:[^@/]+@)?([^.\/]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/?#]+)\/?$/i,
    );
    if (v) m = v;
  }
  if (!m) {
    const v = s.match(
      new RegExp(
        '^(?:ssh://)?(?:git@ssh\\.dev\\.azure\\.com|[^@/]+@vs-ssh\\.visualstudio\\.com)' +
          '(?::22/|:|/)v3/([^/]+)/([^/]+)/([^/?#]+)/?$',
        'i',
      ),
    );
    if (v) m = v;
  }
  if (!m) return null;
  try {
    return {
      org: decodeURIComponent(m[1]),
      project: decodeURIComponent(m[2]),
      repo: decodeURIComponent(m[3]).replace(/\.git$/i, ''),
    };
  } catch {
    return null;
  }
}
async function resolveRemote(run, folder, machine) {
  if (!folder) return null;
  const git = async (...args) => {
    const result = await run('git', ['-C', folder, ...args], { on: machine });
    if (result.code !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  try {
    const names = (await git('remote')).split('\n').filter(Boolean);
    let upstream = '';
    try {
      upstream = (await git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}')).split('/')[0];
    } catch {
      /* no upstream */
    }
    const ordered = [...new Set([upstream, 'origin', ...names])].filter((n) => names.includes(n));
    for (const name of ordered) {
      try {
        const repo = parseRemote(await git('remote', 'get-url', name));
        if (repo) return repo;
      } catch {
        /* try the next remote */
      }
    }
  } catch {
    /* not a git repository */
  }
  return null;
}
function parseRepo(value) {
  const remote = parseRemote(value);
  if (remote) return remote;
  const parts = String(value || '').split('/');
  return parts.length === 3 && parts.every(Boolean) ? { org: parts[0], project: parts[1], repo: parts[2] } : null;
}
export { parseRemote, resolveRemote, parseRepo };
