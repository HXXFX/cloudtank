import { el } from './ui/dom.js';

export const NAME = 'Cloudtank';

const MARK = '<g transform="translate(0 -3.5)">' +
  '<path d="M18.50 32.00 L 44.50 32.00 L 44.50 36.00 L 18.50 36.00 Z" fill="currentColor" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<circle cx="31" cy="22" r="9" fill="currentColor"/><circle cx="20.5" cy="28" r="6.5" fill="currentColor"/>' +
  '<circle cx="42" cy="25.5" r="7.5" fill="currentColor"/><circle cx="49" cy="31" r="5" fill="currentColor"/>' +
  '<circle cx="14.5" cy="32.5" r="4.5" fill="currentColor"/>' +
  '<path d="M4 36 C 10 33, 16 33, 22 36 S 34 39.5, 40 36 S 52 33, 60 36 L 60 54 A 4 4 0 0 1 56 58 L 8 58 A 4 4 0 0 1 4 54 Z" style="fill: var(--accent)"/>' +
  '</g>';

export function logoMark(size = 22) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = MARK;
  return svg;
}

export function lockup(tag = 'span', attrs = {}) {
  return el(tag, { class: 'brand', ...attrs }, logoMark(), el('span', { class: 'word' }, NAME));
}
