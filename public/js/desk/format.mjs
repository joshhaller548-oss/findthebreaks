// How the desk writes times, hours and money. No DOM, so the tests can
// check the exact strings the player sees.

import { fromMin, toMin, DAYS } from '../laytime/calc.mjs';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const USD = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const N = new Intl.NumberFormat('en-GB');

// "Wed 9 Sep, 21:00" from "2026-09-09 21:00"
export function when(stamp) {
  const d = new Date(toMin(stamp) * 60000);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${stamp.slice(11, 16)}`;
}
export const stamp = (t) => when(fromMin(t));
// "Sat 3 Oct, 12:30 to 20:30", or both dates when it crosses midnight
export function span(a, b) {
  const [sa, sb] = [fromMin(a), fromMin(b)];
  return sa.slice(0, 10) === sb.slice(0, 10) ? `${stamp(a)} to ${sb.slice(11)}` : `${stamp(a)} to ${stamp(b)}`;
}

// Hours and minutes on a clock face, hours always two digits: 02:00, 120:00
export const hm = (min) => {
  const m = Math.abs(Math.round(min));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
export const hrs = (min) => (min / 60).toFixed(2);
export const owed = (r, amount) => (r === 'level' ? 'Level' : `${r === 'demurrage' ? 'Demurrage' : 'Despatch'} USD ${USD.format(amount)}`);
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ISO stamps inside a sentence, such as a drill 8 model note, in the desk's
// own format. "from A to B" on one day reads as one span. `shift` moves
// every stamp by that many minutes, for a vessel moved on the desk calendar.
const ISO = '\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}';
export function humanDates(text, shift = 0) {
  const at = (s) => toMin(s) + shift;
  return String(text)
    .replace(new RegExp(`from (${ISO}) to (${ISO})`, 'g'), (_, a, b) => `from ${span(at(a), at(b))}`)
    .replace(new RegExp(ISO, 'g'), (s) => stamp(at(s)));
}
export const hasIsoDate = (text) => new RegExp(ISO).test(String(text));
