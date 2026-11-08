export const VERSION = '0.56';
export const VERSION_DATE = '8 Nov 2026';

const at = typeof document !== 'undefined' && document.getElementById('loading-version');
if (at) at.textContent = `Version ${VERSION}`;
