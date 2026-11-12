// Run before deploying. Fails while anything on the site is still a
// placeholder, such as the source code link the GPL footer points to.

import { readdirSync, readFileSync, statSync } from 'node:fs';

const root = new URL('../public/', import.meta.url);
const walk = (dir) => readdirSync(new URL(dir, root)).flatMap((f) => {
  const rel = `${dir}${f}`;
  return statSync(new URL(rel, root)).isDirectory() ? walk(`${rel}/`) : [rel];
});
const pages = walk('').filter((f) => f.endsWith('.html'));
const problems = [];
for (const p of pages) {
  const html = readFileSync(new URL(p, root), 'utf8');
  if (html.includes('REPLACE-ME')) problems.push(`${p}: the source code link is still a placeholder`);
  if (!/data-source-link/.test(html)) problems.push(`${p}: no source code link in the footer`);
}
for (const p of problems) console.log(`FAIL  ${p}`);
console.log(problems.length ? `\nNot ready to deploy: ${problems.length} problem(s).` : `Ready: ${pages.length} page(s) checked.`);
process.exit(problems.length ? 1 : 0);
