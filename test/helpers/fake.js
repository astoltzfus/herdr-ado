export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export const stripAnsi = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
