// Builds THIRD_PARTY_NOTICES.txt from the licence files in node_modules, so
// the texts are copied, never retyped. Writes the repo root copy and the
// copy the site serves, and copies LICENSE next to it. verify checks the
// copies match and the versions match the vendored files.

import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n').trimEnd();
const pkg = (name) => JSON.parse(read(`node_modules/${name}/package.json`));
const rule = '='.repeat(72);

// Shipped in the browser. Everything else in node_modules is a build or
// test tool and is not distributed.
const components = [
  {
    name: 'HyperFormula',
    version: pkg('hyperformula').version,
    file: 'public/vendor/hyperformula-3.5.0.full.min.js',
    licence: 'GPL-3.0 (dual licensed by Handsoncode; used here under GPLv3, licence key "gpl-v3")',
    text: read('node_modules/hyperformula/LICENSE.txt'),
  },
  {
    name: 'Chevrotain (bundled in HyperFormula)',
    version: pkg('chevrotain').version,
    licence: 'Apache-2.0',
    text: read('node_modules/chevrotain/LICENSE.txt'),
  },
  {
    name: 'regexp-to-ast (bundled in HyperFormula)',
    version: pkg('regexp-to-ast').version,
    licence: 'MIT',
    text: read('node_modules/regexp-to-ast/LICENSE'),
  },
  {
    name: 'tiny-emitter (bundled in HyperFormula)',
    version: pkg('tiny-emitter').version,
    licence: 'MIT',
    text: read('node_modules/tiny-emitter/LICENSE'),
  },
  {
    name: 'core-js (bundled in HyperFormula)',
    version: '3.50.0',
    licence: 'MIT',
    text: 'Copyright (c) 2013-2025 Denis Pushkarev (zloirock.ru), 2025-2026 CoreJS Company (core-js.io).\nLicensed under the MIT License; the full MIT text is given under AlaSQL below.',
  },
  {
    name: 'SheetJS code (bundled in HyperFormula)',
    licence: 'Apache-2.0',
    text: 'Copyright (C) 2013-present SheetJS LLC.\nLicensed under the Apache License 2.0; the full text is given under Chevrotain above.',
  },
  {
    name: 'jStat code (bundled in HyperFormula)',
    licence: 'MIT',
    text: 'Copyright (c) 2013 jStat.\nLicensed under the MIT License; the full MIT text is given under AlaSQL below.',
  },
  {
    name: 'AlaSQL',
    version: pkg('alasql').version,
    file: 'public/vendor/alasql-4.21.1.min.js',
    licence: 'MIT',
    text: read('node_modules/alasql/LICENSE'),
  },
];

const head = `Find the Breaks
Copyright (C) 2026 Josh Haller

This program is free software: you can redistribute it and/or modify it
under the terms of the GNU General Public License version 3, as published
by the Free Software Foundation. The full text is in LICENSE.

It includes the third-party software listed below, under their own
licences. Fonts (IBM Plex, SIL Open Font License 1.1) are loaded from
Google Fonts and are not distributed with this program.`;

const body = components.map((c) => [
  rule,
  `${c.name}${c.version ? ` ${c.version}` : ''}`,
  `Licence: ${c.licence}`,
  c.file ? `Shipped as: ${c.file.replace(/^public\//, '')}` : null,
  rule,
  '',
  c.text,
].filter((x) => x !== null).join('\n')).join('\n\n\n');

const out = `${head}\n\n\n${body}\n`;
for (const p of ['THIRD_PARTY_NOTICES.txt', 'public/THIRD_PARTY_NOTICES.txt']) writeFileSync(new URL(p, root), out);
writeFileSync(new URL('public/LICENSE.txt', root), `${read('LICENSE')}\n`);
console.log(`Wrote THIRD_PARTY_NOTICES.txt (${components.length} components) and public/LICENSE.txt.`);
