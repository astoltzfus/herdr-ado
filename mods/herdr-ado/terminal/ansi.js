

// Minimal ANSI styling. Each helper resets only its own attribute so styles nest.

const ESC = '\x1b[';
const color = (code) => (t) => `${ESC}${code}m${t}${ESC}39m`;

export const green = color(32);
export const red = color(31);
export const yellow = color(33);
export const magenta = color(35);
export const cyan = color(36);
export const dim = (text) => `${ESC}2m${text}${ESC}22m`;
export const bold = (text) => `${ESC}1m${text}${ESC}22m`;
export const inverse = (text) => `${ESC}7m${text}${ESC}27m`;
export { ESC };
