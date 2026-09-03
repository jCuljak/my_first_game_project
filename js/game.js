const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const W = canvas.width;
const H = canvas.height;

const FONT = '"Press Start 2P", "Courier New", monospace';

// ---------------------------------------------------------------- tuning

const PLAYER_SIZE = 30;
const MAX_SPEED = 330;
const ACCEL = 2400; // px/s^2 while a direction is held
const FRICTION = 9; // exponential damping once input stops

const MAX_HEALTH = 2;
// Long enough to fly clear of whatever just hit you, short enough that it
// isn't a free pass through the next wave.
const IFRAME_TIME = 1.4;
const FULL_HEALTH_BONUS = 100;

const DASH_SPEED = 1150;
const DASH_TIME = 0.2;
const DASH_COOLDOWN = 6;

const TRAIL_STEP = 0.025;
const TRAIL_MAX = 14;

// Difficulty climbs in discrete steps rather than continuously, so each jump
// is something you can feel and the level-up cue has a moment to mark.
// 12 steps of 20 seconds means the game tops out at four minutes.
const STEP_TIME = 20;
const MAX_LEVEL = 12;

const SPAWN_START = 0.85;
const SPAWN_MIN = 0.22;

const OBJ_MIN_SIZE = 10;
const OBJ_SIZE_RANGE = 14; // 10-24 across

// Steepest angle a falling shape can travel, measured off vertical.
const MAX_ANGLE = Math.PI / 3.2;

const SEEKER_DELAY = 15; // seconds before seekers start appearing
const SEEKER_CHANCE_MIN = 0.1;
const SEEKER_CHANCE_MAX = 0.26;
const SEEKER_ACCEL = 210;
const SEEKER_MAX = 320;
const SEEKER_TRACK = 4.5; // it only chases for this long, then flies straight
const SEEKER_COLOR = "#ff2fb0";

const VOLATILE_MIN = 0.18;
const VOLATILE_MAX = 0.34;
const FUSE_MIN = 1.3;
const FUSE_RANGE = 0.9;
const CRACK_TIME = 0.65; // how long the crack-and-shake tell runs
const FRAG_MIN = 2;
const FRAG_RANGE = 3; // 2 to 4 pieces
const FRAG_LIFE = 2.6;

const ZAP_FIRST = 9;
const ZAP_GAP_START = 6.5;
const ZAP_GAP_MIN = 2.6;
const ZAP_WARN = 0.9;
const ZAP_FIRE = 0.3;
const ZAP_THICKNESS = 15;
const ZAP_MARGIN = 40; // beam starts and ends this far outside the canvas

// One power-up every 13-20s. Frequent enough to plan around, rare enough
// that grabbing one still feels like a break.
const POWERUP_FIRST = 11;
const POWERUP_GAP_MIN = 13;
const POWERUP_GAP_RANGE = 7;
const POWERUP_RADIUS = 15;
const POWERUP_SPEED = 85;
const POWERUP_DRIFT = 40;

// 40% speed for 5s. Enough to walk out of a wall of shapes, short enough
// that it never becomes the way you play.
const SLOW_FACTOR = 0.4;
const SLOW_TIME = 5;

const HEALTH_COLOR = "#34e88a";
const SLOW_COLOR = "#b892ff";

const SHAKE_MAX = 14;
const SHAKE_DECAY = 26;

const NEON = ["#ff4d6d", "#ffd23f", "#3ddc97", "#4cc9f0", "#b892ff", "#ff8fab"];

// Hitboxes slightly smaller than the drawn shape. A near miss that clips a
// corner feels cheap, so the collision circle sits inside the artwork.
const FORGIVENESS = 0.82;
// Power-ups get the opposite treatment: easier to grab than they look.
const PICKUP_GENEROSITY = 1.2;

const BEST_KEY = "mfg-best";

// ---------------------------------------------------------------- best score

// localStorage throws outright on some file:// setups, so every access is
// guarded and the game simply runs without a saved best if it fails.
function loadBest() {
  try {
    return parseInt(localStorage.getItem(BEST_KEY), 10) || 0;
  } catch (e) {
    return 0;
  }
}

function saveBest(value) {
  try {
    localStorage.setItem(BEST_KEY, String(value));
  } catch (e) {
    /* not persisted this session */
  }
}

let best = loadBest();

// ---------------------------------------------------------------- input

const keys = new Set();
let audioReady = false;
let started = false;

function inputDir() {
  let x = 0;
  let y = 0;
  if (keys.has("arrowleft") || keys.has("a")) x -= 1;
  if (keys.has("arrowright") || keys.has("d")) x += 1;
  if (keys.has("arrowup") || keys.has("w")) y -= 1;
  if (keys.has("arrowdown") || keys.has("s")) y += 1;

  // Normalise so diagonals aren't faster than straight lines.
  if (x !== 0 && y !== 0) {
    const inv = 1 / Math.SQRT2;
    x *= inv;
    y *= inv;
  }
  return { x, y };
}

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  keys.add(k);
  if (e.key.startsWith("Arrow") || k === " ") e.preventDefault();

  // Browsers block audio until a gesture, which is exactly what the title
  // screen is for: the key that starts the run also unlocks the sound.
  if (!audioReady) {
    audioReady = true;
    GameAudio.init();
  }

  if (!started) {
    started = true;
    GameAudio.startMusic();
    return;
  }

  if (k === "m") GameAudio.toggleMute();
  if (k === "r" && state.gameOver) reset();
  if (k === "escape" && !state.gameOver) togglePause();
  // e.repeat guards against key-repeat firing the dash more than once.
  if (k === "shift" && !e.repeat && !state.paused && !state.gameOver) tryDash();
});

window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

// ---------------------------------------------------------------- state

const state = {};

function reset() {
  state.player = { x: W / 2, y: H - 80, vx: 0, vy: 0, faceX: 0, faceY: -1, dashTime: 0 };
  state.obstacles = [];
  state.fragments = [];
  state.debris = [];
  state.zappers = [];
  state.powerups = [];
  state.trail = [];
  state.trailTimer = 0;
  state.elapsed = 0;
  state.spawnTimer = 0;
  state.zapTimer = ZAP_FIRST;
  state.powerTimer = POWERUP_FIRST;
  state.dashCd = 0;
  state.health = MAX_HEALTH;
  state.invuln = 0;
  state.slowTime = 0;
  state.score = 0;
  state.level = 0;
  state.levelFlash = 0;
  state.pickupFlash = 0;
  state.pickupKind = null;
  state.pickupLabel = "";
  state.shake = 0;
  state.newBest = false;
  state.paused = false;
  state.gameOver = false;
  state.flash = 0;

  GameAudio.setLevel(0);
  GameAudio.setSlow(false);
  if (started) GameAudio.startMusic();
}

// Drifting starfield. Lives outside reset() so it keeps moving on the title
// and game over screens instead of snapping back.
const stars = Array.from({ length: 70 }, () => ({
  x: Math.random() * W,
  y: Math.random() * H,
  r: Math.random() * 1.6 + 0.4,
  speed: Math.random() * 22 + 8,
}));

reset();

function addShake(amount) {
  state.shake = Math.min(state.shake + amount, SHAKE_MAX);
}

function togglePause() {
  state.paused = !state.paused;
  if (state.paused) GameAudio.stopMusic();
  else if (started) GameAudio.startMusic();
}

function tryDash() {
  if (state.dashCd > 0) return;

  const p = state.player;
  const d = inputDir();
  const moving = d.x !== 0 || d.y !== 0;

  // Standing still dashes the way you last moved.
  p.vx = (moving ? d.x : p.faceX) * DASH_SPEED;
  p.vy = (moving ? d.y : p.faceY) * DASH_SPEED;
  p.dashTime = DASH_TIME;
  state.dashCd = DASH_COOLDOWN;
  GameAudio.dash();
}

// Scatters shards from the player. Purely cosmetic: these live in their own
// list and never collide with anything.
function burstPlayer(count, color) {
  const p = state.player;

  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = 90 + Math.random() * 220;

    state.debris.push({
      x: p.x,
      y: p.y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      size: 3 + Math.random() * 6,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 10,
      life: 1.1 + Math.random() * 0.6,
      color,
    });
  }
}

// Everything lethal calls this, not die(). The invulnerability window is what
// stops one object draining both lives on consecutive frames.
function hit() {
  if (state.gameOver || state.invuln > 0) return;

  state.health -= 1;

  if (state.health <= 0) {
    die();
    return;
  }

  state.invuln = IFRAME_TIME;
  state.flash = 0.3;
  addShake(9);
  burstPlayer(8, "255, 120, 150");
  GameAudio.hurt();
}

function die() {
  // Two things can land on the same frame; only the first should count.
  if (state.gameOver) return;

  state.gameOver = true;
  state.health = 0;
  state.flash = 0.4;
  addShake(13);
  state.trail.length = 0;
  burstPlayer(14, "122, 248, 255");

  const final = Math.floor(state.score);
  if (final > best) {
    best = final;
    state.newBest = true;
    saveBest(best);
  }

  GameAudio.setSlow(false);
  GameAudio.stopMusic();
  GameAudio.gameOver();
}

// ---------------------------------------------------------------- obstacles

// Short strokes radiating from the centre, generated once so the cracks stay
// put and simply grow rather than flickering to new positions each frame.
function makeCracks(radius) {
  return Array.from({ length: 3 }, () => {
    const a = Math.random() * Math.PI * 2;
    const inner = radius * 0.12;
    const outer = radius * (0.6 + Math.random() * 0.3);
    const bend = a + (Math.random() - 0.5) * 0.6;
    return {
      x1: Math.cos(a) * inner,
      y1: Math.sin(a) * inner,
      x2: Math.cos(bend) * outer,
      y2: Math.sin(bend) * outer,
    };
  });
}

// 0 at level 0, 1 once the game has topped out.
function difficulty() {
  return state.level / MAX_LEVEL;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function spawnObstacle() {
  const d = difficulty();
  const seekerChance = lerp(SEEKER_CHANCE_MIN, SEEKER_CHANCE_MAX, d);
  const seeker = state.elapsed > SEEKER_DELAY && Math.random() < seekerChance;

  const radius = seeker ? 15 : OBJ_MIN_SIZE + Math.random() * OBJ_SIZE_RANGE;
  const speed = 110 + Math.random() * 80 + d * 200;
  const x = radius + Math.random() * (W - radius * 2);

  // Aim at a point along the bottom edge and derive the angle from that. This
  // guarantees the shape crosses the playfield instead of drifting straight
  // back off the side it spawned on.
  const target = Math.random() * W;
  const angle = Math.max(
    -MAX_ANGLE,
    Math.min(MAX_ANGLE, Math.atan2(target - x, H))
  );

  const o = {
    seeker,
    x,
    y: -radius * 2,
    radius,
    // 0 means circle; 3-6 are the polygon side counts.
    sides: seeker ? 0 : [0, 3, 4, 5, 6][Math.floor(Math.random() * 5)],
    vx: Math.sin(angle) * speed,
    vy: Math.cos(angle) * speed,
    rotation: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 2.5,
    color: seeker ? SEEKER_COLOR : NEON[Math.floor(Math.random() * NEON.length)],
    track: SEEKER_TRACK,
    fuse: 0,
    cracks: null,
  };

  if (!seeker && Math.random() < lerp(VOLATILE_MIN, VOLATILE_MAX, d)) {
    o.fuse = FUSE_MIN + Math.random() * FUSE_RANGE;
    o.cracks = makeCracks(o.radius);
  }

  state.obstacles.push(o);
}

function explode(o) {
  const count = FRAG_MIN + Math.floor(Math.random() * FRAG_RANGE); // 2 to 4
  const base = Math.random() * Math.PI * 2;

  for (let i = 0; i < count; i++) {
    // Evenly spaced around the circle, then jittered, so pieces always spread
    // outward instead of clumping to one side.
    const a = base + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const speed = 150 + Math.random() * 120;

    state.fragments.push({
      x: o.x,
      y: o.y,
      radius: o.radius * 0.46,
      vx: Math.cos(a) * speed + o.vx * 0.35,
      vy: Math.sin(a) * speed + o.vy * 0.35,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 7,
      color: o.color,
      life: FRAG_LIFE,
    });
  }

  addShake(4);
  GameAudio.burst();
}

function hits(x, y, radius, p) {
  const r = radius * FORGIVENESS;
  const half = PLAYER_SIZE / 2;

  // Closest point on the player's box to the circle's centre.
  const nx = Math.max(p.x - half, Math.min(x, p.x + half));
  const ny = Math.max(p.y - half, Math.min(y, p.y + half));
  const dx = x - nx;
  const dy = y - ny;

  return dx * dx + dy * dy <= r * r;
}

// ---------------------------------------------------------------- power-ups

// hits() shrinks whatever radius it is handed by FORGIVENESS, which is right
// for things that kill you and wrong for things you want to catch. Dividing
// it back out leaves a pickup radius 20% larger than the drawn icon.
const PICKUP_REACH = (POWERUP_RADIUS * PICKUP_GENEROSITY) / FORGIVENESS;

function spawnPowerup() {
  // Health is weighted up when you actually need it, so what drifts down is
  // usually worth crossing the screen for.
  const healthChance = state.health < MAX_HEALTH ? 0.55 : 0.35;

  state.powerups.push({
    kind: Math.random() < healthChance ? "health" : "slow",
    x: POWERUP_RADIUS * 2 + Math.random() * (W - POWERUP_RADIUS * 4),
    y: -POWERUP_RADIUS * 2,
    vx: (Math.random() - 0.5) * POWERUP_DRIFT * 2,
    vy: POWERUP_SPEED,
    phase: Math.random() * Math.PI * 2,
  });
}

function collect(pu) {
  state.pickupFlash = 1.4;
  state.pickupKind = pu.kind;
  GameAudio.pickup(pu.kind);

  if (pu.kind === "slow") {
    state.slowTime = SLOW_TIME;
    GameAudio.setSlow(true);
    state.pickupLabel = "SLOW MOTION";
    return;
  }

  // A pickup you cannot use should still be worth the detour.
  if (state.health < MAX_HEALTH) {
    state.health += 1;
    state.pickupLabel = "LIFE RESTORED";
  } else {
    state.score += FULL_HEALTH_BONUS;
    state.pickupLabel = "BONUS +" + FULL_HEALTH_BONUS;
  }
}

// ---------------------------------------------------------------- zappers

// Clip the infinite line through (px, py) against the canvas rectangle and
// return the parameter range that lies inside it. Centring a fixed-length
// segment on the pass-through point is what used to let beams stop mid-screen
// when that point happened to sit near a corner.
function spanCanvas(px, py, dx, dy) {
  let tMin = -Infinity;
  let tMax = Infinity;

  const slab = (origin, delta, hi) => {
    if (delta === 0) return; // parallel to this pair of edges
    const t1 = (0 - origin) / delta;
    const t2 = (hi - origin) / delta;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  };

  slab(px, dx, W);
  slab(py, dy, H);
  return { tMin, tMax };
}

function spawnZapper() {
  const angle = Math.random() * Math.PI * 2;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  // The pass-through point stays well inside the canvas, so the clipped span
  // is always a real crossing rather than a nick off one corner.
  const px = W * (0.2 + Math.random() * 0.6);
  const py = H * (0.2 + Math.random() * 0.6);

  const { tMin, tMax } = spanCanvas(px, py, dx, dy);

  state.zappers.push({
    x0: px + dx * (tMin - ZAP_MARGIN),
    y0: py + dy * (tMin - ZAP_MARGIN),
    dx,
    dy,
    len: tMax - tMin + ZAP_MARGIN * 2,
    firing: false,
    timer: ZAP_WARN,
  });

  GameAudio.warn();
}

// How far the beam has travelled along its line, 0 to 1. It completes the
// crossing in the first part of the fire window, then lingers briefly.
function zapReach(z) {
  return Math.min((1 - z.timer / ZAP_FIRE) * 2.2, 1);
}

function zapHits(z, p) {
  const rx = p.x - z.x0;
  const ry = p.y - z.y0;

  // Project onto the beam to get distance along it, and take the cross
  // product for perpendicular distance from its line.
  const along = rx * z.dx + ry * z.dy;
  const perp = Math.abs(rx * z.dy - ry * z.dx);

  // The square's inscribed circle, which errs forgiving on the corners.
  const pr = PLAYER_SIZE / 2;
  if (perp > ZAP_THICKNESS / 2 + pr) return false;

  return along > -pr && along < z.len * zapReach(z) + pr;
}

// ---------------------------------------------------------------- update

function updatePlayer(dt) {
  const p = state.player;
  const d = inputDir();

  if (d.x || d.y) {
    p.faceX = d.x;
    p.faceY = d.y;
  }

  if (p.dashTime > 0) {
    // During a dash the speed cap is off and drag is light, so it flies then
    // eases out instead of stopping dead.
    p.dashTime -= dt;
    const f = Math.exp(-3.2 * dt);
    p.vx *= f;
    p.vy *= f;
  } else {
    p.vx += d.x * ACCEL * dt;
    p.vy += d.y * ACCEL * dt;

    if (!d.x && !d.y) {
      const f = Math.exp(-FRICTION * dt);
      p.vx *= f;
      p.vy *= f;
    }

    const sp = Math.hypot(p.vx, p.vy);
    if (sp > MAX_SPEED) {
      const k = MAX_SPEED / sp;
      p.vx *= k;
      p.vy *= k;
    }
  }

  p.x += p.vx * dt;
  p.y += p.vy * dt;

  const half = PLAYER_SIZE / 2;
  if (p.x < half) { p.x = half; p.vx = 0; }
  if (p.x > W - half) { p.x = W - half; p.vx = 0; }
  if (p.y < half) { p.y = half; p.vy = 0; }
  if (p.y > H - half) { p.y = H - half; p.vy = 0; }

  state.trailTimer -= dt;
  if (state.trailTimer <= 0) {
    state.trailTimer = TRAIL_STEP;
    state.trail.push({ x: p.x, y: p.y });
    if (state.trail.length > TRAIL_MAX) state.trail.shift();
  }
}

function updateDebris(dt) {
  for (let i = state.debris.length - 1; i >= 0; i--) {
    const d = state.debris[i];
    d.x += d.vx * dt;
    d.y += d.vy * dt;

    const f = Math.exp(-1.6 * dt);
    d.vx *= f;
    d.vy *= f;

    d.rotation += d.spin * dt;
    d.life -= dt;
    if (d.life <= 0) state.debris.splice(i, 1);
  }
}

function update(dt) {
  if (state.paused) return;

  for (const s of stars) {
    s.y += s.speed * dt;
    if (s.y > H) {
      s.y = -2;
      s.x = Math.random() * W;
    }
  }

  // Debris and shake keep running past the game over so the death lands.
  updateDebris(dt);
  if (state.shake > 0) state.shake = Math.max(0, state.shake - SHAKE_DECAY * dt);
  if (state.flash > 0) state.flash -= dt;
  if (state.levelFlash > 0) state.levelFlash -= dt;
  if (state.pickupFlash > 0) state.pickupFlash -= dt;

  if (!started || state.gameOver) return;

  state.elapsed += dt;
  state.score += dt * 10;

  if (state.invuln > 0) state.invuln = Math.max(0, state.invuln - dt);

  if (state.slowTime > 0) {
    state.slowTime = Math.max(0, state.slowTime - dt);
    if (state.slowTime === 0) GameAudio.setSlow(false);
  }

  // The world runs on wdt and the player never does. That asymmetry is the
  // whole value of the slow-mo pickup: you keep your speed, nothing else does.
  const wdt = state.slowTime > 0 ? dt * SLOW_FACTOR : dt;

  // Levels advance on real time, so slow-mo buys room without stalling the
  // difficulty curve or the four-minute cap.
  const level = Math.min(Math.floor(state.elapsed / STEP_TIME), MAX_LEVEL);
  if (level !== state.level) {
    state.level = level;
    state.levelFlash = 2;
    addShake(5);
    GameAudio.setLevel(level);
    GameAudio.levelUp();
  }

  if (state.dashCd > 0) state.dashCd = Math.max(0, state.dashCd - dt);

  updatePlayer(dt);
  const p = state.player;
  const d = difficulty();

  state.spawnTimer -= wdt;
  if (state.spawnTimer <= 0) {
    spawnObstacle();
    state.spawnTimer = lerp(SPAWN_START, SPAWN_MIN, d);
  }

  state.zapTimer -= wdt;
  if (state.zapTimer <= 0) {
    spawnZapper();
    state.zapTimer = lerp(ZAP_GAP_START, ZAP_GAP_MIN, d);
  }

  state.powerTimer -= wdt;
  if (state.powerTimer <= 0) {
    spawnPowerup();
    state.powerTimer = POWERUP_GAP_MIN + Math.random() * POWERUP_GAP_RANGE;
  }

  for (let i = state.obstacles.length - 1; i >= 0; i--) {
    const o = state.obstacles[i];

    if (o.seeker && o.track > 0) {
      // Steer toward the player for a while, then give up and fly on. A
      // seeker that chased forever would be impossible to shake.
      o.track -= wdt;
      const dx = p.x - o.x;
      const dy = p.y - o.y;
      const len = Math.hypot(dx, dy) || 1;

      o.vx += (dx / len) * SEEKER_ACCEL * wdt;
      o.vy += (dy / len) * SEEKER_ACCEL * wdt;

      const sp = Math.hypot(o.vx, o.vy);
      if (sp > SEEKER_MAX) {
        const k = SEEKER_MAX / sp;
        o.vx *= k;
        o.vy *= k;
      }
    }

    if (o.seeker) o.rotation = Math.atan2(o.vy, o.vx) + Math.PI / 2;
    else o.rotation += o.spin * wdt;

    o.x += o.vx * wdt;
    o.y += o.vy * wdt;

    if (o.fuse > 0) {
      o.fuse -= wdt;
      if (o.fuse <= 0) {
        explode(o);
        state.obstacles.splice(i, 1);
        continue;
      }
    }

    if (o.y - o.radius > H || o.x + o.radius < 0 || o.x - o.radius > W) {
      state.obstacles.splice(i, 1);
      continue;
    }

    if (hits(o.x, o.y, o.radius, p)) hit();
  }

  for (let i = state.fragments.length - 1; i >= 0; i--) {
    const f = state.fragments[i];
    f.x += f.vx * wdt;
    f.y += f.vy * wdt;
    f.rotation += f.spin * wdt;
    f.life -= wdt;

    if (f.life <= 0 || f.y - f.radius > H || f.x + f.radius < 0 || f.x - f.radius > W) {
      state.fragments.splice(i, 1);
      continue;
    }

    if (hits(f.x, f.y, f.radius, p)) hit();
  }

  for (let i = state.powerups.length - 1; i >= 0; i--) {
    const pu = state.powerups[i];
    pu.phase += wdt * 3;
    pu.x += pu.vx * wdt;
    pu.y += pu.vy * wdt;

    // Bounce off the sides so a drifting pickup stays reachable.
    if (pu.x < POWERUP_RADIUS) { pu.x = POWERUP_RADIUS; pu.vx *= -1; }
    if (pu.x > W - POWERUP_RADIUS) { pu.x = W - POWERUP_RADIUS; pu.vx *= -1; }

    if (pu.y - POWERUP_RADIUS > H) {
      state.powerups.splice(i, 1);
      continue;
    }

    if (hits(pu.x, pu.y, PICKUP_REACH, p)) {
      collect(pu);
      state.powerups.splice(i, 1);
    }
  }

  for (let i = state.zappers.length - 1; i >= 0; i--) {
    const z = state.zappers[i];
    z.timer -= wdt;

    if (!z.firing) {
      if (z.timer <= 0) {
        z.firing = true;
        z.timer = ZAP_FIRE;
        addShake(6);
        GameAudio.zap();
      }
      continue;
    }

    if (zapHits(z, p)) hit();
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

// A dart pointing along -y, rotated into place by the caller.
function seekerPath(r) {
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.85, r * 0.7);
  ctx.lineTo(0, r * 0.28);
  ctx.lineTo(-r * 0.85, r * 0.7);
  ctx.closePath();
}

function drawCracks(o, amount) {
  ctx.shadowBlur = 0;

  // A hot core swelling from the middle sells "about to go off".
  ctx.fillStyle = "rgba(255, 210, 120, " + (0.15 + 0.5 * amount) + ")";
  ctx.beginPath();
  ctx.arc(0, 0, o.radius * 0.25 * amount + 1, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 245, 200, " + (0.25 + 0.7 * amount) + ")";
  ctx.lineWidth = 1 + amount * 1.5;
  ctx.beginPath();
  for (const c of o.cracks) {
    ctx.moveTo(c.x1 * amount, c.y1 * amount);
    ctx.lineTo(c.x2 * amount, c.y2 * amount);
  }
  ctx.stroke();
}

function drawObstacle(o) {
  let sx = 0;
  let sy = 0;
  let crack = 0;

  if (o.fuse > 0 && o.fuse < CRACK_TIME) {
    crack = 1 - o.fuse / CRACK_TIME;
    const shake = crack * 3.2;
    sx = (Math.random() - 0.5) * shake * 2;
    sy = (Math.random() - 0.5) * shake * 2;
  }

  ctx.save();
  ctx.translate(o.x + sx, o.y + sy);
  ctx.rotate(o.rotation);

  ctx.shadowColor = o.color;
  ctx.shadowBlur = o.seeker ? 20 : 14;
  ctx.strokeStyle = o.color;
  ctx.lineWidth = 2.5;
  ctx.fillStyle = o.color + (o.seeker ? "55" : "33");

  if (o.seeker) seekerPath(o.radius);
  else if (o.sides === 0) {
    ctx.beginPath();
    ctx.arc(0, 0, o.radius, 0, Math.PI * 2);
  } else polygonPath(o.sides, o.radius);

  ctx.fill();
  ctx.stroke();

  if (crack > 0) drawCracks(o, crack);
  ctx.restore();
}

function drawFragment(f) {
  const fade = Math.min(f.life / 0.5, 1);

  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(f.x, f.y);
  ctx.rotate(f.rotation);

  ctx.shadowColor = f.color;
  ctx.shadowBlur = 10;
  ctx.strokeStyle = f.color;
  ctx.lineWidth = 2;
  ctx.fillStyle = f.color + "44";

  polygonPath(3, f.radius);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawZapper(z) {
  ctx.save();

  const ex = z.x0 + z.dx * z.len;
  const ey = z.y0 + z.dy * z.len;

  if (!z.firing) {
    // Telegraph: a dashed line pulsing faster as the shot approaches.
    const urgency = 1 - z.timer / ZAP_WARN;
    const pulse = 0.35 + 0.45 * Math.abs(Math.sin(urgency * 18));

    ctx.strokeStyle = "rgba(255, 70, 90, " + pulse + ")";
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 10]);
    ctx.shadowColor = "#ff2d55";
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.moveTo(z.x0, z.y0);
    ctx.lineTo(ex, ey);
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
    ctx.moveTo(z.x0, z.y0);
    ctx.lineTo(z.x0 + z.dx * z.len * reach, z.y0 + z.dy * z.len * reach);
    ctx.stroke();
  };

  // A wide red glow with a hot white core reads as a beam, not a stripe.
  beam(ZAP_THICKNESS, "rgba(255, 45, 85, " + fade + ")");
  beam(ZAP_THICKNESS * 0.35, "rgba(255, 240, 245, " + fade + ")");

  ctx.restore();
}

function drawTrail() {
  const n = state.trail.length;
  ctx.save();
  ctx.shadowColor = "#42e8ff";
  ctx.shadowBlur = 8;

  for (let i = 0; i < n; i++) {
    const t = (i + 1) / n; // 0 = oldest, 1 = most recent
    const size = PLAYER_SIZE * (0.35 + 0.55 * t);
    const g = state.trail[i];
    ctx.fillStyle = "rgba(90, 180, 255, " + (0.04 + 0.2 * t) + ")";
    ctx.fillRect(g.x - size / 2, g.y - size / 2, size, size);
  }
  ctx.restore();
}


function drawPlayer(p) {
  // Blink through the invulnerability window so the state is unmistakable.
  if (state.invuln > 0 && Math.floor(state.invuln * 12) % 2 === 0) return;

  const half = PLAYER_SIZE / 2;

  ctx.save();
  ctx.shadowColor = "#42e8ff";
  ctx.shadowBlur = p.dashTime > 0 ? 34 : 18;

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

function plusAt(size, fill) {
  const t = size * 0.34;
  ctx.fillStyle = fill;
  ctx.fillRect(-t / 2, -size / 2, t, size);
  ctx.fillRect(-size / 2, -t / 2, size, t);
}

// Two triangles meeting at the waist. Reads as "time" at 30px in a way a
// clock face does not.
function hourglassPath(r) {
  const w = r * 0.78;
  ctx.beginPath();
  ctx.moveTo(-w, -r);
  ctx.lineTo(w, -r);
  ctx.lineTo(0, 0);
  ctx.lineTo(w, r);
  ctx.lineTo(-w, r);
  ctx.lineTo(0, 0);
  ctx.closePath();
}

function drawPowerup(pu) {
  const health = pu.kind === "health";
  const color = health ? HEALTH_COLOR : SLOW_COLOR;

  ctx.save();
  ctx.translate(pu.x, pu.y + Math.sin(pu.phase) * 3);
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;

  // A sweeping arc marks both kinds as something to catch rather than dodge.
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(0, 0, POWERUP_RADIUS + 6, pu.phase, pu.phase + Math.PI * 1.35);
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (health) {
    plusAt(POWERUP_RADIUS * 1.5, color);
  } else {
    hourglassPath(POWERUP_RADIUS * 0.9);
    ctx.fillStyle = color + "55";
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function drawDebris() {
  ctx.save();
  for (const d of state.debris) {
    const a = Math.min(d.life / 0.6, 1);
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.rotation);
    ctx.fillStyle = "rgba(" + d.color + ", " + a + ")";
    ctx.fillRect(-d.size / 2, -d.size / 2, d.size, d.size);
    ctx.restore();
  }
  ctx.restore();
}

function drawMeter(label, y, fill, color, glow) {
  const x = 16;
  const bx = x + 62;
  const w = 104;
  const h = 9;

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "10px " + FONT;
  ctx.fillStyle = color;
  ctx.fillText(label, x, y);

  ctx.fillStyle = "rgba(255, 255, 255, 0.09)";
  ctx.fillRect(bx, y, w, h);

  ctx.fillStyle = glow;
  if (glow === color) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
  }
  ctx.fillRect(bx, y, w * fill, h);
  ctx.shadowBlur = 0;

  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, y + 0.5, w, h);
}

function drawHud() {
  ctx.save();
  ctx.textBaseline = "top";

  ctx.textAlign = "left";
  ctx.fillStyle = "#c9d4ea";
  ctx.font = "14px " + FONT;
  ctx.fillText("SCORE " + String(Math.floor(state.score)).padStart(5, "0"), 16, 16);

  ctx.fillStyle = "#6b7796";
  ctx.font = "10px " + FONT;
  ctx.fillText("BEST  " + String(best).padStart(5, "0"), 16, 42);

  ctx.textAlign = "right";
  ctx.fillStyle = state.level >= MAX_LEVEL ? "#ffd23f" : "#8fa3c8";
  ctx.font = "14px " + FONT;
  ctx.fillText("LEVEL " + String(state.level).padStart(2, "0"), W - 16, 16);

  if (GameAudio.isMuted()) {
    ctx.fillStyle = "#6b7796";
    ctx.font = "10px " + FONT;
    ctx.fillText("MUTED", W - 16, 66);
  }

  // Lives, drawn right to left so the one you lose is the leftmost.
  for (let i = 0; i < MAX_HEALTH; i++) {
    const lit = i < state.health;
    ctx.save();
    ctx.translate(W - 24 - i * 26, 48);
    ctx.shadowColor = HEALTH_COLOR;
    ctx.shadowBlur = lit ? 10 : 0;
    plusAt(16, lit ? HEALTH_COLOR : "rgba(255, 255, 255, 0.13)");
    ctx.restore();
  }

  const ready = state.dashCd <= 0;
  if (ready) {
    // A slow pulse is what makes "ready again" catch the eye mid-game.
    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 180);
    drawMeter("DASH", 66, 1, "#7af8ff", "rgba(122, 248, 255, " + pulse + ")");
  } else {
    drawMeter("DASH", 66, 1 - state.dashCd / DASH_COOLDOWN, "#5a6480", "#3f7fbf");
  }

  if (state.slowTime > 0) {
    drawMeter("SLOW", 86, state.slowTime / SLOW_TIME, SLOW_COLOR, SLOW_COLOR);
  }

  ctx.restore();
}

function drawOverlay(title, tint, subtitle, hint) {
  ctx.fillStyle = "rgba(8, 10, 22, 0.72)";
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.shadowColor = tint;
  ctx.shadowBlur = 24;
  ctx.fillStyle = tint;
  ctx.font = "44px " + FONT;
  ctx.fillText(title, W / 2, H / 2 - 40);
  ctx.shadowBlur = 0;

  if (subtitle) {
    ctx.fillStyle = "#e8edf7";
    ctx.font = "18px " + FONT;
    ctx.fillText(subtitle, W / 2, H / 2 + 28);
  }

  ctx.fillStyle = "#8fa3c8";
  ctx.font = "11px " + FONT;
  ctx.fillText(hint, W / 2, H / 2 + 72);
}

function draw() {
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  // The whole world shakes; the HUD and overlays below stay put so text
  // never becomes hard to read at the worst moment.
  if (state.shake > 0) {
    ctx.translate(
      (Math.random() - 0.5) * state.shake,
      (Math.random() - 0.5) * state.shake
    );
  }

  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  for (const s of stars) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }

  if (started) {
    drawTrail();
    for (const f of state.fragments) drawFragment(f);
    for (const pu of state.powerups) drawPowerup(pu);
    for (const o of state.obstacles) drawObstacle(o);
    for (const z of state.zappers) drawZapper(z);
    if (!state.gameOver) drawPlayer(state.player);
  }

  drawDebris();
  ctx.restore();

  if (state.slowTime > 0) {
    // Violet closing in from the edges, so the effect is legible even when
    // the middle of the screen is busy.
    const a = Math.min(state.slowTime / 0.6, 1) * 0.4;
    const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.22, W / 2, H / 2, H * 0.8);
    vignette.addColorStop(0, "rgba(184, 146, 255, 0)");
    vignette.addColorStop(1, "rgba(184, 146, 255, " + a + ")");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  if (!started) {
    drawOverlay("DODGE", "#7af8ff", null, "PRESS ANY KEY TO START");
    ctx.textAlign = "center";
    ctx.fillStyle = "#5a6480";
    ctx.font = "9px " + FONT;
    ctx.fillText("WASD / ARROWS  \u00B7  SHIFT DASH  \u00B7  ESC PAUSE", W / 2, H / 2 + 112);
    return;
  }

  drawHud();

  if (state.levelFlash > 0) {
    const a = Math.min(state.levelFlash / 2, 1);

    // A brief wash over the whole screen at the moment of the step up.
    if (state.levelFlash > 1.75) {
      ctx.fillStyle = "rgba(255, 210, 63, " + (state.levelFlash - 1.75) * 0.6 + ")";
      ctx.fillRect(0, 0, W, H);
    }

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "24px " + FONT;
    ctx.shadowColor = "#ffd23f";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "rgba(255, 210, 63, " + a + ")";
    ctx.fillText("LEVEL " + state.level, W / 2, 110);
    ctx.font = "10px " + FONT;
    ctx.fillStyle = "rgba(255, 210, 63, " + a * 0.8 + ")";
    ctx.fillText(state.level >= MAX_LEVEL ? "MAX SPEED" : "SPEED UP", W / 2, 140);
    ctx.restore();
  }

  if (state.pickupFlash > 0) {
    const health = state.pickupKind === "health";
    const a = Math.min(state.pickupFlash / 1.4, 1);
    const rgb = health ? "52, 232, 138" : "184, 146, 255";


    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "14px " + FONT;
    ctx.shadowColor = health ? HEALTH_COLOR : SLOW_COLOR;
    ctx.shadowBlur = 16;
    ctx.fillStyle = "rgba(" + rgb + ", " + a + ")";
    ctx.fillText(state.pickupLabel, W / 2, 178);
    ctx.restore();
  }

  if (state.flash > 0) {
    ctx.fillStyle = "rgba(255, 60, 90, " + (state.flash / 0.4) * 0.35 + ")";
    ctx.fillRect(0, 0, W, H);
  }

  if (state.gameOver) {
    drawOverlay(
      "GAME OVER",
      "#ff4d6d",
      (state.newBest ? "NEW BEST " : "SCORE ") + Math.floor(state.score),
      "PRESS R TO RESTART"
    );
  } else if (state.paused) {
    drawOverlay("PAUSED", "#7af8ff", null, "PRESS ESC TO RESUME");
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

// Canvas silently falls back if the arcade face isn't ready, so nudge it to
// load before the first frame.
if (document.fonts && document.fonts.load) {
  document.fonts.load('16px "Press Start 2P"').catch(() => {});
}

requestAnimationFrame(loop);
