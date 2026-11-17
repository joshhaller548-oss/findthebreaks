// The desk profile: the name on the desk and the ledger of settled
// fixtures. Like store.mjs it lives in localStorage only, every access is
// wrapped because storage throws in private windows, and a SCHEMA change
// drops what was saved rather than misreading it.

const KEY = 'findthebreaks:desk';
const SCHEMA = 1;
export const NAME_MAX = 16;
const NAME_OK = /^[\p{L}\p{N} .'_-]+$/u;

const empty = () => ({ schema: SCHEMA, name: '', ledger: [], seen: [], progress: {} });

export function cleanName(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, reason: 'Type a name first.' };
  if (name.length > NAME_MAX) return { ok: false, reason: `Keep it to ${NAME_MAX} characters.` };
  if (!NAME_OK.test(name)) return { ok: false, reason: 'Letters, numbers, spaces and . \' _ - only.' };
  return { ok: true, name };
}

export function createProfile(getStorage) {
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
    name: () => read().name,
    setName(raw) {
      const c = cleanName(raw);
      if (c.ok) write({ ...read(), name: c.name });
      return c;
    },
    ledger: () => read().ledger,
    // A desk in progress, by ledger key: { sig, log, T, ... }
    progress: (key) => read().progress[key] ?? null,
    saveProgress(key, data) {
      const s = read();
      write({ ...s, progress: { ...s.progress, [key]: { ...data, at: new Date().toISOString() } } });
    },
    clearProgress(key) {
      const s = read();
      if (!(key in s.progress)) return;
      const { [key]: _, ...rest } = s.progress;
      write({ ...s, progress: rest });
    },
    // One-time explanations already shown in this browser
    seen: (key) => read().seen.includes(key),
    markSeen(key) {
      const s = read();
      if (!s.seen.includes(key)) write({ ...s, seen: [...s.seen, key] });
    },
    // One entry per settled run; the ledger screen sorts and picks bests
    record(entry) {
      const s = read();
      s.ledger.push({ ...entry, at: new Date().toISOString() });
      write(s);
    },
  };
}

export const profile = createProfile(() => globalThis.localStorage);
