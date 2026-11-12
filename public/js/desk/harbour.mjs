// The harbour band: a coal berth with a bulk carrier alongside, drawn as
// flat shapes in the site palette. Colours are CSS variables, so the band
// follows light and dark themes. The water, the ship and the coal stream
// move only when motion is allowed (see desk.css).

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function harbour({ vessel = '', loading = true } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `harbour${loading ? ' loading' : ''}`;
  wrap.setAttribute('aria-hidden', 'true');
  const waves = Array.from({ length: 22 }, (_, i) => {
    const x = (i * 157) % 1700 - 60;
    const y = 300 + ((i * 37) % 52);
    return `<path d="M${x} ${y}h${46 + (i % 4) * 14}"/>`;
  }).join('');
  const hatches = [0, 1, 2, 3, 4].map((i) => `<rect x="${716 + i * 112}" y="214" width="88" height="16"/>`).join('');
  const windows = [0, 1, 2, 3].map((i) => `<rect x="${590 + i * 22}" y="176" width="12" height="7"/><rect x="${590 + i * 22}" y="196" width="12" height="7"/>`).join('');
  wrap.innerHTML = `<svg viewBox="0 0 1600 360" preserveAspectRatio="xMidYMax slice" focusable="false">
  <rect class="sky" width="1600" height="360"/>
  <path class="far" d="M0 214 C140 196 260 204 380 190 C520 174 640 196 780 184 C980 168 1120 196 1300 182 C1420 174 1520 190 1600 186 V260 H0Z"/>
  <g class="stack"><rect x="1430" y="120" width="18" height="92"/><rect x="1462" y="138" width="18" height="74"/><rect x="1430" y="132" width="18" height="8" class="band"/><rect x="1462" y="150" width="18" height="8" class="band"/></g>
  <rect class="land" x="0" y="206" width="700" height="56"/>
  <path class="coal" d="M30 206 C70 150 130 144 180 206Z M150 206 C210 132 300 128 360 206Z M330 206 C380 160 440 158 480 206Z"/>
  <g class="gantry"><path d="M360 168 L1000 112"/><path d="M372 206 V170 M520 206 V156 M680 206 V142"/></g>
  <g class="loader"><rect x="984" y="104" width="22" height="130"/><path d="M995 112 H868 V128 H995"/><rect x="862" y="126" width="14" height="74"/></g>
  <path class="stream" d="M869 200 V214"/>
  <rect class="quay" x="0" y="246" width="1600" height="18"/>
  <rect class="sea" x="0" y="262" width="1600" height="98"/>
  <g class="waves">${waves}</g>
  <g class="ship">
    <path class="hull" d="M560 230 H1350 L1398 220 L1366 300 H598 L560 268 Z"/>
    <path class="boot" d="M571 284 L598 300 H1366 L1372 286 Z"/>
    <g class="hatch">${hatches}</g>
    <rect class="house" x="578" y="160" width="104" height="70"/>
    <g class="win">${windows}</g>
    <rect class="funnel" x="600" y="134" width="36" height="28"/>
    <rect class="band" x="600" y="142" width="36" height="7"/>
    <text class="name" x="1300" y="266" text-anchor="end">${esc(vessel).toUpperCase()}</text>
  </g>
</svg>`;
  return wrap;
}
