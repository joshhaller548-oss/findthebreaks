// Fixtures for the desk. The training cargo is the worked example with the
// terms from the defaults file; fixtures 1 onwards are the twelve in
// laytime.json. Every number the desk shows comes from calc.mjs.

import { calculate, workedExample, deductions } from '../laytime/calc.mjs';

const getJSON = (p) => fetch(p).then((r) => {
  if (!r.ok) throw new Error(`Could not load ${p}`);
  return r.json();
});

export async function loadFixtures() {
  const [example, defaults, data] = await Promise.all([
    getJSON('/data/laytime-worked-example.json'),
    getJSON('/config/laytime-defaults.json'),
    getJSON('/data/laytime.json'),
  ]);
  const w = workedExample(example, defaults);
  const training = {
    n: 0,
    training: true,
    label: 'Training cargo',
    fixture: { ...w.fixture, vessel: 'Training cargo' },
    stoppages: example.stoppages,
    result: w.result,
    owner: null,
  };
  training.events = deductions(training.fixture, training.stoppages);
  const t = data.tables;
  const owners = Object.fromEntries(t.owner_statement.map((o) => [o.voyage_id, o]));
  const fixtures = t.fixtures.map((f, i) => {
    const stoppages = t.stoppages.filter((s) => s.voyage_id === f.voyage_id);
    return {
      n: i + 1,
      training: false,
      label: `Fixture ${i + 1}`,
      fixture: f,
      stoppages,
      result: calculate(f, stoppages),
      events: deductions(f, stoppages),
      owner: owners[f.voyage_id] ?? null,
    };
  });
  return [training, ...fixtures];
}
