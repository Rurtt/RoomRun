// Booth leaderboard: top 5 runs on this laptop, kept in localStorage. No typing:
// a player taps one of the avatars (an animal + its Thai name) to sign a run.

export const SIZE = 5;
const KEY = 'roomrun.leaderboard.v1';

/** Tap-to-pick avatars. Index is what gets saved. */
export const AVATARS = [
  { icon: '🐯', name: 'เสือ' }, { icon: '🐰', name: 'กระต่าย' }, { icon: '🐼', name: 'แพนด้า' }, { icon: '🦊', name: 'จิ้งจอก' },
  { icon: '🐸', name: 'กบ' }, { icon: '🐵', name: 'ลิง' }, { icon: '🐔', name: 'ไก่' }, { icon: '🐢', name: 'เต่า' },
];

/** @typedef {{ avatar: number, score: number, at: number }} Entry */

/** @param {any} raw @returns {Entry[]} best first, at most SIZE, junk dropped */
export function clean(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => e && Number.isFinite(e.score) && Number.isInteger(e.avatar) && e.avatar >= 0 && e.avatar < AVATARS.length)
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, SIZE);
}

/** Would this score make the board? Ties with the 5th place don't (first one there keeps it). */
export function qualifies(list, score) {
  return score > 0 && (list.length < SIZE || score > list[list.length - 1].score);
}

/** @returns {{ list: Entry[], rank: number }} rank 0-based, -1 if it fell off */
export function insert(list, entry) {
  const next = clean([...list, entry]);
  return { list: next, rank: next.indexOf(entry) };
}

/**
 * "So close" target for the caught screen: the entry just above this run.
 * rank = where the run landed (0-based), -1 = missed the board.
 * lead = how far ahead the rival is (0 = tie). close = lead within 10% of the rival's score.
 * @returns {{ avatar: number, lead: number, close: boolean } | null} null for a new #1, empty board or score 0
 */
export function rival(list, score, rank) {
  if (!(score > 0) || rank === 0 || list.length === 0) return null;
  const r = rank > 0 ? list[rank - 1] : list[list.length - 1];
  if (!r) return null;
  const lead = r.score - score;
  return { avatar: r.avatar, lead, close: lead <= r.score * 0.1 };
}

/** @param {Storage|null} storage */
export function createLeaderboard(storage = safeStorage()) {
  let list = [];
  try { list = clean(JSON.parse(storage?.getItem(KEY) ?? '[]')); } catch { list = []; }
  const save = () => { try { storage?.setItem(KEY, JSON.stringify(list)); } catch { /* private mode: board lives until reload */ } };
  return {
    get list() { return list; },
    qualifies: (score) => qualifies(list, score),
    /** @returns {number} rank 0-based, -1 if it did not make it */
    add(entry) { const r = insert(list, entry); list = r.list; save(); return r.rank; },
    clear() { list = []; save(); },
  };
}

function safeStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
