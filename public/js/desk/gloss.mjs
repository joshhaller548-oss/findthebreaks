// Glossary terms in place. gloss(text) returns the text with the first
// mention of each glossary term turned into a small button; hovering,
// focusing or tapping it shows the definition in a popover beside it, so
// the player never leaves the desk. glossSegments() does the matching and
// has no DOM, so the tests can check it.

import { h } from '../dom.mjs';
import { glossary } from './glossary.mjs';

// Every form of every term, longest first so "SHEX EIU" wins over a
// shorter overlap and "weather working days" over "weather working day".
// Terms written in capitals (NOR, WIBON, SHEX EIU) match only in capitals,
// so the word "nor" is never underlined.
const forms = glossary
  .flatMap((g) => [g.term, ...(g.match ?? [])].map((f) => ({ form: f, entry: g, exact: f === f.toUpperCase() })))
  .sort((a, b) => b.form.length - a.form.length);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = new RegExp(`\\b(${forms.map((f) => escape(f.form)).join('|')})\\b`, 'gi');

// [{ text }, { text, entry }...]: the first mention of each term in `text`.
// Pass the same `seen` set to several calls to underline a term once across
// them.
export function glossSegments(text, seen = new Set()) {
  const out = [];
  let at = 0;
  pattern.lastIndex = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    const hit = forms.find((f) => (f.exact ? f.form === m[0] : f.form.toLowerCase() === m[0].toLowerCase()));
    if (!hit || seen.has(hit.entry.term)) continue;
    seen.add(hit.entry.term);
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push({ text: m[0], entry: hit.entry });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

export function gloss(text, seen) {
  return glossSegments(String(text), seen).map((s) => (s.entry
    ? h('button', { type: 'button', class: 'gl', 'data-term': s.entry.term, 'aria-expanded': 'false', 'aria-controls': 'gloss-pop' }, s.text)
    : s.text));
}

// ---------- the popover, one for the page ----------

let pop = null;
let anchor = null;
let pinned = false;
const byTerm = new Map(glossary.map((g) => [g.term, g]));

function place() {
  if (!anchor?.isConnected) return hide();
  const r = anchor.getBoundingClientRect();
  const gutter = 16;
  const width = Math.min(340, document.documentElement.clientWidth - 2 * gutter);
  pop.style.width = `${width}px`;
  const left = Math.max(gutter, Math.min(r.left, document.documentElement.clientWidth - gutter - width));
  const below = r.bottom + 8;
  const above = r.top - 8 - pop.offsetHeight;
  const top = below + pop.offsetHeight > innerHeight && above > 0 ? above : below;
  pop.style.left = `${left + scrollX}px`;
  pop.style.top = `${top + scrollY}px`;
}

function show(btn, pin = false) {
  const g = byTerm.get(btn.dataset.term);
  if (!g) return;
  if (anchor && anchor !== btn) anchor.setAttribute('aria-expanded', 'false');
  anchor = btn;
  pinned = pin;
  // No link out: following it would leave a desk that is running
  pop.replaceChildren(...[
    h('p', { class: 'gp-term' }, g.term, g.long ? h('span', { class: 'gp-long' }, ` · ${g.long}`) : null),
    h('p', { class: 'gp-def' }, g.def),
    g.example ? h('p', { class: 'gp-example' }, g.example) : null,
  ].filter(Boolean));
  pop.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-describedby', 'gloss-pop');
  place();
}

function hide() {
  if (!pop) return;
  pop.hidden = true;
  anchor?.setAttribute('aria-expanded', 'false');
  anchor?.removeAttribute('aria-describedby');
  anchor = null;
  pinned = false;
}

// Wire the page once. Hover shows for a mouse; focus shows for the
// keyboard; a tap or click pins it open; Escape, a tap elsewhere or
// leaving the term closes it.
export function installGloss() {
  if (pop) return;
  pop = h('div', { id: 'gloss-pop', class: 'gloss-pop', role: 'tooltip', hidden: true });
  document.body.append(pop);
  const term = (e) => e.target.closest?.('.gl');
  document.addEventListener('pointerover', (e) => { const b = term(e); if (b && e.pointerType === 'mouse' && !pinned) show(b); });
  document.addEventListener('pointerout', (e) => { const b = term(e); if (b && b === anchor && !pinned && !pop.contains(e.relatedTarget)) hide(); });
  // Only keyboard focus opens it: focus moved by script, or after a tap,
  // is not :focus-visible
  document.addEventListener('focusin', (e) => { const b = term(e); if (b && b.matches(':focus-visible')) show(b); else if (!b && !pop.contains(e.target)) hide(); });
  document.addEventListener('click', (e) => {
    const b = term(e);
    if (b) {
      e.preventDefault();
      if (anchor === b && pinned) hide(); else show(b, true);
    } else if (!pop.contains(e.target)) hide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) {
      const back = anchor;
      hide();
      back?.focus();
    }
  });
  addEventListener('resize', () => anchor && place());
  addEventListener('hashchange', hide);
}
