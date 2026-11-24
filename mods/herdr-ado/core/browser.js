// Links come from Azure DevOps API responses, so only hand real web links to the system opener.
const WEB_URL = /^https:\/\/[^\s]+$/i;

export const isWebUrl = (url) => typeof url === 'string' && WEB_URL.test(url);

// macOS has `open`; elsewhere `open` may be another program (openvt on Debian/Ubuntu), so use xdg-open.
export const opener = (platform) => (platform === 'macos' || platform === 'darwin' ? 'open' : 'xdg-open');
