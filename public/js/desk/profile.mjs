// The desk profile: the name on the desk and the ledger of settled
// fixtures. Like store.mjs it lives in localStorage only, every access is
// wrapped because storage throws in private windows, and a SCHEMA change
// drops what was saved rather than misreading it.

const KEY = 'findthebreaks:desk';
const SCHEMA = 1;
export const NAME_MAX = 16;
const NAME_OK = /^[\p{L}\p{N} .'_-]+$/u;

const empty = () => ({ schema: SCHEMA, name: '', ledger: [] });

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
    // One entry per settled run; the ledger screen sorts and picks bests
    record(entry) {
      const s = read();
      s.ledger.push({ ...entry, at: new Date().toISOString() });
      write(s);
    },
  };
}

export const profile = createProfile(() => globalThis.localStorage);
