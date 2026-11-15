// Helpers shared by the Congress page (app.js) and the governors page (governors.js).
import { toDay } from './model.js';
import { partyInfo } from './parties.js';

// Replaced with the commit ID at deploy time by scripts/stamp-build.sh.
export const BUILD = 'dev';

export const $ = (sel, root = document) => root.querySelector(sel);
export const today = toDay(new Date().toISOString().slice(0, 10));
export const yieldToBrowser = () => new Promise((r) => setTimeout(r, 0));

export const fmtDate = (day) => new Date(day * 864e5).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
export const fmtShort = (day) => new Date(day * 864e5).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
export const fmtYear = (day) => String(new Date(day * 864e5).getUTCFullYear());
export const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const colorOf = (party) => (party === 'Vacant' ? 'transparent' : partyInfo(party).color);
export const swatch = (party) => `<span class="swatch${party === 'Vacant' ? ' vacant' : ''}" style="background:${colorOf(party)}"></span>`;

// Last index i with list[i].day <= day, or -1.
export function eventIndexAtOrBefore(list, day) {
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].day <= day) lo = mid + 1; else hi = mid - 1;
  }
  return hi;
}

// A browser can hold a cached page from an earlier deploy while fetching this newer
// script (GitHub Pages lets both be cached for 10 minutes). Reload once to get a
// matching page instead of running against markup this script doesn't know.
export function checkBuild() {
  const pageBuild = document.querySelector('meta[name="build"]')?.content;
  if (pageBuild === BUILD) return true;
  const key = `reloaded-for-${BUILD}`;
  try {
    if (sessionStorage.getItem(key)) return true;
    sessionStorage.setItem(key, '1');
  } catch {
    return true;
  }
  location.reload();
  return false;
}
