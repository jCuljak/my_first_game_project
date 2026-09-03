const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// Which keys are held right now. Updated by the listeners below.
const keys = new Set();

window.addEventListener("keydown", (e) => {
  keys.add(e.key.toLowerCase());
  // Stop the arrow keys from scrolling the page while playing.
  if (e.key.startsWith("Arrow")) e.preventDefault();
});

window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

const player = {
  x: canvas.width / 2,
  y: canvas.height / 2,
  size: 32,
  speed: 260, // pixels per second
};

function update(dt) {
  let dx = 0;
  let dy = 0;

  if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
  if (keys.has("arrowright") || keys.has("d")) dx += 1;
  if (keys.has("arrowup") || keys.has("w")) dy -= 1;
  if (keys.has("arrowdown") || keys.has("s")) dy += 1;

  // Normalise so moving diagonally isn't faster than moving straight.
  if (dx !== 0 && dy !== 0) {
    const inv = 1 / Math.sqrt(2);
    dx *= inv;
    dy *= inv;
  }

  player.x += dx * player.speed * dt;
  player.y += dy * player.speed * dt;

  const half = player.size / 2;
  player.x = Math.max(half, Math.min(canvas.width - half, player.x));
  player.y = Math.max(half, Math.min(canvas.height - half, player.y));
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#5b8cff";
  ctx.fillRect(
    player.x - player.size / 2,
    player.y - player.size / 2,
    player.size,
    player.size
  );
}

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
