const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const W = canvas.width;
const H = canvas.height;

// ---------------------------------------------------------------- tuning

const PLAYER_SIZE = 30;
const PLAYER_SPEED = 300;

// Spawn interval eases from SPAWN_START down to SPAWN_MIN across RAMP seconds,
// so the opening is calm and it tightens from there.
const SPAWN_START = 0.85;
const SPAWN_MIN = 0.25;
const RAMP = 55;

// Steepest angle a falling shape can travel, measured off vertical.
const MAX_ANGLE = Math.PI / 3.2;

// Zappers hold off at the start so the first seconds stay readable.
const ZAP_FIRST = 7;
const ZAP_GAP_START = 6.5;
const ZAP_GAP_MIN = 3.2;
const ZAP_WARN = 0.9;
const ZAP_FIRE = 0.3;
const ZAP_THICKNESS = 15;

const NEON = ["#ff4d6d", "#ffd23f", "#3ddc97", "#4cc9f0", "#b892ff", "#ff8fab"];

// Hitboxes slightly smaller than the drawn shape. A near miss that clips a
// corner feels cheap, so the collision circle sits inside the artwork.
const FORGIVENESS = 0.82;

// ---------------------------------------------------------------- input

const keys = new Set();
let audioReady = false;

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);
  if (e.key.startsWith("Arrow") || k === " ") e.preventDefault();

  // Browsers block audio until a gesture, so the first keypress starts it.
  if (!audioReady) {
    audioReady = true;
    GameAudio.init();
    if (!state.gameOver) GameAudio.startMusic();
  }

  if (k === "m") GameAudio.toggleMute();
  if (state.gameOver && k === "r") reset();
});

window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

// ---------------------------------------------------------------- state

const state = {};

function reset() {
  state.player = { x: W / 2, y: H - 80 };
  state.obstacles = [];
  state.zappers = [];
  state.elapsed = 0;
  state.spawnTimer = 0;
  state.zapTimer = ZAP_FIRST;
  state.score = 0;
  state.gameOver = false;
  state.flash = 0;
  if (audioReady) GameAudio.startMusic();
}

// Drifting starfield. Lives outside reset() so it keeps moving on the game
// over screen instead of snapping back.
const stars = Array.from({ length: 70 }, () => ({
  x: Math.random() * W,
  y: Math.random() * H,
  r: Math.random() * 1.6 + 0.4,
  speed: Math.random() * 22 + 8,
}));

reset();

function die() {
  state.gameOver = true;
  state.flash = 0.4;
  GameAudio.stopMusic();
  GameAudio.gameOver();
}

// ---------------------------------------------------------------- obstacles

function spawnObstacle() {
  const radius = 12 + Math.random() * 20;
  // 0 means circle; 3-6 are the polygon side counts.
  const sides = [0, 3, 4, 5, 6][Math.floor(Math.random() * 5)];
  const difficulty = Math.min(state.elapsed / RAMP, 1);
  const speed = 120 + Math.random() * 90 + difficulty * 160;

  const x = radius + Math.random() * (W - radius * 2);

  // Aim at a point along the bottom edge and derive the angle from that. This
  // guarantees the shape crosses the playfield instead of drifting straight
  // back off the side it spawned on.
  const target = Math.random() * W;
  const angle = Math.max(
    -MAX_ANGLE,
    Math.min(MAX_ANGLE, Math.atan2(target - x, H))
  );

  state.obstacles.push({
    x,
    y: -radius * 2,
    radius,
    sides,
    vx: Math.sin(angle) * speed,
    vy: Math.cos(angle) * speed,
    rotation: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 2.5,
    color: NEON[Math.floor(Math.random() * NEON.length)],
  });
}

function hits(o, p) {
  const r = o.radius * FORGIVENESS;
  const half = PLAYER_SIZE / 2;

  // Closest point on the player's box to the obstacle's centre.
  const nx = Math.max(p.x - half, Math.min(o.x, p.x + half));
  const ny = Math.max(p.y - half, Math.min(o.y, p.y + half));
  const dx = o.x - nx;
  const dy = o.y - ny;

  return dx * dx + dy * dy <= r * r;
}

// ---------------------------------------------------------------- zappers

function spawnZapper() {
  // Horizontal beams are favoured because they are what force vertical
  // dodging, which is otherwise the least useful axis.
  const horizontal = Math.random() < 0.65;
  const span = horizontal ? H : W;

  state.zappers.push({
    horizontal,
    forward: Math.random() < 0.5,
    pos: 60 + Math.random() * (span - 120),
    firing: false,
    timer: ZAP_WARN,
  });

  GameAudio.warn();
}

// How far the beam has travelled across the screen, 0 to 1. It completes the
// crossing in the first part of the fire window, then lingers briefly.
function zapReach(z) {
  return Math.min((1 - z.timer / ZAP_FIRE) * 2.2, 1);
}

function zapHits(z, p) {
  const half = PLAYER_SIZE / 2;
  const edge = half + ZAP_THICKNESS / 2;
  const reach = zapReach(z);

  if (z.horizontal) {
    if (Math.abs(p.y - z.pos) > edge) return false;
    const len = W * reach;
    const x0 = z.forward ? 0 : W - len;
    return p.x + half > x0 && p.x - half < x0 + len;
  }

  if (Math.abs(p.x - z.pos) > edge) return false;
  const len = H * reach;
  const y0 = z.forward ? 0 : H - len;
  return p.y + half > y0 && p.y - half < y0 + len;
}

// ---------------------------------------------------------------- update

function update(dt) {
  for (const s of stars) {
    s.y += s.speed * dt;
    if (s.y > H) {
      s.y = -2;
      s.x = Math.random() * W;
    }
  }

  if (state.flash > 0) state.flash -= dt;
  if (state.gameOver) return;

  state.elapsed += dt;
  state.score += dt * 10;

  let dx = 0;
  let dy = 0;
  if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
  if (keys.has("arrowright") || keys.has("d")) dx += 1;
  if (keys.has("arrowup") || keys.has("w")) dy -= 1;
  if (keys.has("arrowdown") || keys.has("s")) dy += 1;

  // Normalise so diagonals aren't faster than straight lines.
  if (dx !== 0 && dy !== 0) {
    const inv = 1 / Math.sqrt(2);
    dx *= inv;
    dy *= inv;
  }

  const p = state.player;
  p.x += dx * PLAYER_SPEED * dt;
  p.y += dy * PLAYER_SPEED * dt;

  const half = PLAYER_SIZE / 2;
  p.x = Math.max(half, Math.min(W - half, p.x));
  p.y = Math.max(half, Math.min(H - half, p.y));

  const difficulty = Math.min(state.elapsed / RAMP, 1);

  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    spawnObstacle();
    state.spawnTimer = SPAWN_START + (SPAWN_MIN - SPAWN_START) * difficulty;
  }

  state.zapTimer -= dt;
  if (state.zapTimer <= 0) {
    spawnZapper();
    state.zapTimer = ZAP_GAP_START + (ZAP_GAP_MIN - ZAP_GAP_START) * difficulty;
  }

  for (let i = state.obstacles.length - 1; i >= 0; i--) {
    const o = state.obstacles[i];
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    o.rotation += o.spin * dt;

    if (o.y - o.radius > H || o.x + o.radius < 0 || o.x - o.radius > W) {
      state.obstacles.splice(i, 1);
      continue;
    }

    if (hits(o, p)) die();
  }

  for (let i = state.zappers.length - 1; i >= 0; i--) {
    const z = state.zappers[i];
    z.timer -= dt;

    if (!z.firing) {
      if (z.timer <= 0) {
        z.firing = true;
        z.timer = ZAP_FIRE;
        GameAudio.zap();
      }
      continue;
    }

    if (zapHits(z, p)) die();
    if (z.timer <= 0) state.zappers.splice(i, 1);
  }
}

// ---------------------------------------------------------------- drawing

const backdrop = ctx.createLinearGradient(0, 0, 0, H);
backdrop.addColorStop(0, "#1b1035");
backdrop.addColorStop(0.55, "#141a3d");
backdrop.addColorStop(1, "#0a0e1f");

function polygonPath(sides, radius) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawObstacle(o) {
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(o.rotation);

  ctx.shadowColor = o.color;
  ctx.shadowBlur = 14;
  ctx.strokeStyle = o.color;
  ctx.lineWidth = 2.5;
  ctx.fillStyle = o.color + "33"; // same hue, ~20% alpha

  if (o.sides === 0) {
    ctx.beginPath();
    ctx.arc(0, 0, o.radius, 0, Math.PI * 2);
  } else {
    polygonPath(o.sides, o.radius);
  }

  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawZapper(z) {
  ctx.save();

  if (!z.firing) {
    // Telegraph: a thin dashed line pulsing faster as the shot approaches.
    const urgency = 1 - z.timer / ZAP_WARN;
    const pulse = 0.35 + 0.45 * Math.abs(Math.sin(urgency * 18));

    ctx.strokeStyle = "rgba(255, 70, 90, " + pulse + ")";
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 10]);
    ctx.shadowColor = "#ff2d55";
    ctx.shadowBlur = 10;

    ctx.beginPath();
    if (z.horizontal) {
      ctx.moveTo(0, z.pos);
      ctx.lineTo(W, z.pos);
    } else {
      ctx.moveTo(z.pos, 0);
      ctx.lineTo(z.pos, H);
    }
    ctx.stroke();
    ctx.restore();
    return;
  }

  const reach = zapReach(z);
  const fade = Math.max(z.timer / ZAP_FIRE, 0);

  ctx.shadowColor = "#ff2d55";
  ctx.shadowBlur = 26;

  const beam = (width, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    if (z.horizontal) {
      const len = W * reach;
      const x0 = z.forward ? 0 : W - len;
      ctx.moveTo(x0, z.pos);
      ctx.lineTo(x0 + len, z.pos);
    } else {
      const len = H * reach;
      const y0 = z.forward ? 0 : H - len;
      ctx.moveTo(z.pos, y0);
      ctx.lineTo(z.pos, y0 + len);
    }
    ctx.stroke();
  };

  // A wide red glow with a hot white core reads as a beam, not a stripe.
  beam(ZAP_THICKNESS, "rgba(255, 45, 85, " + fade + ")");
  beam(ZAP_THICKNESS * 0.35, "rgba(255, 240, 245, " + fade + ")");

  ctx.restore();
}

function drawPlayer(p) {
  const half = PLAYER_SIZE / 2;

  ctx.save();
  ctx.shadowColor = "#42e8ff";
  ctx.shadowBlur = 18;

  const g = ctx.createLinearGradient(p.x - half, p.y - half, p.x + half, p.y + half);
  g.addColorStop(0, "#7af8ff");
  g.addColorStop(0.5, "#3aa7ff");
  g.addColorStop(1, "#6d4bff");

  ctx.fillStyle = g;
  ctx.fillRect(p.x - half, p.y - half, PLAYER_SIZE, PLAYER_SIZE);

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#d6fbff";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(p.x - half, p.y - half, PLAYER_SIZE, PLAYER_SIZE);
  ctx.restore();
}

function draw() {
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  for (const s of stars) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const o of state.obstacles) drawObstacle(o);
  for (const z of state.zappers) drawZapper(z);
  drawPlayer(state.player);

  ctx.fillStyle = "#8fa3c8";
  ctx.font = "bold 18px 'Courier New', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("SCORE " + String(Math.floor(state.score)).padStart(5, "0"), 16, 14);

  if (GameAudio.isMuted()) {
    ctx.textAlign = "right";
    ctx.fillText("MUTED", W - 16, 14);
  }

  if (state.flash > 0) {
    ctx.fillStyle = "rgba(255, 60, 90, " + (state.flash / 0.4) * 0.35 + ")";
    ctx.fillRect(0, 0, W, H);
  }

  if (state.gameOver) {
    ctx.fillStyle = "rgba(8, 10, 22, 0.72)";
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.shadowColor = "#ff4d6d";
    ctx.shadowBlur = 24;
    ctx.fillStyle = "#ff4d6d";
    ctx.font = "bold 66px 'Courier New', monospace";
    ctx.fillText("GAME OVER", W / 2, H / 2 - 40);

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#e8edf7";
    ctx.font = "bold 24px 'Courier New', monospace";
    ctx.fillText("SCORE " + Math.floor(state.score), W / 2, H / 2 + 30);

    ctx.fillStyle = "#8fa3c8";
    ctx.font = "16px 'Courier New', monospace";
    ctx.fillText("PRESS R TO RESTART", W / 2, H / 2 + 72);
  }
}

// ---------------------------------------------------------------- loop

let lastTime = performance.now();

function loop(now) {
  // Seconds since the last frame, capped so an alt-tab doesn't teleport things.
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  update(dt);
  draw();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
