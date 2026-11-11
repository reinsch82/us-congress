// Party names as they appear in congress-legislators, normalised to one label each,
// with a display colour and a left-to-right seating order for the hemicycle.
// The ordering follows the usual US convention: the Democratic lineage on the left,
// the Federalist/Whig/Republican lineage on the right, everyone else in between.

const ALIASES = {
  'Jackson': 'Jacksonian',
  'Jackson Republican': 'Jacksonian',
  'Jacksonian Republican': 'Jacksonian',
  'Anti Jacksonian': 'Anti-Jacksonian',
  'Anti Jackson': 'Anti-Jacksonian',
  'Anti Masonic': 'Anti-Masonic',
  'Anti Mason': 'Anti-Masonic',
  'Pro-administration': 'Pro-Administration',
  'Anti-administration': 'Anti-Administration',
  'Democratic Republican': 'Democratic-Republican',
  'Independent Democrat': 'Ind. Democrat',
  'AL': 'American Labor',
};

// order: smaller = further left. color: fill used for seats and the timeline.
export const PARTIES = {
  'Democrat':              { order: 10, color: '#2563c9' },
  'Jacksonian':            { order: 12, color: '#4f8fe0' },
  'Democratic-Republican': { order: 14, color: '#2a9d8f' },
  'Anti-Administration':   { order: 16, color: '#52a868' },
  'Ind. Democrat':         { order: 20, color: '#7aa7e6' },
  'Farmer-Labor':          { order: 22, color: '#3f9b4f' },
  'Socialist':             { order: 23, color: '#e05d8a' },
  'American Labor':        { order: 24, color: '#d17aa5' },
  'Progressive':           { order: 30, color: '#4caf50' },
  'Populist':              { order: 31, color: '#9bbf3b' },
  'Free Soil':             { order: 32, color: '#6b8e23' },
  'Independent':           { order: 40, color: '#2f9e75' },
  'Unknown':               { order: 50, color: '#9aa0a6' },
  'Vacant':                { order: 55, color: 'transparent' },
  'Nullifier':             { order: 60, color: '#7d5a50' },
  'Anti-Masonic':          { order: 62, color: '#8a63b8' },
  'American':              { order: 64, color: '#b56576' },
  'Unionist':              { order: 66, color: '#7a8ca5' },
  'Unconditional Unionist':{ order: 67, color: '#5f7391' },
  'Ind. Republican':       { order: 76, color: '#e58a8a' },
  'Pro-Administration':    { order: 84, color: '#d9883b' },
  'Federalist':            { order: 86, color: '#ee7d3b' },
  'Adams':                 { order: 87, color: '#c07a1a' },
  'Anti-Jacksonian':       { order: 88, color: '#b45309' },
  'Whig':                  { order: 89, color: '#d99e0b' },
  'Republican':            { order: 90, color: '#d0312d' },
};

// Muted fallback hues for the long tail of small parties.
const FALLBACK = ['#8d99ae', '#a3917b', '#7f9c96', '#a58ab0', '#9c9a6b', '#b0837f', '#7d8fb3', '#94a77f'];

export function normaliseParty(name, day, firstGopDay) {
  if (!name) return 'Unknown';
  let n = ALIASES[name] || name;
  // Before the modern party was founded, "Republican" means the Jeffersonian Republicans.
  if (n === 'Republican' && day < firstGopDay) n = 'Democratic-Republican';
  return n;
}

export function partyInfo(name) {
  if (PARTIES[name]) return PARTIES[name];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  PARTIES[name] = { order: 45 + (h % 10) / 10, color: FALLBACK[h % FALLBACK.length] };
  return PARTIES[name];
}

// Short labels for the tally chips.
export function partyAbbrev(name) {
  return ({ Democrat: 'D', Republican: 'R', Independent: 'I', Vacant: 'Vacant' })[name] || name;
}
