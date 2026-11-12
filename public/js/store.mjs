// Progress lives in localStorage and nowhere else. It holds which drills are
// solved and the last submitted answer per drill per language. Every access
// is wrapped, because storage throws in private windows.
//
// A drill is solved cleanly (full tick) or after revealing the answer
// (hollow tick). The two are stored apart. A clean solve upgrades a hollow
// tick; a later solve after reveal never downgrades a full one.
//
// Two versions guard it. SCHEMA is the shape of this object: change it and
// all saved progress is dropped. Each task and language also records the
// fingerprint of the answer key its ticks were earned against; when that
// changes, those ticks are cleared and the saved answers are kept.

const KEY = 'findthebreaks:progress';
const SCHEMA = 3;
const RETIRED_KEYS = ['findthebreaks:v1'];

const empty = () => ({ schema: SCHEMA, keys: {}, solved: {}, afterReveal: {}, answers: {} });
const id = (task, drill, lang) => `${task}:${drill}:${lang}`;

export function createStore(getStorage) {
  const storage = () => {
    try {
      return getStorage();
    } catch {
      return null;
    }
  };

  function read() {
    try {
      const parsed = JSON.parse(storage()?.getItem(KEY));
      if (parsed && parsed.schema === SCHEMA) return { ...empty(), ...parsed };
    } catch {}
    return empty();
  }

  function write(state) {
    try {
      storage()?.setItem(KEY, JSON.stringify(state));
    } catch {}
  }

  return {
    // Call once per page load per language with that language's key
    // fingerprint. Returns how many ticks were cleared.
    syncKey(task, lang, fingerprint) {
      try {
        for (const k of RETIRED_KEYS) storage()?.removeItem(k);
      } catch {}
      const s = read();
      const slot = `${task}:${lang}`;
      if (s.keys[slot] === fingerprint) return 0;
      let cleared = 0;
      for (const map of [s.solved, s.afterReveal]) {
        for (const k of Object.keys(map)) {
          if (k.startsWith(`${task}:`) && k.endsWith(`:${lang}`)) {
            delete map[k];
            cleared++;
          }
        }
      }
      s.keys[slot] = fingerprint;
      write(s);
      return cleared;
    },
    // 'clean', 'after-reveal' or null
    status(task, drill, lang) {
      const s = read();
      const k = id(task, drill, lang);
      return s.solved[k] ? 'clean' : s.afterReveal[k] ? 'after-reveal' : null;
    },
    // Best status across every language
    statusInAny(task, drill) {
      const s = read();
      const prefix = `${task}:${drill}:`;
      if (Object.keys(s.solved).some((k) => k.startsWith(prefix))) return 'clean';
      if (Object.keys(s.afterReveal).some((k) => k.startsWith(prefix))) return 'after-reveal';
      return null;
    },
    markSolved(task, drill, lang, { afterReveal = false } = {}) {
      const s = read();
      const k = id(task, drill, lang);
      if (afterReveal) {
        if (!s.solved[k]) s.afterReveal[k] = true;
      } else {
        s.solved[k] = true;
        delete s.afterReveal[k];
      }
      write(s);
      return s.solved[k] ? 'clean' : 'after-reveal';
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
}

export const store = createStore(() => globalThis.localStorage);
