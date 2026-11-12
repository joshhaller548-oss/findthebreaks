// The glossary. One line each, in desk language. Order is the order a
// laytime calculation meets them.

export const glossary = [
  { term: 'Laytime', def: 'The time the charterer gets to load the cargo, agreed in the charter party. Go over it and you pay.' },
  { term: 'NOR', long: 'Notice of readiness', def: 'The master’s notice that the vessel has arrived and is ready to load. It starts the countdown, not the clock.' },
  { term: 'Turn time', def: 'Free hours after NOR before laytime starts, often 12. If loading starts sooner, laytime starts with loading.' },
  { term: 'Statement of facts', def: 'The agent’s log of what happened and when: NOR, loading, every stoppage. Every laytime calculation is built from it.' },
  { term: 'Demurrage', def: 'What the charterer pays the owner for every hour loading runs past laytime, pro rata at a daily rate.' },
  { term: 'Despatch', def: 'What the owner pays the charterer for finishing early. Usually half the demurrage rate.' },
  { term: 'SHEX EIU', long: 'Sundays and holidays excepted, even if used', def: 'The window comes off the clock whether or not they kept loading.' },
  { term: 'SHEX UU', long: 'Sundays and holidays excepted, unless used', def: 'The window comes off the clock only for the hours nobody worked.' },
  { term: 'SHINC', long: 'Sundays and holidays included', def: 'Every hour counts. The weekend is just more laytime.' },
  { term: 'Weather working day', def: 'A day that counts only when the weather lets them work. Rain or swell that stops loading comes off the clock.' },
  { term: 'WIBON', long: 'Whether in berth or not', def: 'Laytime runs while the vessel waits for a berth. Congestion is the charterer’s problem, not the owner’s.' },
  { term: 'Working time saved', def: 'Despatch is paid on laytime saved only. Excepted time after completion earns nothing.' },
  { term: 'All time saved', def: 'Despatch is paid on every hour from completion until laytime would have run out, excepted time included.' },
];
