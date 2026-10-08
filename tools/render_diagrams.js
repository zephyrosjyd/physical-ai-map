// Pre-render Mermaid diagrams to static SVG (light + dark).
// usage: node tools/render_diagrams.js      (run 'npm install' in tools/ first)
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.dirname(__dirname);
// <img>로 표시할 때 원본 크기를 알 수 있도록 width="100%" 대신 viewBox 크기를 그대로 width/height로 기록
const fixSize = svg => svg.replace(/^<svg([^>]*)>/, (m, a) => {
  const vb = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(a); if (!vb) return m;
  a = a.replace(/ style="max-width:[^"]*"/, '').replace(/ width="100%"/, '');
  return `<svg${a} width="${Math.ceil(+vb[3])}" height="${Math.ceil(+vb[4])}">`;
});
(async () => {
  const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/.diagrams.json'), 'utf8'));
  const b = await chromium.launch(); const pg = await b.newPage();
  await pg.setContent('<html><body></body></html>');
  await pg.addScriptTag({ path: require.resolve('mermaid/dist/mermaid.min.js') });
  for (const theme of ['light', 'dark']) {
    const dir = path.join(ROOT, 'diagrams', theme); fs.mkdirSync(dir, { recursive: true });
    const out = await pg.evaluate(async ({ items, theme }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'dark' ? 'dark' : 'neutral',
        fontFamily: '"IBM Plex Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif',
        flowchart: { htmlLabels: false, curve: 'basis' }, sequence: { useMaxWidth: true } });
      const res = [];
      for (const it of items) {
        try { const { svg } = await mermaid.render(`mmd-${theme}-${it.id}`, it.code); res.push({ id: it.id, svg }); }
        catch (e) { res.push({ id: it.id, err: String(e.message || e).slice(0, 200) }); }
      }
      return res;
    }, { items, theme });
    let bad = 0;
    for (const r of out) { if (r.err) { bad++; console.log('ERR', theme, r.id, r.err); continue; }
      fs.writeFileSync(path.join(dir, `n${r.id}.svg`), fixSize(r.svg)); }
    console.log(theme, 'rendered', out.length - bad, 'errors', bad);
  }
  await b.close();
})();
