// Progress lives in localStorage and nowhere else. It holds which drills are
// complete and the last submitted answer per drill per language. Every
// access is wrapped, because storage throws in private windows.

const KEY = 'findthebreaks:v1';
const empty = () => ({ complete: {}, answers: {} });

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    if (parsed && typeof parsed === 'object') return { ...empty(), ...parsed };
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
