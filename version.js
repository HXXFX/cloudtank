export const VERSION = '0.60';
export const VERSION_DATE = '10 Nov 2026';

const at = typeof document !== 'undefined' && document.getElementById('loading-version');
if (at) at.textContent = `Version ${VERSION}`;
