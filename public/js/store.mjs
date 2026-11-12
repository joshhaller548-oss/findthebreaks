// Progress lives in localStorage and nowhere else. It holds which drills are
// complete and the last submitted answer per drill per language. Every
// access is wrapped, because storage throws in private windows.
//
// Two versions guard it. SCHEMA is the shape of this object: change it and
// all saved progress is dropped. Each task also records the fingerprint of
// the answer key its ticks were earned against; when the key changes, that
// task's ticks are cleared and its saved answers are kept.

const KEY = 'findthebreaks:progress';
const SCHEMA = 2;
const RETIRED_KEYS = ['findthebreaks:v1'];

const empty = () => ({ schema: SCHEMA, keys: {}, complete: {}, answers: {} });

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    if (parsed && parsed.schema === SCHEMA) return { ...empty(), ...parsed };
  } catch {}
  return empty();
}

function write(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

const id = (task, drill, lang) => `${task}:${drill}:${lang}`;

export const store = {
  // Call once per page load with the key's fingerprint. Returns how many
  // ticks were cleared because the key changed since they were earned.
  syncKey(task, fingerprint) {
    try {
      for (const k of RETIRED_KEYS) localStorage.removeItem(k);
    } catch {}
    const s = read();
    if (s.keys[task] === fingerprint) return 0;
    const stale = Object.keys(s.complete).filter((k) => k.startsWith(`${task}:`));
    for (const k of stale) delete s.complete[k];
    s.keys[task] = fingerprint;
    write(s);
    return stale.length;
  },
  isComplete(task, drill, lang) {
    return !!read().complete[id(task, drill, lang)];
  },
  completeInAny(task, drill) {
    const prefix = `${task}:${drill}:`;
    return Object.keys(read().complete).some((k) => k.startsWith(prefix));
  },
  markComplete(task, drill, lang) {
    const s = read();
    s.complete[id(task, drill, lang)] = true;
    write(s);
  },
  lastAnswer(task, drill, lang) {
    return read().answers[id(task, drill, lang)] ?? '';
  },
  saveAnswer(task, drill, lang, text) {
    const s = read();
    s.answers[id(task, drill, lang)] = text;
    write(s);
  },
};
