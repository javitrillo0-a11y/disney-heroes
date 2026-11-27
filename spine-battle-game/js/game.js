/* ═════════════════════════════════════════════════════════════════
   BRIGADA BOGO · Modo Batalla — Spine 3.6 + fallback vector
   Un solo archivo, un solo rAF, funciona en file:// y en servidor.
   ═════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

/* ── utils ── */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const show = (el, on) => el.classList.toggle('hidden', !on);

/* ── estado global ── */
const G = {
  mode: 'menu',            // menu | battle
  spineOK: false, assetsOK: false, forceVector: false,
  speed: 1, auto: false, muted: false, paused: false, flipAll: false,
  difficulty: 'normal', level: 1, coins: 0, best: 1,
  battleT: 0, wave: 1, wavesTotal: 3, waveState: 'intro',
  units: [], events: [], fx: [], flash: 0, shake: 0,
  stats: { dmg: 0, ults: 0, t0: 0 },
  tipShown: false, firstUlt: false
};
try {
  const s = JSON.parse(localStorage.getItem('bogo_save') || '{}');
  Object.assign(G, { level: s.level || 1, coins: s.coins || 0, best: s.best || 1,
    difficulty: s.diff || 'normal', muted: !!s.muted, auto: !!s.auto, flipAll: !!s.flip });
} catch (e) {}
function save() {
  try { localStorage.setItem('bogo_save', JSON.stringify({
    level: G.level, coins: G.coins, best: G.best, diff: G.difficulty,
    muted: G.muted, auto: G.auto, flip: G.flipAll })); } catch (e) {}
}

/* ── lienzos ── */
const bgC = $('bg'), spC = $('spine'), fxC = $('fx');
const bgX = bgC.getContext('2d'), fxX = fxC.getContext('2d');
let W = 0, H = 0, DPR = 1, gl = null, shader = null, batcher = null, mvp = null, skRenderer = null;
let glLost = false;

function initGL() {
  try {
    gl = spC.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true })
      || spC.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: true });
  } catch (e) { gl = null; }
  if (gl) {
    spC.addEventListener('webglcontextlost', e => {
      e.preventDefault(); glLost = true; toast('Contexto WebGL perdido → modo vector');
    });
  }
}
function initSpineGL() {
  if (!gl || !window.spine || !spine.webgl) return false;
  try {
    shader = spine.webgl.Shader.newTwoColoredTextured(gl);
    batcher = new spine.webgl.PolygonBatcher(gl);
    mvp = new spine.webgl.Matrix4();
    skRenderer = new spine.webgl.SkeletonRenderer(gl);
    skRenderer.premultipliedAlpha = true;
    return true;
  } catch (e) { return false; }
}
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  DPR = clamp(window.devicePixelRatio || 1, 1, 1.75);
  for (const c of [bgC, spC, fxC]) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); }
  bgX.setTransform(DPR, 0, 0, DPR, 0, 0);
  fxX.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (gl) gl.viewport(0, 0, spC.width, spC.height);
  layoutUnits(); buildCity();
}
const groundY = () => H - clamp(H * 0.22, 118, 190);

/* ── audio sintetizado ── */
const AudioSys = (() => {
  let ctx = null, master = null, noiseBuf = null;
  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = G.muted ? 0 : 0.5; master.connect(ctx.destination);
      const len = ctx.sampleRate * 0.5; noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch (e) { return false; }
  }
  function tone(f0, f1, dur, type, vol, when = 0) {
    if (!ensure() || G.muted) return;
    const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, freq, q = 1, when = 0) {
    if (!ensure() || G.muted) return;
    const t = ctx.currentTime + when, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.02);
  }
  return {
    ensure,
    setMuted(m) { if (master) master.gain.value = m ? 0 : 0.5; },
    click()  { tone(660, 520, .06, 'square', .12); },
    hit(c)   { noise(.09, c ? .5 : .32, c ? 900 : 320, 1.4); tone(c ? 260 : 180, 55, .12, 'sine', .4); },
    death()  { tone(140, 40, .4, 'sine', .5); noise(.25, .3, 200, .8); },
    ready()  { tone(880, 880, .1, 'triangle', .22); tone(1320, 1320, .14, 'triangle', .2, .09); },
    charge() { tone(180, 820, .5, 'sawtooth', .16); },
    flash()  { noise(.35, .55, 2400, .6); tone(70, 38, .5, 'sine', .6); },
    shield() { tone(1250, 900, .16, 'triangle', .25); noise(.1, .15, 3000, 3); },
    stun()   { tone(500, 300, .2, 'square', .12); tone(400, 240, .2, 'square', .1, .12); },
    wave()   { tone(220, 220, .45, 'sawtooth', .18); tone(277, 277, .45, 'sawtooth', .14, .02); tone(330, 330, .45, 'sawtooth', .12, .04); },
    win()    { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, .22, 'triangle', .25, i * .13)); },
    lose()   { [330, 262, 196, 147].forEach((f, i) => tone(f, f * .97, .3, 'triangle', .22, i * .17)); }
  };
})();

/* ── fondo: ciudad al anochecer ── */
let cityFar = [], cityNear = [], motes = [];
function buildCity() {
  cityFar = []; cityNear = []; motes = [];
  const hz = H * 0.52; let x = -40;
  while (x < W + 60) { const w = rand(50, 110), h = rand(H * .1, H * .26);
    cityFar.push({ x, w, h }); x += w + rand(4, 18); }
  x = -60;
  while (x < W + 80) { const w = rand(70, 150), h = rand(H * .14, H * .34), win = [];
    for (let wy = 14; wy < h - 10; wy += 18) for (let wx = 8; wx < w - 10; wx += 16)
      if (Math.random() < .28) win.push([wx, wy]);
    cityNear.push({ x, w, h, win }); x += w + rand(10, 30); }
  for (let i = 0; i < 36; i++) motes.push({ x: Math.random() * W, y: Math.random() * H,
    r: rand(.6, 2.2), s: rand(3, 12), p: Math.random() * 7 });
}
function drawBG(t) {
  const hz = H * 0.52, gy = groundY();
  let g = bgX.createLinearGradient(0, 0, 0, hz);
  g.addColorStop(0, '#060b18'); g.addColorStop(.55, '#122036'); g.addColorStop(.85, '#28405f'); g.addColorStop(1, '#7a4a2a');
  bgX.fillStyle = g; bgX.fillRect(0, 0, W, hz + 2);
  // resplandor de sirenas lejano
  const pulse = (Math.sin(t * 1.7) + 1) / 2;
  bgX.fillStyle = `rgba(229,72,77,${0.05 + pulse * 0.06})`;
  bgX.beginPath(); bgX.arc(W * .18, hz, H * .22, 0, 7); bgX.fill();
  bgX.fillStyle = `rgba(57,197,255,${0.05 + (1 - pulse) * 0.06})`;
  bgX.beginPath(); bgX.arc(W * .84, hz, H * .22, 0, 7); bgX.fill();
  // edificios
  bgX.fillStyle = '#0b1526';
  for (const b of cityFar) bgX.fillRect(b.x, hz - b.h, b.w, b.h);
  for (const b of cityNear) {
    bgX.fillStyle = '#070f1d'; bgX.fillRect(b.x, hz - b.h, b.w, b.h);
    bgX.fillStyle = 'rgba(255,190,90,.55)';
    for (const w of b.win) bgX.fillRect(b.x + w[0], hz - b.h + w[1], 5, 7);
  }
  // calle en perspectiva
  g = bgX.createLinearGradient(0, hz, 0, H);
  g.addColorStop(0, '#1a2438'); g.addColorStop(.4, '#141c2c'); g.addColorStop(1, '#0a101d');
  bgX.fillStyle = g; bgX.fillRect(0, hz, W, H - hz);
  bgX.strokeStyle = 'rgba(242,182,50,.16)'; bgX.lineWidth = 2;
  const vx = W * .5;
  for (let i = -3; i <= 3; i++) {
    bgX.beginPath(); bgX.moveTo(vx + i * W * .045, hz); bgX.lineTo(vx + i * W * .3, H); bgX.stroke();
  }
  bgX.strokeStyle = 'rgba(159,180,199,.1)';
  for (let i = 1; i < 6; i++) { const y = hz + Math.pow(i / 6, 1.7) * (H - hz);
    bgX.beginPath(); bgX.moveTo(0, y); bgX.lineTo(W, y); bgX.stroke(); }
  // línea de combate
  bgX.strokeStyle = 'rgba(242,182,50,.28)'; bgX.setLineDash([14, 10]); bgX.lineWidth = 2;
  bgX.beginPath(); bgX.moveTo(0, gy + 6); bgX.lineTo(W, gy + 6); bgX.stroke(); bgX.setLineDash([]);
  // niebla
  for (let i = 0; i < 3; i++) {
    const fy = hz + 20 + i * 34, off = Math.sin(t * .12 + i * 2) * 60;
    const fg = bgX.createLinearGradient(0, fy - 16, 0, fy + 16);
    fg.addColorStop(0, 'rgba(111,159,216,0)'); fg.addColorStop(.5, `rgba(111,159,216,${.05 - i * .012})`); fg.addColorStop(1, 'rgba(111,159,216,0)');
    bgX.fillStyle = fg; bgX.fillRect(-80 + off, fy - 16, W + 160, 32);
  }
  // motas
  bgX.fillStyle = 'rgba(255,215,106,.35)';
  for (const m of motes) {
    const mx = (m.x + t * m.s) % (W + 20) - 10, my = m.y + Math.sin(t * .5 + m.p) * 8;
    bgX.globalAlpha = .12 + .18 * (Math.sin(t + m.p) + 1) / 2;
    bgX.beginPath(); bgX.arc(mx, my, m.r, 0, 7); bgX.fill();
  }
  bgX.globalAlpha = 1;
}

/* ── carga del runtime Spine 3.6 con cadena de respaldo ── */
const SPINE_URLS = [
  './js/spine-webgl.js',
  'https://cdn.jsdelivr.net/gh/EsotericSoftware/spine-runtimes@3.6/spine-ts/build/spine-webgl.js',
  'https://cdn.jsdelivr.net/gh/EsotericSoftware/spine-runtimes@3.6/spine-ts/webgl/build/spine-webgl.js',
  'https://rawcdn.githack.com/EsotericSoftware/spine-runtimes/3.6/spine-ts/build/spine-webgl.js',
  'https://cdn.statically.io/gh/EsotericSoftware/spine-runtimes/3.6/spine-ts/build/spine-webgl.js'
];
function loadScript(url, ms) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); const to = setTimeout(() => rej(new Error('timeout')), ms);
    s.src = url; s.onload = () => { clearTimeout(to); res(); };
    s.onerror = () => { clearTimeout(to); rej(new Error('err')); };
    document.head.appendChild(s);
  });
}
async function loadRuntime() {
  const st = $('rtStatus');
  for (const url of SPINE_URLS) {
    try {
      await loadScript(url, 8000);
      if (window.spine && spine.SkeletonJson && spine.webgl) {
        G.spineOK = initSpineGL();
        if (G.spineOK) {
          st.textContent = 'Runtime Spine 3.6 ✓ ' + (url.startsWith('.') ? '(local)' : '(CDN)');
          st.className = 'status ok'; tryBuildSkeleton(); refreshStartMode(); return;
        }
      }
    } catch (e) { /* siguiente */ }
  }
  st.textContent = 'Runtime Spine no disponible → modo vector activo';
  st.className = 'status err'; refreshStartMode();
}

/* ── assets: autodetección + arrastrar/soltar + selector ── */
const AssetIn = { json: null, atlas: null, image: null, imageName: '' };
let skelData = null, glTexture = null, portraitURL = null;

function classifyFile(name, text) {
  const n = name.toLowerCase();
  if (n.endsWith('.json') || (text && text.trim().startsWith('{') && text.includes('"skeleton"'))) return 'json';
  if (n.includes('.atlas') || (text && /^\s*\S+\s*\nsize:\s*\d+/m.test(text) && text.includes('xy:'))) return 'atlas';
  return null;
}
function ingestFile(file) {
  const n = file.name.toLowerCase();
  if (/\.(png|jpe?g|webp)$/.test(n)) {
    const img = new Image();
    img.onload = () => { AssetIn.image = img; AssetIn.imageName = file.name; tryBuildSkeleton(); };
    img.src = URL.createObjectURL(file); return;
  }
  const r = new FileReader();
  r.onload = () => {
    const kind = classifyFile(file.name, r.result);
    if (kind === 'json') { try { AssetIn.json = JSON.parse(r.result); } catch (e) { toast('JSON inválido: ' + file.name); return; } }
    else if (kind === 'atlas') AssetIn.atlas = r.result;
    else { toast('Archivo no reconocido: ' + file.name); return; }
    tryBuildSkeleton();
  };
  r.readAsText(file);
}
function tryBuildSkeleton() {
  if (!(AssetIn.json && AssetIn.atlas && AssetIn.image)) { updateAssetStatus(); return; }
  if (!G.spineOK || !gl || glLost) { updateAssetStatus(); return; }
  try {
    const j = AssetIn.json;
    // El skin real es "hero"; "default" viene vacío. Lo unificamos para que
    // las timelines de deform ("default") resuelvan en cualquier runtime 3.6.
    if (j.skins && j.skins.hero && (!j.skins.default || !Object.keys(j.skins.default).length))
      j.skins = { default: j.skins.hero };
    if (!glTexture) glTexture = new spine.webgl.GLTexture(gl, AssetIn.image);
    const atlas = new spine.TextureAtlas(AssetIn.atlas, () => glTexture);
    const loader = new spine.AtlasAttachmentLoader(atlas);
    const sj = new spine.SkeletonJson(loader); sj.scale = 1;
    skelData = sj.readSkeletonData(j);
    G.assetsOK = true; G.forceVector = false;
    portraitURL = makePortrait();
    toast('Assets Spine cargados ✓ (' + (j.skeleton && j.skeleton.spine || '3.6') + ')');
    rebuildShowcase();
  } catch (e) {
    console.error(e); G.assetsOK = false; skelData = null;
    toast('No se pudo construir el skeleton: ' + e.message);
  }
  updateAssetStatus(); refreshStartMode();
}
function makePortrait() {
  try {
    const m = AssetIn.atlas.match(/^head\s*\nrotate:\s*(\w+)\s*\nxy:\s*(\d+),\s*(\d+)\s*\nsize:\s*(\d+),\s*(\d+)/m);
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    if (m) x.drawImage(AssetIn.image, +m[2], +m[3], +m[4], +m[5], 0, 0, 64, 64);
    else x.drawImage(AssetIn.image, 0, 0, 128, 128, 0, 0, 64, 64);
    return c.toDataURL();
  } catch (e) { return null; }
}
function updateAssetStatus() {
  const st = $('assetStatus');
  const have = ['json', 'atlas', 'image'].filter(k => AssetIn[k]).length;
  if (G.assetsOK) { st.textContent = '✓ Skeleton listo — ' + AssetIn.imageName; st.className = 'status ok'; }
  else if (have > 0) { st.textContent = `Recibidos ${have}/3 archivos…` + (!G.spineOK ? ' (esperando runtime)' : ''); st.className = 'status'; }
  else { st.textContent = 'No detectados en assets/ — arrástralos o usa el botón'; st.className = 'status err'; }
}
async function autoDetect() {
  if (location.protocol === 'file:') { updateAssetStatus(); return; }
  const base = 'assets/unit-DEFAULT-untrimmed-smallcombat';
  try {
    const [j, a] = await Promise.all([
      fetch(base + '.json').then(r => r.ok ? r.json() : Promise.reject()),
      fetch(base + '.atlas').then(r => r.ok ? r.text() : fetch(base + '.atlas.txt').then(r2 => r2.ok ? r2.text() : Promise.reject()))
    ]);
    const blob = await fetch(base + '.png').then(r => r.ok ? r.blob() : Promise.reject());
    AssetIn.json = j; AssetIn.atlas = a; AssetIn.imageName = 'unit-DEFAULT…png';
    const img = new Image();
    img.onload = () => { AssetIn.image = img; tryBuildSkeleton(); };
    img.src = URL.createObjectURL(blob);
  } catch (e) { updateAssetStatus(); }
}
function useSpine() { return G.spineOK && G.assetsOK && skelData && !G.forceVector && !glLost; }
function refreshStartMode() { $('startMode').textContent = useSpine() ? 'SPINE' : 'VECTOR'; }

/* ── luchador vector (fallback completo) ── */
function drawVector(ctx, u, t) {
  const h = u.h, s = h / 300, T = u.tint;
  const mix = (r, g, b) => `rgb(${Math.round(r * T[0])},${Math.round(g * T[1])},${Math.round(b * T[2])})`;
  const st = u.state, p = u.stateT;
  let bob = Math.sin(t * 3 + u.id * 2) * 3, lean = 0, lunge = 0, shieldUp = 0, fall = 0, legP = 0;
  if (st === 'enter') { legP = t * 14; bob = Math.abs(Math.sin(legP)) * -6; lean = .18; }
  if (st === 'attack') { const k = Math.sin(clamp(p / .87, 0, 1) * Math.PI); lunge = k * 26; lean = k * .22; }
  if (st === 'skill')  { const k = Math.sin(clamp(p / 1.77, 0, 1) * Math.PI); lunge = k * 34; lean = k * .3; shieldUp = k * .4; }
  if (st === 'guard')  { shieldUp = .2; }
  if (st === 'ult')    { const k = clamp(p / 1.4, 0, 1); shieldUp = k; lean = -k * .12; }
  if (st === 'hit')    { lean = -Math.sin(clamp(p / .73, 0, 1) * Math.PI) * .25; }
  if (st === 'dead')   { fall = easeOut(clamp(p / 1.2, 0, 1)); }
  if (st === 'victory'){ bob = Math.sin(t * 6) * 5; shieldUp = .9 + Math.sin(t * 6) * .08; }
  ctx.save();
  ctx.translate(u.x + u.lunge, u.y);
  ctx.scale(u.facing * s, s);
  if (fall) { ctx.rotate(-fall * 1.35); ctx.globalAlpha = 1 - clamp((p - 1.4) / 1.1, 0, 1); }
  ctx.rotate(lean);
  ctx.translate(lunge, bob);
  // piernas
  const swing = legP ? Math.sin(legP) * 14 : 0;
  ctx.fillStyle = mix(38, 56, 84);
  ctx.fillRect(-26 + swing * .4, -74, 20, 74); ctx.fillRect(8 - swing * .4, -74, 20, 74);
  ctx.fillStyle = mix(30, 34, 44);
  ctx.fillRect(-30 + swing * .4, -12, 26, 12); ctx.fillRect(6 - swing * .4, -12, 26, 12);
  // torso uniforme
  ctx.fillStyle = mix(74, 111, 165);
  ctx.beginPath(); ctx.moveTo(-44, -70); ctx.quadraticCurveTo(-52, -170, -20, -196);
  ctx.lineTo(34, -196); ctx.quadraticCurveTo(58, -160, 46, -70); ctx.closePath(); ctx.fill();
  ctx.fillStyle = mix(52, 80, 122); ctx.fillRect(-44, -96, 92, 14); // cinturón
  ctx.fillStyle = '#f2b632'; ctx.fillRect(-6, -98, 14, 18);          // hebilla
  ctx.beginPath(); // placa
  ctx.arc(20, -160, 9, 0, 7); ctx.fillStyle = '#ffd76a'; ctx.fill();
  // cabeza búfalo
  ctx.save(); ctx.translate(6, -206);
  ctx.fillStyle = mix(141, 153, 174);
  ctx.beginPath(); ctx.ellipse(0, 0, 34, 28, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(22, 10, 20, 14, .2, 0, 7); ctx.fill(); // morro
  ctx.fillStyle = mix(96, 106, 124); ctx.beginPath(); ctx.ellipse(30, 12, 10, 7, .2, 0, 7); ctx.fill();
  // cuernos
  ctx.strokeStyle = mix(222, 205, 168); ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-18, -18); ctx.quadraticCurveTo(-46, -30, -44, -52); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(12, -22); ctx.quadraticCurveTo(38, -36, 40, -54); ctx.stroke();
  // gorra
  ctx.fillStyle = mix(28, 44, 70); ctx.beginPath(); ctx.ellipse(-2, -24, 30, 12, -.08, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#f2b632'; ctx.fillRect(-28, -26, 54, 5);
  // ojo + ceño
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(10, -4, 7, 6, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#101826'; ctx.beginPath(); ctx.arc(12, -3, 3, 0, 7); ctx.fill();
  ctx.strokeStyle = mix(60, 68, 84); ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(2, -13); ctx.lineTo(19, -9); ctx.stroke();
  ctx.restore();
  // brazo + escudo antidisturbios
  ctx.save(); ctx.translate(30, -150); ctx.rotate(-shieldUp * 1.5);
  ctx.fillStyle = mix(52, 80, 122); ctx.fillRect(-6, -8, 40, 20);
  const sg = ctx.createLinearGradient(30, -80, 78, 80);
  sg.addColorStop(0, 'rgba(190,210,228,.92)'); sg.addColorStop(1, 'rgba(120,145,170,.92)');
  ctx.fillStyle = sg;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(30, -86, 46, 168, 12); else ctx.rect(30, -86, 46, 168);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,32,54,.8)'; ctx.lineWidth = 4; ctx.stroke();
  ctx.fillStyle = 'rgba(242,182,50,.85)'; ctx.fillRect(34, -20, 38, 12);
  ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(38, -78, 8, 150);
  ctx.restore();
  if (u.buffs && u.buffs.shield > 0) {
    ctx.strokeStyle = `rgba(57,197,255,${.5 + .3 * Math.sin(t * 8)})`; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(10, -130, 96, 0, 7); ctx.stroke();
  }
  ctx.restore();
}

/* ── FX ── */
function spawnNumber(u, txt, color, size) {
  G.fx.push({ k: 'num', x: u.x + rand(-14, 14), y: u.y - u.h * .9, vy: -46, t: 0, life: .95, txt, color, size });
}
function sparks(x, y, color, n = 8, spd = 160) {
  for (let i = 0; i < n; i++) { const a = rand(0, 6.28), v = rand(.3, 1) * spd;
    G.fx.push({ k: 'p', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, t: 0, life: rand(.3, .6), color, r: rand(1.5, 3.5) }); }
}
function ring(x, y, color, r0 = 10, vr = 260, lw = 4) {
  G.fx.push({ k: 'ring', x, y, r: r0, vr, t: 0, life: .5, color, lw });
}
function updateFX(dt) {
  for (let i = G.fx.length - 1; i >= 0; i--) {
    const f = G.fx[i]; f.t += dt;
    if (f.t >= f.life) { G.fx.splice(i, 1); continue; }
    if (f.k === 'num') f.y += f.vy * dt;
    if (f.k === 'p') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 420 * dt; }
    if (f.k === 'ring') f.r += f.vr * dt;
  }
  G.flash = Math.max(0, G.flash - dt * 2.6);
  G.shake = Math.max(0, G.shake - dt * 34);
}
function drawFX(t) {
  fxX.clearRect(0, 0, W, H);
  const sx = G.shake ? rand(-G.shake, G.shake) * .5 : 0, sy = G.shake ? rand(-G.shake, G.shake) * .5 : 0;
  fxX.save(); fxX.translate(sx, sy);
  // sombras + barras
  for (const u of G.units) {
    if (!u.alive && u.stateT > 2.4) continue;
    const a = u.alive ? 1 : clamp(1 - (u.stateT - 1.4) / 1, 0, 1);
    fxX.globalAlpha = .32 * a; fxX.fillStyle = '#000';
    fxX.beginPath(); fxX.ellipse(u.x + u.lunge, u.y + 5, u.h * .2, u.h * .05, 0, 0, 7); fxX.fill();
    fxX.globalAlpha = a;
    if (u.alive) {
      const bw = u.h * .46, bx = u.x - bw / 2, by = u.y - u.h * 1.06;
      const pct = u.hp / u.maxHp;
      fxX.fillStyle = 'rgba(5,10,20,.8)'; rr(fxX, bx - 1, by - 1, bw + 2, 8, 4); fxX.fill();
      fxX.fillStyle = u.side === 0 ? (pct > .35 ? '#3dd68c' : '#e5484d') : '#e5484d';
      if (pct > 0) { rr(fxX, bx, by, bw * pct, 6, 3); fxX.fill(); }
      if (u.side === 1) {
        fxX.fillStyle = 'rgba(5,10,20,.8)'; rr(fxX, bx - 1, by + 9, bw + 2, 5, 2); fxX.fill();
        const full = u.energy >= 100;
        fxX.fillStyle = full && Math.sin(t * 12) > 0 ? '#ffd76a' : '#39c5ff';
        if (u.energy > 0) { rr(fxX, bx, by + 10, bw * u.energy / 100, 3, 1.5); fxX.fill(); }
        if (full) { fxX.fillStyle = '#ffd76a'; fxX.font = 'bold 15px ' + 'Arial';
          fxX.textAlign = 'center'; fxX.fillText('!', u.x, by - 6); }
      }
      if (u.buffs.stun > 0) {
        fxX.fillStyle = '#ffd76a'; fxX.font = '13px Arial'; fxX.textAlign = 'center';
        for (let i = 0; i < 3; i++) { const a2 = t * 5 + i * 2.09;
          fxX.fillText('★', u.x + Math.cos(a2) * 22, u.y - u.h * 1.14 + Math.sin(a2) * 6); }
      }
      if (u.buffs.shield > 0 && useSpine()) {
        fxX.strokeStyle = `rgba(57,197,255,${.4 + .25 * Math.sin(t * 8)})`; fxX.lineWidth = 3;
        fxX.beginPath(); fxX.ellipse(u.x, u.y - u.h * .5, u.h * .3, u.h * .56, 0, 0, 7); fxX.stroke();
      }
    }
    fxX.globalAlpha = 1;
  }
  for (const f of G.fx) {
    const k = 1 - f.t / f.life;
    if (f.k === 'num') {
      fxX.globalAlpha = k; fxX.font = `bold ${f.size}px Impact, Arial`; fxX.textAlign = 'center';
      fxX.lineWidth = 4; fxX.strokeStyle = 'rgba(5,10,20,.9)';
      fxX.strokeText(f.txt, f.x, f.y); fxX.fillStyle = f.color; fxX.fillText(f.txt, f.x, f.y);
    } else if (f.k === 'p') {
      fxX.globalAlpha = k; fxX.fillStyle = f.color;
      fxX.beginPath(); fxX.arc(f.x, f.y, f.r * k + .4, 0, 7); fxX.fill();
    } else if (f.k === 'ring') {
      fxX.globalAlpha = k * .9; fxX.strokeStyle = f.color; fxX.lineWidth = f.lw * k + .5;
      fxX.beginPath(); fxX.arc(f.x, f.y, f.r, 0, 7); fxX.stroke();
    }
    fxX.globalAlpha = 1;
  }
  fxX.restore();
  if (G.flash > 0) { fxX.fillStyle = `rgba(255,250,235,${G.flash * .85})`; fxX.fillRect(0, 0, W, H); }
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/* ── unidades ── */
const PLAYER_DEFS = [
  { name: 'BOGO',          tint: [1, 1, 1] },
  { name: 'BOGO TÁCTICO',  tint: [.72, .92, 1] },
  { name: 'BOGO VETERANO', tint: [1, .9, .68] }
];
const WAVE_DEFS = [
  [['MATÓN', [1, .62, .62]], ['BUSCAPLEITOS', [.85, .68, 1]], ['BRAVUCÓN', [1, .78, .55]]],
  [['SICARIO', [1, .55, .55]], ['GRANADERO', [.8, .6, 1]], ['CAPITÁN', [1, .72, .45]]],
  [['TENIENTE', [1, .5, .5]], ['COMISARIO', [.78, .55, 1]], ['JEFE RENEGADO', [1, .62, .3]]]
];
const DIFF = { easy: { hp: .8, dmg: .72 }, normal: { hp: 1, dmg: 1 }, hard: { hp: 1.25, dmg: 1.3 } };
let uid = 0;

function makeUnit(side, slot, name, tint) {
  const d = DIFF[G.difficulty];
  const lvlP = 1 + .06 * (G.level - 1), lvlE = 1 + .15 * (G.level - 1) + .22 * (G.wave - 1);
  const u = {
    id: uid++, side, slot, name, tint, facing: side === 0 ? 1 : -1,
    maxHp: Math.round(side === 0 ? 920 * lvlP : 640 * lvlE * d.hp),
    dmg: (side === 0 ? 86 * lvlP : 54 * (1 + .1 * (G.level - 1) + .12 * (G.wave - 1)) * d.dmg),
    energy: side === 0 ? 20 : 0, atkT: rand(1, 2.2), atkPeriod: side === 0 ? 2.6 : 2.9,
    atkCount: 0, guardUsed: false, alive: true, state: 'enter', stateT: 0,
    flashT: 0, lunge: 0, buffs: { shield: 0, stun: 0 }, ultDelay: -1, readyPing: false,
    x: 0, y: 0, h: 200, scale: .25, homeX: 0, enterFrom: 0, enterDur: 1.05,
    sk: null, as: null
  };
  u.hp = u.maxHp;
  if (useSpine()) {
    try {
      u.sk = new spine.Skeleton(skelData);
      u.sk.setSkinByName('default'); u.sk.setToSetupPose(); u.sk.updateWorldTransform();
      const ad = new spine.AnimationStateData(skelData); ad.defaultMix = .16;
      u.as = new spine.AnimationState(ad);
      playAnim(u, 'entrance_loop', true);
    } catch (e) { u.sk = null; u.as = null; }
  }
  return u;
}
function hasAnim(u, n) { return u.sk && skelData.findAnimation(n); }
function playAnim(u, n, loop) {
  if (!u.as) return;
  if (!hasAnim(u, n)) n = hasAnim(u, 'idle') ? 'idle' : null;
  if (n) u.as.setAnimation(0, n, loop);
}
function queueAnim(u, n, loop, delay) {
  if (!u.as) return;
  if (!hasAnim(u, n)) n = 'idle';
  if (hasAnim(u, n)) u.as.addAnimation(0, n, loop, delay || 0);
}
function layoutUnits() {
  const gy = groundY();
  for (const u of G.units) {
    const fx = u.side === 0 ? [.31, .225, .14][u.slot] : [.69, .775, .86][u.slot];
    u.homeX = W * fx;
    u.y = gy - u.slot * H * .048;
    u.h = clamp(H * .36, 140, 320) * (1 - u.slot * .07);
    u.scale = u.h / 788;
    u.enterFrom = u.side === 0 ? -u.h : W + u.h;
    if (u.state !== 'enter') u.x = u.homeX;
  }
  layoutShowcase();
}

/* ── eventos programados (tiempo de juego) ── */
function schedule(delay, fn) { G.events.push({ t: G.battleT + delay, fn }); }
function runEvents() {
  for (let i = G.events.length - 1; i >= 0; i--)
    if (G.battleT >= G.events[i].t) { const e = G.events.splice(i, 1)[0]; e.fn(); }
}

/* ── combate ── */
function frontEnemy(side) {
  const foes = G.units.filter(u => u.side !== side && u.alive);
  foes.sort((a, b) => a.slot - b.slot); return foes[0] || null;
}
function setState(u, s) { u.state = s; u.stateT = 0; }
function busy(u) { return u.state === 'attack' || u.state === 'skill' || u.state === 'ult' || u.state === 'guard' || u.state === 'enter' || u.state === 'dead' || u.state === 'victory'; }

function dealDamage(src, dst, amount, crit) {
  if (!dst.alive || G.waveState === 'done') return;
  if (dst.buffs.shield > 0) amount *= .55;
  amount = Math.max(1, Math.round(amount));
  dst.hp = Math.max(0, dst.hp - amount);
  dst.energy = Math.min(100, dst.energy + 12);
  dst.flashT = .18;
  if (src && src.side === 0) G.stats.dmg += amount;
  spawnNumber(dst, String(amount), crit ? '#ffd76a' : (src && src.side === 0 ? '#eef3fa' : '#ff9a9e'), crit ? 26 : 19);
  sparks(dst.x, dst.y - dst.h * .55, crit ? '#ffd76a' : '#ff9f1c', crit ? 14 : 7);
  G.shake = Math.max(G.shake, crit ? 7 : 3);
  AudioSys.hit(crit);
  if (dst.hp <= 0) kill(dst);
  else if (dst.state === 'idle' && dst.buffs.stun <= 0) {
    setState(dst, 'hit'); playAnim(dst, 'hit', false); queueAnim(dst, 'idle', true, 0);
    schedule(.75, () => { if (dst.alive && dst.state === 'hit') setState(dst, 'idle'); });
  }
}
function kill(u) {
  u.alive = false; setState(u, 'dead'); u.buffs.stun = 0; u.buffs.shield = 0;
  playAnim(u, 'death', false);
  ring(u.x, u.y - u.h * .5, u.side === 0 ? '#39c5ff' : '#e5484d', 12, 320, 6);
  sparks(u.x, u.y - u.h * .5, '#9fb4c7', 16, 220);
  AudioSys.death(); G.shake = Math.max(G.shake, 8);
}
function doAttack(u) {
  const target = frontEnemy(u.side); if (!target) return;
  u.atkCount++;
  const useSkill = u.atkCount % 4 === 0 && hasAnim(u, 'skill1');
  setState(u, useSkill ? 'skill' : 'attack');
  playAnim(u, useSkill ? 'skill1' : 'attack', false); queueAnim(u, 'idle', true, 0);
  u.energy = Math.min(100, u.energy + 18);
  const dur = useSkill ? 1.8 : .9, hitAt = useSkill ? .55 : .33;
  schedule(hitAt, () => {
    if (!u.alive) return;
    const t = frontEnemy(u.side); if (!t) return;
    const crit = Math.random() < .12;
    let dmg = u.dmg * rand(.85, 1.15) * (useSkill ? 1.5 : 1) * (crit ? 1.6 : 1);
    dealDamage(u, t, dmg, crit);
    if (useSkill && t.alive) { t.buffs.stun = 1.2; AudioSys.stun();
      spawnNumber(t, 'ATURDIDO', '#ffd76a', 14); }
  });
  schedule(dur, () => { if (u.alive && (u.state === 'attack' || u.state === 'skill')) setState(u, 'idle'); });
}
function doGuard(u) {
  u.guardUsed = true; setState(u, 'guard');
  playAnim(u, 'skill2_end', false); queueAnim(u, 'idle', true, 0);
  schedule(.6, () => { if (!u.alive) return;
    u.buffs.shield = 5; AudioSys.shield();
    ring(u.x, u.y - u.h * .5, '#39c5ff', 8, 200, 4);
    spawnNumber(u, 'GUARDIA', '#39c5ff', 15); });
  schedule(1.65, () => { if (u.alive && u.state === 'guard') setState(u, 'idle'); });
}
function castUlt(u) {
  if (!u.alive || u.energy < 100 || busy(u) || G.waveState !== 'fight') return false;
  u.energy = 0; u.readyPing = false; setState(u, 'ult');
  if (u.side === 0) { G.stats.ults++; G.firstUlt = true; show($('tip'), false); }
  playAnim(u, 'skill3_start', false);
  queueAnim(u, 'skill3_loop', false, 0); queueAnim(u, 'skill3_end', false, 0); queueAnim(u, 'idle', true, 0);
  AudioSys.charge();
  spawnNumber(u, '¡ULTI!', '#ffd76a', 24);
  schedule(2.42, () => {
    if (!u.alive) return;
    G.flash = 1; G.shake = 15; AudioSys.flash();
    ring(u.x + u.facing * u.h * .4, u.y - u.h * .6, '#fff5d6', 20, 900, 10);
    const foes = G.units.filter(v => v.side !== u.side && v.alive);
    for (const t of foes) {
      dealDamage(u, t, u.dmg * (u.side === 0 ? 2.2 : 1.5) * rand(.9, 1.1), true);
      if (t.alive) t.buffs.stun = Math.max(t.buffs.stun, .8);
    }
  });
  schedule(3.05, () => { if (u.alive && u.state === 'ult') setState(u, 'idle'); });
  return true;
}

function spawnWave(n) {
  G.wave = n; G.waveState = 'intro';
  G.units = G.units.filter(u => u.side === 0);
  const defs = WAVE_DEFS[n - 1];
  for (let i = 0; i < 3; i++) {
    const u = makeUnit(1, i, defs[i][0], defs[i][1]);
    G.units.push(u);
  }
  layoutUnits();
  for (const u of G.units) if (u.side === 1) { u.x = u.enterFrom; u.state = 'enter'; u.stateT = 0; playAnim(u, 'entrance_loop', true); }
  $('hudWave').textContent = `OLEADA ${n}/${G.wavesTotal}`;
  banner(`OLEADA ${n}`); AudioSys.wave();
}
function startBattle() {
  G.mode = 'battle'; G.paused = false; G.battleT = 0; G.wave = 1;
  G.events = []; G.fx = []; G.flash = 0; G.shake = 0;
  G.stats = { dmg: 0, ults: 0, t0: performance.now() };
  G.units = [];
  for (let i = 0; i < 3; i++) {
    const u = makeUnit(0, i, PLAYER_DEFS[i].name, PLAYER_DEFS[i].tint);
    G.units.push(u);
  }
  spawnWave(1);
  layoutUnits();
  for (const u of G.units) if (u.side === 0) { u.x = u.enterFrom; u.state = 'enter'; u.stateT = 0; playAnim(u, 'entrance_loop', true); }
  show($('boot'), false); show($('result'), false); show($('pause'), false);
  show($('hud'), true); show($('cards'), true);
  $('hudLevel').textContent = 'NIVEL ' + G.level;
  $('hudCoins').textContent = '🪙 ' + G.coins;
  buildCards();
  if (!G.tipShown) { show($('tip'), true); G.tipShown = true; schedule(9, () => show($('tip'), false)); }
  refreshHUDButtons();
}
function waveClear() {
  if (G.wave < G.wavesTotal) {
    G.waveState = 'clear';
    for (const u of G.units) if (u.side === 0 && u.alive) {
      u.hp = Math.min(u.maxHp, u.hp + Math.round(u.maxHp * .14));
      u.energy = Math.min(100, u.energy + 20); u.guardUsed = false;
      spawnNumber(u, '+CURA', '#3dd68c', 15);
    }
    banner('OLEADA DESPEJADA');
    schedule(1.5, () => spawnWave(G.wave + 1));
  } else victory();
}
function victory() {
  G.waveState = 'done'; AudioSys.win();
  const survivors = G.units.filter(u => u.side === 0 && u.alive);
  for (const u of survivors) {
    setState(u, 'victory');
    playAnim(u, 'victory_start', false); queueAnim(u, 'victory_loop', true, 0);
  }
  const stars = survivors.length;
  const earned = 40 + G.level * 15 + stars * 25;
  G.coins += earned; G.best = Math.max(G.best, G.level + 1); save();
  schedule(1.7, () => showResult(true, stars, earned));
}
function defeat() {
  if (G.waveState === 'done') return;
  G.waveState = 'done'; AudioSys.lose();
  schedule(1.9, () => showResult(false, 0, 0));
}
function showResult(win, stars, earned) {
  show($('cards'), false); show($('tip'), false);
  const t = $('resTitle');
  t.textContent = win ? '¡VICTORIA!' : 'DERROTA';
  t.className = win ? 'win' : 'lose';
  const secs = Math.round((performance.now() - G.stats.t0) / 1000);
  $('resStats').innerHTML =
    `<span>Daño infligido</span><b>${G.stats.dmg.toLocaleString('es')}</b>` +
    `<span>Ultis lanzadas</span><b>${G.stats.ults}</b>` +
    `<span>Tiempo</span><b>${secs}s</b>` +
    `<span>Oleadas</span><b>${win ? 3 : G.wave - 1}/3</b>`;
  $('resCoins').textContent = win ? `+${earned} 🪙` : 'Sin recompensa';
  show($('btnNext'), win);
  $('btnRetry').textContent = win ? 'REPETIR NIVEL' : 'REINTENTAR';
  const spans = $('resStars').children;
  for (let i = 0; i < 3; i++) { spans[i].classList.remove('lit');
    if (i < stars) setTimeout(() => { spans[i].classList.add('lit'); AudioSys.ready(); }, 350 + i * 320); }
  show($('result'), true);
  $('hudCoins').textContent = '🪙 ' + G.coins;
}

/* ── actualización de unidades ── */
function updateUnits(dt, t) {
  let allEntered = true;
  for (const u of G.units) {
    u.stateT += dt; u.flashT = Math.max(0, u.flashT - dt);
    u.buffs.shield = Math.max(0, u.buffs.shield - dt);
    u.buffs.stun = Math.max(0, u.buffs.stun - dt);
    if (u.state === 'enter') {
      allEntered = false;
      const k = clamp(u.stateT / u.enterDur, 0, 1);
      u.x = lerp(u.enterFrom, u.homeX, easeInOut(k));
      if (k >= 1) {
        setState(u, 'enterEnd');
        playAnim(u, 'entrance_end', false); queueAnim(u, 'idle', true, 0);
        schedule(1.35, () => { if (u.state === 'enterEnd') setState(u, 'idle'); });
      }
    } else if (u.state === 'enterEnd') allEntered = false;
    // lunge visual
    let lg = 0;
    if (u.state === 'attack') lg = Math.sin(clamp(u.stateT / .87, 0, 1) * Math.PI) * 22;
    if (u.state === 'skill')  lg = Math.sin(clamp(u.stateT / 1.77, 0, 1) * Math.PI) * 30;
    u.lunge = lg * u.facing;
    if (!u.alive) { if (u.as) u.as.update(dt); continue; }
    if (G.waveState === 'fight' && u.buffs.stun <= 0) {
      u.energy = Math.min(100, u.energy + 4 * dt);
      if (u.state === 'idle') {
        u.atkT -= dt;
        if (!u.guardUsed && u.hp < u.maxHp * .55 && hasAnim(u, 'skill2_end')) doGuard(u);
        else if (u.energy >= 100) {
          if (u.side === 1 || G.auto) {
            if (u.ultDelay < 0) u.ultDelay = u.side === 1 ? rand(.6, 1.3) : .35;
            u.ultDelay -= dt;
            if (u.ultDelay <= 0) { castUlt(u); u.ultDelay = -1; }
          }
        } else if (u.atkT <= 0) { doAttack(u); u.atkT = u.atkPeriod * rand(.92, 1.08); }
      }
    }
    if (u.side === 0 && u.energy >= 100 && !u.readyPing) { u.readyPing = true; AudioSys.ready(); }
    if (u.as) u.as.update(dt);
  }
  if (G.waveState === 'intro' && allEntered) {
    G.waveState = 'fight';
    if (G.wave === 1) banner('¡A LUCHAR!');
  }
  if (G.waveState === 'fight') {
    if (!G.units.some(u => u.side === 1 && u.alive)) waveClear();
    else if (!G.units.some(u => u.side === 0 && u.alive)) defeat();
  }
}

/* ── render spine ── */
function renderSpine(units, t) {
  if (!gl || !batcher || glLost) return;
  gl.viewport(0, 0, spC.width, spC.height);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  const sx = G.shake ? rand(-G.shake, G.shake) * .5 : 0, sy = G.shake ? rand(-G.shake, G.shake) * .5 : 0;
  mvp.ortho2d(-sx, -sy, W - sx, H - sy);
  shader.bind();
  shader.setUniformi(spine.webgl.Shader.SAMPLER, 0);
  shader.setUniform4x4f(spine.webgl.Shader.MVP_MATRIX, mvp.values);
  batcher.begin(shader);
  for (const u of units) {
    if (!u.sk || !u.as) continue;
    if (!u.alive && u.stateT > 2.6) continue;
    u.as.apply(u.sk); u.sk.updateWorldTransform();
    const flip = G.flipAll ? -1 : 1;
    u.sk.x = u.x + u.lunge; u.sk.y = H - u.y;
    // el asset mira a la izquierda de origen: jugador espejado, enemigo nativo
    u.sk.scaleX = (u.facing === 1 ? -1 : 1) * flip * u.scale;
    u.sk.scaleY = u.scale;
    let r = u.tint[0], g = u.tint[1], b = u.tint[2];
    if (u.flashT > 0) { const k = u.flashT / .18; r = lerp(r, 1, k); g = lerp(g, .35, k); b = lerp(b, .35, k); }
    const a = u.alive ? 1 : clamp(1 - (u.stateT - 1.5) / 1, 0, 1);
    u.sk.color.set(r, g, b, a);
    skRenderer.draw(batcher, u.sk);
  }
  batcher.end(); shader.unbind();
}

/* ── showcase (menú) ── */
const SHOW_SEQ = [['idle', 3.5], ['walk', 2.2], ['attack', 1.1], ['skill1', 2], ['idle', 1.5],
  ['victory_start', 1.5], ['victory_loop', 2.6], ['idle', 2]];
const showU = { sk: null, as: null, x: 0, y: 0, h: 300, scale: .4, facing: 1, tint: [1, 1, 1],
  alive: true, state: 'idle', stateT: 0, flashT: 0, lunge: 0, buffs: { shield: 0, stun: 0 }, id: 999 };
let showIdx = 0, showT = 0, showOverride = 0;
function rebuildShowcase() {
  showU.sk = null; showU.as = null;
  if (useSpine()) {
    try {
      showU.sk = new spine.Skeleton(skelData);
      showU.sk.setSkinByName('default'); showU.sk.setToSetupPose();
      const ad = new spine.AnimationStateData(skelData); ad.defaultMix = .18;
      showU.as = new spine.AnimationState(ad);
      showU.as.setAnimation(0, 'idle', true);
    } catch (e) { showU.sk = null; }
  }
  showIdx = 0; showT = 0;
}
function layoutShowcase() {
  const mobile = W < 820;
  showU.x = mobile ? W * .5 : W * .66;
  showU.y = mobile ? H * .34 : groundY();
  showU.h = mobile ? H * .27 : clamp(H * .52, 220, 460);
  showU.scale = showU.h / 788;
}
function updateShowcase(dt, t) {
  showT += dt; showU.stateT += dt;
  if (showOverride > 0) { showOverride -= dt;
    if (showOverride <= 0) { showU.state = 'idle'; if (showU.as) showU.as.setAnimation(0, 'idle', true); } }
  else {
    const [name, dur] = SHOW_SEQ[showIdx];
    if (showT >= dur) {
      showT = 0; showIdx = (showIdx + 1) % SHOW_SEQ.length;
      const n = SHOW_SEQ[showIdx][0];
      showU.state = n === 'attack' ? 'attack' : n === 'skill1' ? 'skill' : n.startsWith('victory') ? 'victory' : n === 'walk' ? 'enter' : 'idle';
      showU.stateT = 0;
      $('showAnim').textContent = n;
      if (showU.as && hasAnim(showU, n)) showU.as.setAnimation(0, n, !['attack', 'skill1', 'victory_start'].includes(n));
    }
  }
  if (showU.as) showU.as.update(dt);
}
function pokeShowcase() {
  showOverride = 1.1; showU.state = 'attack'; showU.stateT = 0;
  $('showAnim').textContent = 'attack';
  if (showU.as && hasAnim(showU, 'attack')) { showU.as.setAnimation(0, 'attack', false); showU.as.addAnimation(0, 'idle', true, 0); }
  AudioSys.hit(false);
  sparks(showU.x, showU.y - showU.h * .55, '#ffd76a', 10, 180);
}

/* ── cartas HUD ── */
let cardRefs = [];
function buildCards() {
  const wrap = $('cards'); wrap.innerHTML = ''; cardRefs = [];
  G.units.filter(u => u.side === 0).forEach((u, i) => {
    const b = document.createElement('button');
    b.className = 'card'; b.dataset.i = i;
    b.setAttribute('aria-label', 'Ulti de ' + u.name);
    const face = document.createElement('div'); face.className = 'card-face';
    if (portraitURL && useSpine()) { const img = document.createElement('img'); img.src = portraitURL; img.alt = ''; face.appendChild(img); }
    else { const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'); x.translate(32, 78); x.scale(.32, .32);
      drawVector(x, Object.assign({}, u, { x: 0, y: 0, h: 300, facing: 1, state: 'idle', stateT: 0, lunge: 0 }), 0);
      face.appendChild(c); }
    b.appendChild(face);
    b.insertAdjacentHTML('beforeend',
      `<div class="card-name">${u.name}</div><div class="card-key">${i + 1}</div>` +
      `<div class="bar hp"><i></i></div><div class="bar en"><i></i></div><div class="card-ult">ULTI ⚡</div>`);
    wrap.appendChild(b);
    cardRefs.push({ u, el: b, hp: b.querySelector('.hp'), hpI: b.querySelector('.hp i'),
      enI: b.querySelector('.en i'), lastHp: -1, lastEn: -1, lastReady: false, lastDead: false });
  });
}
function updateCards() {
  for (const r of cardRefs) {
    const hp = Math.round(r.u.hp / r.u.maxHp * 100), en = Math.round(r.u.energy);
    if (hp !== r.lastHp) { r.lastHp = hp; r.hpI.style.width = hp + '%'; r.hp.classList.toggle('low', hp <= 35); }
    if (en !== r.lastEn) { r.lastEn = en; r.enI.style.width = en + '%'; }
    const ready = r.u.alive && r.u.energy >= 100 && G.waveState === 'fight';
    if (ready !== r.lastReady) { r.lastReady = ready; r.el.classList.toggle('ready', ready); }
    if (!r.u.alive !== r.lastDead) { r.lastDead = !r.u.alive; r.el.classList.toggle('dead', !r.u.alive); }
  }
}
$('cards').addEventListener('click', e => {
  const b = e.target.closest('.card'); if (!b) return;
  const r = cardRefs[+b.dataset.i]; if (!r) return;
  AudioSys.ensure();
  if (!castUlt(r.u)) AudioSys.click();
});

/* ── banner / toast ── */
let bannerTO = 0;
function banner(txt) {
  const el = $('banner'); $('bannerText').textContent = txt;
  show(el, false); void el.offsetWidth; show(el, true);
  clearTimeout(bannerTO); bannerTO = setTimeout(() => show(el, false), 2300);
}
let toastTO = 0;
function toast(msg) {
  const el = $('toast'); el.textContent = msg; show(el, true);
  clearTimeout(toastTO); toastTO = setTimeout(() => show(el, false), 3200);
}

/* ── HUD botones ── */
function refreshHUDButtons() {
  $('btnAuto').classList.toggle('on', G.auto);
  $('btnSpeed').textContent = G.speed + '×';
  $('btnSound').textContent = G.muted ? '🔇' : '🔊';
  $('btnSound').classList.toggle('hbtn-off', G.muted);
  $('btnSound').classList.toggle('hbtn-on', !G.muted);
}
function togglePause(force) {
  if (G.mode !== 'battle' || G.waveState === 'done') return;
  G.paused = force !== undefined ? force : !G.paused;
  show($('pause'), G.paused);
  $('flipChk').checked = G.flipAll;
  AudioSys.click();
}
function toMenu() {
  G.mode = 'menu'; G.paused = false; G.units = []; G.events = []; G.fx = [];
  show($('hud'), false); show($('cards'), false); show($('pause'), false);
  show($('result'), false); show($('tip'), false); show($('boot'), true);
  $('bootProgress').textContent = `Nivel ${G.level} · 🪙 ${G.coins} · Récord: Nivel ${G.best}`;
  rebuildShowcase(); refreshStartMode(); save();
}

$('btnPause').onclick = () => togglePause();
$('btnResume').onclick = () => togglePause(false);
$('btnRestart').onclick = () => { AudioSys.click(); startBattle(); };
$('btnQuit').onclick = () => { AudioSys.click(); toMenu(); };
$('flipChk').onchange = e => { G.flipAll = e.target.checked; save(); };
$('btnAuto').onclick = () => { G.auto = !G.auto; save(); refreshHUDButtons(); AudioSys.click(); toast(G.auto ? 'Ultis automáticas: ON' : 'Ultis automáticas: OFF'); };
$('btnSpeed').onclick = () => { G.speed = G.speed === 1 ? 2 : G.speed === 2 ? 3 : 1; refreshHUDButtons(); AudioSys.click(); };
$('btnSound').onclick = () => { G.muted = !G.muted; AudioSys.ensure(); AudioSys.setMuted(G.muted); save(); refreshHUDButtons(); if (!G.muted) AudioSys.click(); };
$('btnNext').onclick = () => { AudioSys.click(); G.level++; save(); startBattle(); };
$('btnRetry').onclick = () => { AudioSys.click(); startBattle(); };
$('btnMenu').onclick = () => { AudioSys.click(); toMenu(); };
$('btnStart').onclick = () => { AudioSys.ensure(); AudioSys.wave(); startBattle(); };
$('btnVector').onclick = () => { G.forceVector = true; refreshStartMode(); rebuildShowcase(); AudioSys.ensure(); AudioSys.click(); toast('Modo vector activado'); };
$('diffRow').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  G.difficulty = b.dataset.d; save(); AudioSys.click();
  [...$('diffRow').children].forEach(x => x.classList.toggle('on', x === b));
});
[...$('diffRow').children].forEach(x => x.classList.toggle('on', x.dataset.d === G.difficulty));

/* ── entrada de archivos ── */
$('btnFiles').onclick = () => $('fileInput').click();
$('fileInput').onchange = e => { [...e.target.files].forEach(ingestFile); e.target.value = ''; };
window.addEventListener('dragover', e => { e.preventDefault(); $('drop').classList.add('over'); });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) $('drop').classList.remove('over'); });
window.addEventListener('drop', e => {
  e.preventDefault(); $('drop').classList.remove('over');
  if (e.dataTransfer && e.dataTransfer.files) [...e.dataTransfer.files].forEach(ingestFile);
});

/* ── teclado + puntero ── */
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (G.mode === 'battle') {
    if (k === ' ') { e.preventDefault(); togglePause(); }
    else if (k === 'a') $('btnAuto').click();
    else if (k === 'v') $('btnSpeed').click();
    else if (k === 's') $('btnSound').click();
    else if (['1', '2', '3'].includes(k) && !G.paused) {
      const r = cardRefs[+k - 1]; if (r) { AudioSys.ensure(); castUlt(r.u); }
    }
  } else if (k === 'enter') $('btnStart').click();
});
$('app').addEventListener('pointerdown', e => {
  if (e.target.closest('button, .boot-panel, .modal, input, a')) return;
  AudioSys.ensure();
  if (G.mode === 'menu') { pokeShowcase(); return; }
  if (G.paused || G.waveState !== 'fight') return;
  // tocar un héroe con energía llena lanza su ulti
  for (const u of G.units) if (u.side === 0 && u.alive) {
    if (Math.abs(e.clientX - u.x) < u.h * .35 && e.clientY > u.y - u.h * 1.15 && e.clientY < u.y + 20) {
      castUlt(u); return;
    }
  }
});

/* ── bucle principal (único) ── */
let lastT = performance.now(), started = false;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = clamp((now - lastT) / 1000, 0, .05); lastT = now;
  const t = now / 1000;
  drawBG(t);
  const simDt = (G.mode === 'battle' && !G.paused) ? dt * G.speed : 0;
  if (G.mode === 'battle') {
    G.battleT += simDt;
    runEvents();
    updateUnits(simDt, t);
    updateFX(simDt);
    if (useSpine()) renderSpine(G.units, t);
    else {
      if (gl && !glLost) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
      for (const u of G.units) if (u.alive || u.stateT < 2.6) drawVector(fxX, u, t);
    }
    drawFX(t);
    updateCards();
  } else {
    updateShowcase(dt, t);
    updateFX(dt);
    if (useSpine() && showU.sk) renderSpine([showU], t);
    else {
      if (gl && !glLost) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
      drawVector(fxX, showU, t);
    }
    drawFX(t);
  }
}

/* ── arranque ── */
function boot() {
  initGL();
  resize();
  window.addEventListener('resize', resize);
  $('bootProgress').textContent = `Nivel ${G.level} · 🪙 ${G.coins} · Récord: Nivel ${G.best}`;
  refreshHUDButtons(); refreshStartMode(); updateAssetStatus();
  rebuildShowcase(); layoutShowcase();
  loadRuntime();
  autoDetect();
  if (!started) { started = true; requestAnimationFrame(frame); }
}
boot();
})();