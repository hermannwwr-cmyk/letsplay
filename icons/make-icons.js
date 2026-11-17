// Draws the Home Screen icon (Grizzly with the bendy bus and the MRT train) with the hub's own art code,
// and writes the PNGs next to this file. Run: node icons/make-icons.js  (needs Playwright, preinstalled in cloud sessions)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const dir = __dirname, root = path.join(dir, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const hook = '  window.__hub = {';
if (!html.includes(hook)) throw new Error('hook point not found in index.html');
// a temporary copy that exposes the drawing kit (never committed)
const tmp = path.join(root, '.icon-tmp.html');
fs.writeFileSync(tmp, html.replace(hook, `  window.__art = { get ctx() { return ctx; }, set ctx(c) { ctx = c; }, set time(t) { time = t; }, drawBear, drawBusHero, drawTrainHero, drawLemmingAt, drawRoundTree, drawFir, drawFlower, drawCloud, solid, ell, rr, P };\n` + hook));
const SIZES = { 'icon-512.png': 512, 'icon-192.png': 192, 'apple-touch-icon.png': 180, 'favicon-32.png': 32 };
(async () => {
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width: 600, height: 600 } });
    await p.goto('file://' + tmp);
    await p.waitForFunction(() => window.__art);
    await p.evaluate(() => document.fonts.ready);
    const urls = await p.evaluate(sizes => {
      const A = window.__art, S = 1024; // drawn on a 1024 canvas, logical 512 units
      const c = document.createElement('canvas'); c.width = c.height = S;
      const g = c.getContext('2d'); const old = A.ctx; A.ctx = g; A.time = 1.3; // a moment with everyone's eyes open
      g.scale(S / 512, S / 512);
      // sky, sun and clouds
      const sky = g.createLinearGradient(0, 0, 0, 300); sky.addColorStop(0, '#6cc2f2'); sky.addColorStop(1, '#d4efff');
      g.fillStyle = sky; g.fillRect(0, 0, 512, 512);
      g.fillStyle = 'rgba(255,224,120,.35)'; g.beginPath(); g.arc(430, 70, 62, 0, 7); g.fill();
      g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(430, 70, 40, 0, 7); g.fill();
      A.drawCloud(110, 62, 0.9);
      // far hill and the viaduct with the train
      g.fillStyle = '#8fd46f'; g.beginPath(); g.ellipse(256, 300, 360, 110, 0, Math.PI, 0); g.fill();
      [70, 440].forEach(x => A.solid(A.rr(x - 11, 196, 22, 110, 4), '#e8dcc8', { depth: 4, rim: 2, rimColor: '#c7b596' }));
      A.solid(A.rr(-10, 184, 532, 16, 4), '#f3e9d6', { depth: 4, rim: 2, rimColor: '#c7b596' });
      g.save(); g.translate(276, 183); g.scale(1.25, 1.25); A.drawTrainHero('#e0453a', 0, 0, false); g.restore();
      // meadow
      g.fillStyle = '#7cc95c'; g.beginPath(); g.moveTo(0, 300); g.bezierCurveTo(140, 270, 370, 270, 512, 296); g.lineTo(512, 512); g.lineTo(0, 512); g.fill();
      g.fillStyle = '#6dbb52'; g.beginPath(); g.moveTo(0, 430); g.bezierCurveTo(160, 400, 360, 410, 512, 430); g.lineTo(512, 512); g.lineTo(0, 512); g.fill();
      A.drawRoundTree(28, 330, 0.9, '#4fae5e'); A.drawRoundTree(486, 330, 0.9, '#58b96a');
      // the bendy bus on the meadow
      g.save(); g.translate(250, 360); g.scale(1.12, 1.12); A.drawBusHero({ dist: 40, door: 0, lit: 0, asleep: false }); g.restore();
      // Grizzly in front, waving
      A.drawBear(256, 572, 1.22, { pose: 'wave', look: 0 });
      A.ctx = old;
      const out = {};
      for (const [name, s] of Object.entries(sizes)) {
        const o = document.createElement('canvas'); o.width = o.height = s;
        const og = o.getContext('2d'); og.imageSmoothingQuality = 'high'; og.drawImage(c, 0, 0, s, s);
        out[name] = o.toDataURL('image/png');
      }
      return out;
    }, SIZES);
    for (const [name, url] of Object.entries(urls)) fs.writeFileSync(path.join(dir, name), Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote', Object.keys(urls).join(', '));
  } finally { await b.close(); fs.rmSync(tmp, { force: true }); }
})();
