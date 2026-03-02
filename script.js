const els = {
  canvas: /** @type {HTMLCanvasElement} */ (document.getElementById("game")),
  startBtn: document.getElementById("startBtn"),
  restartBtn: document.getElementById("restartBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  enemySpeed: /** @type {HTMLSelectElement} */ (document.getElementById("enemySpeed")),
  enemyCount: /** @type {HTMLSelectElement} */ (document.getElementById("enemyCount")),
  score: document.getElementById("score"),
  best: document.getElementById("best"),
  time: document.getElementById("time"),
  overlay: document.getElementById("overlay"),
  overlayTitle: document.getElementById("overlayTitle"),
  overlayText: document.getElementById("overlayText"),
  overlayStartBtn: document.getElementById("overlayStartBtn"),
  overlayRestartBtn: document.getElementById("overlayRestartBtn"),
};

const ctx = els.canvas.getContext("2d", { alpha: false });
if (!ctx) throw new Error("Canvas 2D context not available.");

const BASE_W = 480;
const BASE_H = 720;

const keys = new Set();

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let enemySpeedMultiplier = 1;
let enemyDensityMultiplier = 1;
let enemyMaxCount = 18;

function aabbOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function fmtSec(s) {
  return `${s.toFixed(1)}s`;
}

function loadBest() {
  const raw = localStorage.getItem("space_shooter_best");
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function saveBest(n) {
  localStorage.setItem("space_shooter_best", String(Math.max(0, Math.floor(n))));
}

/** @type {{x:number,y:number,w:number,h:number,speed:number}} */
let player;

/** @type {Array<{x:number,y:number,w:number,h:number,speed:number,wiggle:number,phase:number}>} */
let enemies = [];

/** @type {Array<{x:number,y:number,r:number,vy:number,alpha:number}>} */
let stars = [];

/** @type {Array<{x:number,y:number,vx:number,vy:number,length:number,life:number,maxLife:number,alpha:number}>} */
let shootingStars = [];

/** @type {Array<{x:number,y:number,r:number,vy:number,tail:number,alpha:number}>} */
let comets = [];

/** @type {Array<{x:number,y:number,r:number,inner:string,outer:string,ring?:boolean}>} */
let planets = [];

/** @type {Array<{x:number,y:number,r:number,vy:number,value:number}>} */
let bonusStars = [];

let running = false;
let paused = false;
let gameOver = false;

let score = 0;
let bonusScore = 0;
let best = loadBest();
let tStart = 0;
let tNow = 0;

let spawnAcc = 0;
let difficulty = 0;
let shootAcc = 0;
let cometAcc = 0;
let bonusAcc = 0;
let playerFlashUntil = 0;

function resizeCanvas() {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const cssW = els.canvas.clientWidth || BASE_W;
  const cssH = els.canvas.clientHeight || BASE_H;

  const targetW = Math.round(cssW * dpr);
  const targetH = Math.round(cssH * dpr);
  if (els.canvas.width !== targetW || els.canvas.height !== targetH) {
    els.canvas.width = targetW;
    els.canvas.height = targetH;
  }
  ctx.setTransform(targetW / BASE_W, 0, 0, targetH / BASE_H, 0, 0);
  ctx.imageSmoothingEnabled = true;
}

function resetWorld() {
  player = {
    w: 34,
    h: 44,
    x: BASE_W / 2 - 17,
    y: BASE_H - 70,
    speed: 320, // px/s
  };
  enemies = [];
  stars = [];
  shootingStars = [];
  comets = [];
  planets = [
    {
      x: BASE_W * 0.22,
      y: BASE_H * 0.22,
      r: 90,
      inner: "rgba(190,215,255,0.9)",
      outer: "rgba(30,60,150,0.0)",
      ring: true,
    },
    {
      x: BASE_W * 0.8,
      y: BASE_H * 0.16,
      r: 56,
      inner: "rgba(255,190,220,0.95)",
      outer: "rgba(150,60,140,0.0)",
    },
    {
      x: BASE_W * 0.12,
      y: BASE_H * 0.7,
      r: 44,
      inner: "rgba(210,255,200,0.9)",
      outer: "rgba(40,120,60,0.0)",
    },
  ];
  for (let i = 0; i < 90; i++) {
    stars.push({
      x: Math.random() * BASE_W,
      y: Math.random() * BASE_H,
      r: 0.6 + Math.random() * 1.8,
      vy: 30 + Math.random() * 110,
      alpha: 0.25 + Math.random() * 0.7,
    });
  }

  score = 0;
  bonusScore = 0;
  difficulty = 0;
  spawnAcc = 0;
  shootAcc = 0;
  cometAcc = 0;
  bonusAcc = 0;
  playerFlashUntil = 0;
  tStart = performance.now();
  tNow = tStart;
  gameOver = false;
  paused = false;
  els.pauseBtn.setAttribute("aria-pressed", "false");
  els.pauseBtn.textContent = "Pause";
  renderHUD(0);
}

function showOverlay(title, text, showStart = true) {
  els.overlayTitle.textContent = title;
  els.overlayText.innerHTML = text;
  els.overlayStartBtn.style.display = showStart ? "" : "none";
  els.overlay.classList.add("is-visible");
}

function hideOverlay() {
  els.overlay.classList.remove("is-visible");
}

function startGame() {
  if (running && !gameOver) return;
  resetWorld();
  running = true;
  hideOverlay();
}

function restartGame() {
  resetWorld();
  running = true;
  hideOverlay();
}

function togglePause() {
  if (!running || gameOver) return;
  paused = !paused;
  els.pauseBtn.setAttribute("aria-pressed", String(paused));
  els.pauseBtn.textContent = paused ? "Resume" : "Pause";
  if (paused) {
    showOverlay("Paused", "Press <b>P</b> to resume.", false);
  } else {
    hideOverlay();
  }
}

function endGame() {
  gameOver = true;
  running = true; // keep loop for overlay
  paused = false;
  const s = Math.floor(score);
  if (s > best) {
    best = s;
    saveBest(best);
  }
  renderHUD((tNow - tStart) / 1000);
  showOverlay(
    "Game Over",
    `You were hit. Final score: <b>${s}</b>.<br/>Press <b>R</b> to restart.`,
    false,
  );
}

function spawnEnemy() {
  const w = 32 + Math.random() * 22;
  const h = 36 + Math.random() * 26;
  const x = Math.random() * (BASE_W - w);
  if (enemies.length >= enemyMaxCount) return;
  const baseSpeed = (140 + difficulty * 70) * enemySpeedMultiplier;
  const speed = baseSpeed + Math.random() * 120;
  enemies.push({
    x,
    y: -h - 10,
    w,
    h,
    speed,
    wiggle: Math.random() * 30,
    phase: Math.random() * Math.PI * 2,
  });
}

function spawnShootingStar() {
  const fromTop = Math.random() < 0.5;
  const startX = fromTop ? Math.random() * BASE_W * 0.6 : -40;
  const startY = fromTop ? -20 : Math.random() * BASE_H * 0.4;
  const speed = 420 + Math.random() * 180;
  const angle = Math.PI / 3 + Math.random() * 0.3; // down-right
  shootingStars.push({
    x: startX,
    y: startY,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    length: 60 + Math.random() * 40,
    life: 0,
    maxLife: 0.9 + Math.random() * 0.8,
    alpha: 0.25 + Math.random() * 0.35,
  });
}

function spawnComet() {
  const r = 10 + Math.random() * 12;
  const x = 40 + Math.random() * (BASE_W - 80);
  const y = -30;
  const vy = 160 + Math.random() * 80;
  comets.push({
    x,
    y,
    r,
    vy,
    tail: 70 + Math.random() * 40,
    alpha: 0.5 + Math.random() * 0.3,
  });
}

function spawnBonusStar() {
  if (bonusStars.length >= 3) return;
  const r = 10 + Math.random() * 6;
  const x = 20 + Math.random() * (BASE_W - 40);
  const y = -20;
  const vy = 120 + Math.random() * 80;
  bonusStars.push({
    x,
    y,
    r,
    vy,
    value: 150,
  });
}

function inputVector() {
  const left = keys.has("ArrowLeft") || keys.has("KeyA");
  const right = keys.has("ArrowRight") || keys.has("KeyD");
  const up = keys.has("ArrowUp") || keys.has("KeyW");
  const down = keys.has("ArrowDown") || keys.has("KeyS");
  const x = (right ? 1 : 0) - (left ? 1 : 0);
  const y = (down ? 1 : 0) - (up ? 1 : 0);
  if (!x && !y) return { x: 0, y: 0 };
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

function update(dt) {
  if (!running) return;
  if (gameOver) return;
  if (paused) return;

  const seconds = (tNow - tStart) / 1000;
  difficulty = clamp(seconds / 22, 0, 3.2);

  // Spawn logic: faster spawns as time and density increase
  const spawnsPerSec = (0.9 + difficulty * 1.2) * enemyDensityMultiplier;
  spawnAcc += dt * spawnsPerSec;
  while (spawnAcc >= 1) {
    if (enemies.length >= enemyMaxCount) {
      spawnAcc = 0;
      break;
    }
    spawnAcc -= 1;
    spawnEnemy();
  }

  // Stars background
  for (const s of stars) {
    s.y += s.vy * dt;
    if (s.y > BASE_H + 10) {
      s.y = -10;
      s.x = Math.random() * BASE_W;
      s.vy = 30 + Math.random() * 110;
      s.r = 0.6 + Math.random() * 1.8;
      s.alpha = 0.25 + Math.random() * 0.7;
    }
  }

  // Shooting stars & comets
  shootAcc += dt;
  if (shootAcc > 2.4 + Math.random() * 1.8) {
    shootAcc = 0;
    spawnShootingStar();
  }

  cometAcc += dt;
  if (cometAcc > 6 + Math.random() * 4) {
    cometAcc = 0;
    spawnComet();
  }

  // Bonus stars
  bonusAcc += dt;
  if (bonusAcc > 5 + Math.random() * 4) {
    bonusAcc = 0;
    spawnBonusStar();
  }

  for (const st of shootingStars) {
    st.x += st.vx * dt;
    st.y += st.vy * dt;
    st.life += dt;
  }
  shootingStars = shootingStars.filter(
    (st) =>
      st.life < st.maxLife &&
      st.x > -100 &&
      st.x < BASE_W + 100 &&
      st.y > -100 &&
      st.y < BASE_H + 100,
  );

  for (const c of comets) {
    c.y += c.vy * dt;
  }
  comets = comets.filter((c) => c.y - c.r < BASE_H + 80);

  for (const b of bonusStars) {
    b.y += b.vy * dt;
  }
  bonusStars = bonusStars.filter((b) => b.y - b.r < BASE_H + 40);

  // Player movement
  const iv = inputVector();
  const speed = player.speed;
  player.x += iv.x * speed * dt;
  player.y += iv.y * speed * dt;
  player.x = clamp(player.x, 0, BASE_W - player.w);
  player.y = clamp(player.y, 0, BASE_H - player.h);

  // Enemies
  for (const e of enemies) {
    e.phase += dt * 2.2;
    e.x += Math.sin(e.phase) * e.wiggle * dt * 0.8;
    e.y += e.speed * dt;
  }
  enemies = enemies.filter((e) => e.y < BASE_H + 120);

  // Score: survive time + small bonus from dodging density, plus collected bonuses
  const baseScore = seconds * 10 + enemies.length * 0.15;
  score = baseScore + bonusScore;

  // Collision (slightly forgiving hitbox)
  const pBox = { x: player.x + 5, y: player.y + 6, w: player.w - 10, h: player.h - 12 };
  for (const e of enemies) {
    const eBox = { x: e.x + 4, y: e.y + 6, w: e.w - 8, h: e.h - 12 };
    if (aabbOverlap(pBox, eBox)) {
      endGame();
      break;
    }
  }

  // Bonus star collection
  bonusStars = bonusStars.filter((b) => {
    const bBox = { x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 };
    if (aabbOverlap(pBox, bBox)) {
      bonusScore += b.value;
      playerFlashUntil = Math.max(playerFlashUntil, tNow + 2000);
      return false;
    }
    return true;
  });

  renderHUD(seconds);
}

function renderHUD(seconds) {
  els.score.textContent = String(Math.max(0, Math.floor(score)));
  els.best.textContent = String(best);
  els.time.textContent = fmtSec(Math.max(0, seconds));
}

function drawShip(x, y, w, h, fill, stroke) {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.beginPath();
  ctx.moveTo(0, -h / 2);
  ctx.lineTo(w / 2, h / 2);
  ctx.lineTo(0, h / 2 - 10);
  ctx.lineTo(-w / 2, h / 2);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.stroke();

  // cockpit glow
  ctx.beginPath();
  ctx.ellipse(0, 2, w * 0.16, h * 0.18, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(85, 230, 255, 0.6)";
  ctx.fill();
  ctx.restore();
}

function render() {
  // background
  ctx.fillStyle = "#070914";
  ctx.fillRect(0, 0, BASE_W, BASE_H);

  // subtle nebula
  const g = ctx.createRadialGradient(BASE_W * 0.3, BASE_H * 0.1, 10, BASE_W * 0.3, BASE_H * 0.1, 520);
  g.addColorStop(0, "rgba(110,168,255,0.18)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, BASE_W, BASE_H);

  // planets (behind stars)
  for (const p of planets) {
    const pg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
    pg.addColorStop(0, p.inner);
    pg.addColorStop(1, p.outer);
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();

    if (p.ring) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(-Math.PI / 7);
      ctx.strokeStyle = "rgba(210,230,255,0.65)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r * 1.25, p.r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // stars
  for (const s of stars) {
    ctx.fillStyle = `rgba(255,255,255,${s.alpha})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // shooting stars
  for (const st of shootingStars) {
    const dx = -st.vx;
    const dy = -st.vy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = (dx / len) * st.length;
    const uy = (dy / len) * st.length;
    const x2 = st.x;
    const y2 = st.y;
    const x1 = x2 + ux;
    const y1 = y2 + uy;
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(1, `rgba(220,240,255,${st.alpha})`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // comets
  for (const c of comets) {
    const tailGrad = ctx.createLinearGradient(c.x, c.y - c.tail, c.x, c.y + c.r);
    tailGrad.addColorStop(0, "rgba(180,220,255,0)");
    tailGrad.addColorStop(1, `rgba(180,220,255,${c.alpha * 0.8})`);
    ctx.fillStyle = tailGrad;
    ctx.beginPath();
    ctx.moveTo(c.x - c.r * 0.25, c.y + c.r * 0.15);
    ctx.lineTo(c.x + c.r * 0.25, c.y + c.r * 0.15);
    ctx.lineTo(c.x, c.y + c.tail);
    ctx.closePath();
    ctx.fill();

    const headGrad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
    headGrad.addColorStop(0, `rgba(255,255,255,${c.alpha})`);
    headGrad.addColorStop(1, "rgba(170,210,255,0)");
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // bonus stars (yellow collectibles)
  for (const b of bonusStars) {
    ctx.save();
    ctx.translate(b.x, b.y);
    const spikes = 5;
    const outerR = b.r;
    const innerR = b.r * 0.45;
    let rot = -Math.PI / 2;
    const step = Math.PI / spikes;

    ctx.beginPath();
    ctx.moveTo(Math.cos(rot) * outerR, Math.sin(rot) * outerR);
    for (let i = 0; i < spikes; i++) {
      rot += step;
      ctx.lineTo(Math.cos(rot) * innerR, Math.sin(rot) * innerR);
      rot += step;
      ctx.lineTo(Math.cos(rot) * outerR, Math.sin(rot) * outerR);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 225, 120, 0.95)";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255, 255, 180, 0.9)";
    ctx.stroke();
    ctx.restore();
  }

  // enemies
  for (const e of enemies) {
    drawShip(e.x, e.y, e.w, e.h, "rgba(255,77,109,0.80)", "rgba(255,190,200,0.35)");
  }

  // player
  const flashing = tNow < playerFlashUntil;
  const blinkOn = flashing ? Math.floor(tNow / 120) % 2 === 0 : false;
  const playerFill = blinkOn ? "rgba(255, 240, 160, 0.98)" : "rgba(110,168,255,0.92)";
  const playerStroke = blinkOn ? "rgba(255, 255, 210, 0.95)" : "rgba(200,225,255,0.35)";
  drawShip(player.x, player.y, player.w, player.h, playerFill, playerStroke);

  // top vignette for contrast
  const vg = ctx.createLinearGradient(0, 0, 0, 110);
  vg.addColorStop(0, "rgba(0,0,0,0.35)");
  vg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, BASE_W, 110);
}

let last = performance.now();
function loop(now) {
  tNow = now;
  const dt = clamp((now - last) / 1000, 0, 0.033);
  last = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

window.addEventListener("resize", () => resizeCanvas(), { passive: true });

document.addEventListener(
  "keydown",
  (e) => {
    // prevent page scroll for arrows/space
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
    keys.add(e.code);

    if (e.code === "KeyP") togglePause();
    if (e.code === "KeyR") restartGame();
    if (e.code === "Enter") {
      if (!running || gameOver) startGame();
    }
  },
  { passive: false },
);

document.addEventListener("keyup", (e) => {
  keys.delete(e.code);
});

els.startBtn.addEventListener("click", () => startGame());
els.restartBtn.addEventListener("click", () => restartGame());
els.pauseBtn.addEventListener("click", () => togglePause());
els.overlayStartBtn.addEventListener("click", () => startGame());
els.overlayRestartBtn.addEventListener("click", () => restartGame());

best = loadBest();
els.best.textContent = String(best);
if (els.enemySpeed) {
  const v = Number(els.enemySpeed.value);
  enemySpeedMultiplier = Number.isFinite(v) && v > 0 ? v : 1;
  els.enemySpeed.addEventListener("change", () => {
    const next = Number(els.enemySpeed.value);
    enemySpeedMultiplier = Number.isFinite(next) && next > 0 ? next : 1;
  });
}
if (els.enemyCount) {
  const [dStr, mStr] = String(els.enemyCount.value).split("|");
  const d = Number(dStr);
  const m = Number(mStr);
  enemyDensityMultiplier = Number.isFinite(d) && d > 0 ? d : 1;
  enemyMaxCount = Number.isFinite(m) && m > 0 ? m : 18;
  els.enemyCount.addEventListener("change", () => {
    const [dS, mS] = String(els.enemyCount.value).split("|");
    const dd = Number(dS);
    const mm = Number(mS);
    enemyDensityMultiplier = Number.isFinite(dd) && dd > 0 ? dd : 1;
    enemyMaxCount = Number.isFinite(mm) && mm > 0 ? mm : 18;
  });
}
resizeCanvas();
resetWorld();
showOverlay("Space Shooter", "Move with <b>Arrow keys</b> or <b>WASD</b>. Avoid enemy ships.", true);
requestAnimationFrame(loop);
