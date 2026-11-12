// ============================================================
//  Chomp Maze — a maze-chase game
//  Every character is drawn with canvas shapes (no image files)
//  and every sound is generated with the Web Audio API.
// ============================================================

// ---------- Board ----------
const rowCount = 21;
const columnCount = 19;
const tileSize = 32;
const boardWidth = columnCount * tileSize;   // 608
const boardHeight = rowCount * tileSize;     // 672
const STEP = tileSize / 4;                   // distance moved per tick (8 px)

// ---------- Settings (easy to change) ----------
const START_LIVES = 3;
const SCARED_TICKS = 200;      // 10 seconds at 20 ticks per second
const READY_TICKS = 30;        // short pause before the action starts
const BASE_TICK_MS = 50;       // 20 ticks per second on level 1
const TICK_MS_PER_LEVEL = 4;   // each level is a little faster

// X = wall, O = outside (no food), ' ' = dot, W = power pellet, C = fruit
// P = player. Bots: r = red, p = violet, b = teal, o = green
const levels = [
    [
        "XXXXXXXXXXXXXXXXXXX",
        "X        X        X",
        "X XX XXX XXX X XX X",
        "X                 X",
        "X XX X XXXXX X XX X",
        "X    X       X    X",
        "XXXX XXXX XXXX XXXX",
        "OOOX X       X XOOO",
        "XXXX X XXrXX X XXXX",
        "O       bpo       O",
        "XXXX X XXXXX X XXXX",
        "OOOX X       X XOOO",
        "XXXX X XXXXX X XXXX",
        "X        X        X",
        "X XX XXX X XXX XX X",
        "X X      P      X X",
        "XX X X XXXXX X X XX",
        "X    X   X   X    X",
        "X XXXXXX X XXXXXX X",
        "X                 X",
        "XXXXXXXXXXXXXXXXXXX"
    ],
    [
        "XXXXXXXXXXXXXXXXXXX",
        "X                 X",
        "X XX XXX XXX X XX X",
        "X  W   X   X   W  X",
        "X XX X XXXXX X XX X",
        "X    X       X    X",
        "XXXX XXXX XXXX XXXX",
        "OOOX X       X XOOO",
        "XXXX X XXrXX X XXXX",
        "O       bpo       O",
        "XXXX X XXXXX X XXXX",
        "OOOX X       X XOOO",
        "XXXX X XXXXX X XXXX",
        "X        X        X",
        "X XX XXX X XXX XX X",
        "X X      P      X X",
        "XX X X XXXXX X X XX",
        "X    X   X   X    X",
        "X XXXXXX X XXXXXX X",
        "X  C              X",
        "XXXXXXXXXXXXXXXXXXX"
    ],
    [
        "XXXXXXXXXXXXXXXXXXX",
        "X        X        X",
        "X XX XXX XXX X XX X",
        "X  W              X",
        "X XX X XXXXX X XX X",
        "X    X       X    X",
        "XXXX XXXX XXXX XXXX",
        "OOOX X       X XOOO",
        "XXXX X XXrXX X XXXX",
        "O       bpo       O",
        "XXXX X XXXXX X XXXX",
        "OOOX X       X XOOO",
        "XXXX X XXXXX X XXXX",
        "X        X        X",
        "X XX XXX X XXX XX X",
        "X X      P      X X",
        "XX X X XXXXX X X XX",
        "X    X   X   X    X",
        "X XXXXXX X XXXXXX X",
        "X           C     X",
        "XXXXXXXXXXXXXXXXXXX"
    ]
];

// Wall colors for each level: [fill, outline]
const palettes = [
    ["#0b1250", "#4361ee"],
    ["#2a0d4d", "#a66cff"],
    ["#0b3a3a", "#2ec4b6"]
];

// ---------- Directions ----------
const DIRS = {
    U: { dx: 0, dy: -1 },
    D: { dx: 0, dy: 1 },
    L: { dx: -1, dy: 0 },
    R: { dx: 1, dy: 0 }
};
const OPPOSITE = { U: "D", D: "U", L: "R", R: "L" };

// ---------- Game state ----------
let board, context, wallLayer;
let grid = [];            // grid[r][c] = true for a wall
let items = [];           // items[r][c]: 0 nothing, 1 dot, 2 power pellet, 3 fruit
let itemsLeft = 0;        // dots + power pellets still to eat
let player;
let bots = [];

let state = "start";      // start, ready, playing, paused, gameover, win
let pausedFrom = "playing";
let score = 0;
let highScore = loadHighScore();
let lives = START_LIVES;
let levelIndex = 0;
let scaredTicks = 0;
let ghostCombo = 200;
let readyTicks = 0;
let tickCount = 0;
let inputLockUntil = 0;

let lastTime = 0;
let accumulator = 0;

// ============================================================
//  Characters
// ============================================================
class Entity {
    constructor(x, y) {
        this.startX = x;
        this.startY = y;
        this.x = x;
        this.y = y;
        this.prevX = x;
        this.prevY = y;
        this.dir = null;
    }

    reset() {
        this.x = this.startX;
        this.y = this.startY;
        this.prevX = this.x;
        this.prevY = this.y;
        this.dir = null;
    }

    savePrevious() {
        this.prevX = this.x;
        this.prevY = this.y;
    }

    // Position between the previous tick and the current one (smooth animation)
    renderPosition(alpha) {
        const dx = this.x - this.prevX;
        const dy = this.y - this.prevY;
        if (Math.abs(dx) > tileSize * 2 || Math.abs(dy) > tileSize * 2) {
            return { x: this.x, y: this.y };   // tunnel jump: no interpolation
        }
        return { x: this.prevX + dx * alpha, y: this.prevY + dy * alpha };
    }
}

class Player extends Entity {
    constructor(x, y) {
        super(x, y);
        this.facing = "R";
        this.nextDir = null;
        this.nextDirTicks = 0;
        this.moving = false;
    }

    reset() {
        super.reset();
        this.facing = "R";
        this.nextDir = null;
        this.nextDirTicks = 0;
        this.moving = false;
    }
}

class Bot extends Entity {
    constructor(x, y, config) {
        super(x, y);
        this.color = config.color;
        this.chase = config.chase;     // chance to chase the player at a crossing
        this.ahead = config.ahead;     // aims this many tiles ahead of the player
        this.shy = config.shy;         // stops chasing when close to the player
        this.startDelay = config.delay;
        this.delayTicks = config.delay;
        this.scared = false;
    }

    reset() {
        super.reset();
        this.delayTicks = this.startDelay;
        this.scared = false;
    }
}

const botConfigs = {
    r: { color: "#ff4d6d", chase: 0.85, ahead: 0, shy: false, delay: 0 },
    p: { color: "#a66cff", chase: 0.7, ahead: 3, shy: false, delay: 20 },
    b: { color: "#2ec4b6", chase: 0.45, ahead: 0, shy: false, delay: 40 },
    o: { color: "#8ac926", chase: 0.8, ahead: 0, shy: true, delay: 60 }
};

// ============================================================
//  Start
// ============================================================
window.addEventListener("DOMContentLoaded", () => {
    board = document.getElementById("board");
    board.width = boardWidth;
    board.height = boardHeight;
    context = board.getContext("2d");

    loadLevel(0);
    setupControls();
    updateHUD();

    lastTime = performance.now();
    requestAnimationFrame(frame);   // the one and only game loop
});

function loadLevel(index) {
    const map = levels[index];
    grid = [];
    items = [];
    bots = [];
    itemsLeft = 0;

    for (let r = 0; r < rowCount; r++) {
        grid[r] = [];
        items[r] = [];
        for (let c = 0; c < columnCount; c++) {
            const ch = map[r][c];
            const x = c * tileSize;
            const y = r * tileSize;

            grid[r][c] = ch === "X";
            items[r][c] = 0;

            if (ch === " ") { items[r][c] = 1; itemsLeft++; }
            else if (ch === "W") { items[r][c] = 2; itemsLeft++; }
            else if (ch === "C") { items[r][c] = 3; }
            else if (ch === "P") { player = new Player(x, y); }
            else if (botConfigs[ch]) { bots.push(new Bot(x, y, botConfigs[ch])); }
        }
    }
    buildWallLayer();
}

// The walls never change during a level, so they are drawn once
function buildWallLayer() {
    wallLayer = document.createElement("canvas");
    wallLayer.width = boardWidth;
    wallLayer.height = boardHeight;
    const g = wallLayer.getContext("2d");
    const [fill, outline] = palettes[levelIndex % palettes.length];

    const wallAt = (r, c) => r < 0 || r >= rowCount || c < 0 || c >= columnCount || grid[r][c];

    g.lineWidth = 4;
    g.lineCap = "round";
    for (let r = 0; r < rowCount; r++) {
        for (let c = 0; c < columnCount; c++) {
            if (!grid[r][c]) continue;
            const x = c * tileSize;
            const y = r * tileSize;
            g.fillStyle = fill;
            g.fillRect(x, y, tileSize, tileSize);
            g.strokeStyle = outline;
            g.beginPath();
            if (!wallAt(r - 1, c)) { g.moveTo(x, y + 2); g.lineTo(x + tileSize, y + 2); }
            if (!wallAt(r + 1, c)) { g.moveTo(x, y + tileSize - 2); g.lineTo(x + tileSize, y + tileSize - 2); }
            if (!wallAt(r, c - 1)) { g.moveTo(x + 2, y); g.lineTo(x + 2, y + tileSize); }
            if (!wallAt(r, c + 1)) { g.moveTo(x + tileSize - 2, y); g.lineTo(x + tileSize - 2, y + tileSize); }
            g.stroke();
        }
    }
}

function resetPositions() {
    player.reset();
    bots.forEach((bot) => bot.reset());
    scaredTicks = 0;
    ghostCombo = 200;
}

function startGame() {
    ensureAudio();
    score = 0;
    lives = START_LIVES;
    levelIndex = 0;
    loadLevel(0);
    resetPositions();
    state = "ready";
    readyTicks = READY_TICKS;
    accumulator = 0;
    updateHUD();
    playSound("start");
}

// ============================================================
//  Game loop: fixed ticks, smooth drawing
// ============================================================
function currentTickMs() {
    return BASE_TICK_MS - levelIndex * TICK_MS_PER_LEVEL;
}

function frame(time) {
    requestAnimationFrame(frame);

    const delta = Math.min(time - lastTime, 250);   // ignore long pauses (hidden tab)
    lastTime = time;

    const tickMs = currentTickMs();
    if (state === "ready" || state === "playing") {
        accumulator += delta;
        while (accumulator >= tickMs && (state === "ready" || state === "playing")) {
            tick();
            accumulator -= tickMs;
        }
    } else {
        accumulator = 0;
    }

    draw(Math.min(accumulator / tickMs, 1));
}

function tick() {
    tickCount++;
    player.savePrevious();
    bots.forEach((bot) => bot.savePrevious());

    if (state === "ready") {
        readyTicks--;
        if (readyTicks <= 0) state = "playing";
        return;
    }

    updatePlayer();
    eatItems();
    updateBots();
    checkBotCollisions();
    if (state !== "playing") return;
    updateScared();
    checkLevelComplete();
}

// ============================================================
//  Movement
// ============================================================
function isWall(r, c) {
    if (r < 0 || r >= rowCount) return true;
    if (c < 0 || c >= columnCount) return false;   // the tunnel
    return grid[r][c];
}

function hitsWall(x, y) {
    const c1 = Math.floor(x / tileSize);
    const c2 = Math.floor((x + tileSize - 1) / tileSize);
    const r1 = Math.floor(y / tileSize);
    const r2 = Math.floor((y + tileSize - 1) / tileSize);
    for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
            if (isWall(r, c)) return true;
        }
    }
    return false;
}

function canMove(entity, dir) {
    const d = DIRS[dir];
    // No vertical moves while outside the board (inside the tunnel)
    if (d.dy !== 0 && (entity.x < 0 || entity.x > boardWidth - tileSize)) return false;
    return !hitsWall(entity.x + d.dx * STEP, entity.y + d.dy * STEP);
}

function moveEntity(entity, dir) {
    const d = DIRS[dir];
    entity.x += d.dx * STEP;
    entity.y += d.dy * STEP;

    // Tunnel: leave on one side, come back on the other
    if (entity.x <= -tileSize) entity.x = boardWidth;
    else if (entity.x >= boardWidth) entity.x = -tileSize;
}

function updatePlayer() {
    // A turn requested too early is remembered for a short time
    if (player.nextDir) {
        if (canMove(player, player.nextDir)) {
            player.dir = player.nextDir;
            player.facing = player.dir;
            player.nextDir = null;
        } else if (--player.nextDirTicks <= 0) {
            player.nextDir = null;
        }
    }

    if (player.dir && canMove(player, player.dir)) {
        moveEntity(player, player.dir);
        player.moving = true;
    } else {
        player.moving = false;
    }
}

function botTarget() {
    const c = Math.round(player.x / tileSize);
    const r = Math.round(player.y / tileSize);
    return { c, r };
}

function chooseDirection(bot) {
    const back = OPPOSITE[bot.dir];
    let options = Object.keys(DIRS).filter((d) => d !== back && canMove(bot, d));
    if (options.length === 0 && back && canMove(bot, back)) options = [back];
    if (options.length === 0) return null;
    if (options.length === 1) return options[0];

    const target = botTarget();
    const ahead = DIRS[player.facing];
    target.c += ahead.dx * bot.ahead;
    target.r += ahead.dy * bot.ahead;

    const bc = Math.round(bot.x / tileSize);
    const br = Math.round(bot.y / tileSize);
    const distance = (d) => Math.abs(bc + DIRS[d].dx - target.c) + Math.abs(br + DIRS[d].dy - target.r);

    let mode = "random";
    if (bot.scared) {
        if (Math.random() < 0.6) mode = "flee";
    } else {
        const p = botTarget();
        const close = Math.abs(bc - p.c) + Math.abs(br - p.r) <= 6;
        if (Math.random() < bot.chase && !(bot.shy && close)) mode = "chase";
    }

    if (mode === "chase") return options.reduce((best, d) => (distance(d) < distance(best) ? d : best));
    if (mode === "flee") return options.reduce((best, d) => (distance(d) > distance(best) ? d : best));
    return options[Math.floor(Math.random() * options.length)];
}

function updateBots() {
    for (const bot of bots) {
        if (bot.delayTicks > 0) {
            bot.delayTicks--;
            continue;
        }
        // Scared bots move at half speed
        if (bot.scared && tickCount % 2 === 0) continue;

        const aligned = bot.x % tileSize === 0 && bot.y % tileSize === 0;
        if (!bot.dir || aligned) bot.dir = chooseDirection(bot);

        if (bot.dir && canMove(bot, bot.dir)) moveEntity(bot, bot.dir);
        else bot.dir = chooseDirection(bot);
    }
}

// ============================================================
//  Rules
// ============================================================
function addScore(points) {
    score += points;
    if (score > highScore) highScore = score;
    updateHUD();
}

function eatItems() {
    const c = Math.floor((player.x + tileSize / 2) / tileSize);
    const r = Math.floor((player.y + tileSize / 2) / tileSize);
    if (c < 0 || c >= columnCount) return;

    const item = items[r][c];
    if (item === 0) return;
    items[r][c] = 0;

    if (item === 1) {
        itemsLeft--;
        addScore(10);
        playSound("dot");
    } else if (item === 2) {
        itemsLeft--;
        addScore(50);
        scaredTicks = SCARED_TICKS;
        ghostCombo = 200;
        bots.forEach((bot) => { bot.scared = true; });
        playSound("power");
    } else if (item === 3) {
        addScore(100);
        playSound("fruit");
    }
}

function checkBotCollisions() {
    for (const bot of bots) {
        const distance = Math.hypot(bot.x - player.x, bot.y - player.y);
        if (distance >= tileSize * 0.7) continue;

        if (bot.scared) {
            addScore(ghostCombo);
            ghostCombo = Math.min(ghostCombo * 2, 1600);
            bot.reset();
            bot.delayTicks = 40;
            playSound("eatBot");
        } else {
            loseLife();
            return;
        }
    }
}

function loseLife() {
    lives--;
    playSound("die");
    updateHUD();

    if (lives <= 0) {
        endGame("gameover");
    } else {
        resetPositions();
        state = "ready";
        readyTicks = READY_TICKS;
    }
}

function updateScared() {
    if (scaredTicks > 0) {
        scaredTicks--;
        if (scaredTicks === 0) bots.forEach((bot) => { bot.scared = false; });
    }
}

function checkLevelComplete() {
    if (itemsLeft > 0) return;

    levelIndex++;
    if (levelIndex >= levels.length) {
        levelIndex = levels.length - 1;
        endGame("win");
        return;
    }
    loadLevel(levelIndex);
    resetPositions();
    state = "ready";
    readyTicks = READY_TICKS + 10;
    updateHUD();
    playSound("level");
}

function endGame(result) {
    state = result;
    saveHighScore();
    inputLockUntil = performance.now() + 900;   // avoids an accidental restart
    if (result === "win") playSound("level");
    updateHUD();
    syncButtons();
}

// ============================================================
//  Controls: keyboard, swipe and on-screen arrows
// ============================================================
const KEY_DIRS = {
    ArrowUp: "U", KeyW: "U",
    ArrowDown: "D", KeyS: "D",
    ArrowLeft: "L", KeyA: "L",
    ArrowRight: "R", KeyD: "R"
};

function setupControls() {
    document.addEventListener("keydown", (e) => {
        if (KEY_DIRS[e.code]) {
            e.preventDefault();
            handleDirection(KEY_DIRS[e.code]);
        } else if (e.code === "Space" || e.code === "Enter") {
            e.preventDefault();
            handleAction();
        } else if (e.code === "KeyP" || e.code === "Escape") {
            togglePause();
        } else if (e.code === "KeyM") {
            toggleSound();
        }
    });

    // Swipe (or tap) on the board
    let swipe = null;
    board.addEventListener("pointerdown", (e) => {
        swipe = { x: e.clientX, y: e.clientY, moved: false };
        board.setPointerCapture(e.pointerId);
    });
    board.addEventListener("pointermove", (e) => {
        if (!swipe) return;
        const dx = e.clientX - swipe.x;
        const dy = e.clientY - swipe.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
        swipe.moved = true;
        if (Math.abs(dx) > Math.abs(dy)) handleDirection(dx > 0 ? "R" : "L");
        else handleDirection(dy > 0 ? "D" : "U");
        swipe.x = e.clientX;
        swipe.y = e.clientY;
    });
    board.addEventListener("pointerup", () => {
        if (swipe && !swipe.moved) handleAction();   // a simple tap
        swipe = null;
    });
    board.addEventListener("pointercancel", () => { swipe = null; });

    // On-screen arrows
    document.querySelectorAll("#dpad button").forEach((button) => {
        button.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            handleDirection(button.dataset.dir);
        });
    });

    document.getElementById("pauseBtn").addEventListener("click", (e) => {
        togglePause();
        e.currentTarget.blur();
    });
    document.getElementById("soundBtn").addEventListener("click", (e) => {
        toggleSound();
        e.currentTarget.blur();
    });

    // Pause automatically when the tab is hidden
    document.addEventListener("visibilitychange", () => {
        if (document.hidden && state === "playing") togglePause();
    });
    window.addEventListener("pagehide", saveHighScore);

    syncButtons();
}

function handleDirection(dir) {
    if (state === "start") {
        startGame();
    } else if (state === "paused" || state === "gameover" || state === "win") {
        return;
    }
    player.nextDir = dir;
    player.nextDirTicks = 10;   // remembered for half a second
}

function handleAction() {
    ensureAudio();
    if (state === "start") {
        startGame();
    } else if (state === "paused") {
        togglePause();
    } else if ((state === "gameover" || state === "win") && performance.now() > inputLockUntil) {
        startGame();
    }
}

function togglePause() {
    if (state === "playing" || state === "ready") {
        pausedFrom = state;
        state = "paused";
    } else if (state === "paused") {
        state = pausedFrom;
    }
    syncButtons();
}

function syncButtons() {
    document.getElementById("pauseBtn").textContent = state === "paused" ? "Resume" : "Pause";
    document.getElementById("soundBtn").textContent = soundOn ? "Sound: on" : "Sound: off";
}

// ============================================================
//  Sound (Web Audio, no files needed)
// ============================================================
let audioCtx = null;
let soundOn = loadSoundSetting();
let dotToggle = false;
let lastDotSound = 0;

function loadSoundSetting() {
    try { return localStorage.getItem("chompSound") !== "off"; } catch (e) { return true; }
}

function ensureAudio() {
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            audioCtx = null;
        }
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
}

function toggleSound() {
    soundOn = !soundOn;
    try { localStorage.setItem("chompSound", soundOn ? "on" : "off"); } catch (e) { /* ignore */ }
    syncButtons();
}

function tone(freq, duration, type = "square", volume = 0.05, slideTo = null, delay = 0) {
    const t0 = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + duration);
}

const sounds = {
    dot() {
        const now = performance.now();
        if (now - lastDotSound < 90) return;   // not too many sounds at once
        lastDotSound = now;
        dotToggle = !dotToggle;
        tone(dotToggle ? 260 : 340, 0.06, "square", 0.03);
    },
    power() { tone(200, 0.3, "sawtooth", 0.05, 800); },
    fruit() { tone(660, 0.08); tone(880, 0.12, "square", 0.05, null, 0.08); },
    eatBot() { tone(300, 0.25, "square", 0.05, 1200); },
    die() { tone(500, 0.7, "sawtooth", 0.06, 60); },
    start() { [392, 523, 659].forEach((f, i) => tone(f, 0.1, "square", 0.04, null, i * 0.1)); },
    level() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, "square", 0.04, null, i * 0.12)); }
};

function playSound(name) {
    if (!soundOn || !audioCtx) return;
    sounds[name]();
}

// ============================================================
//  High score
// ============================================================
function loadHighScore() {
    try { return Number(localStorage.getItem("chompHighScore")) || 0; } catch (e) { return 0; }
}

function saveHighScore() {
    try { localStorage.setItem("chompHighScore", highScore); } catch (e) { /* ignore */ }
}

// ============================================================
//  HUD (the text above the board)
// ============================================================
function updateHUD() {
    document.getElementById("score").textContent = String(score).padStart(6, "0");
    document.getElementById("best").textContent = String(highScore).padStart(6, "0");
    document.getElementById("level").textContent = levelIndex + 1;
    document.getElementById("lives").textContent = "♥".repeat(Math.max(lives, 0));
}

// ============================================================
//  Drawing
// ============================================================
function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}

function draw(alpha) {
    const g = context;
    const time = performance.now();

    g.fillStyle = "#05060f";
    g.fillRect(0, 0, boardWidth, boardHeight);
    g.drawImage(wallLayer, 0, 0);

    drawItems(g, time);

    for (const bot of bots) {
        const p = bot.renderPosition(alpha);
        drawBot(g, bot, p.x, p.y, time);
    }
    const p = player.renderPosition(alpha);
    drawPlayer(g, p.x, p.y, time);

    drawOverlay(g);
}

function drawItems(g, time) {
    const pulse = 6 + Math.sin(time / 150) * 1.5;
    for (let r = 0; r < rowCount; r++) {
        for (let c = 0; c < columnCount; c++) {
            const item = items[r][c];
            if (item === 0) continue;
            const cx = c * tileSize + tileSize / 2;
            const cy = r * tileSize + tileSize / 2;

            if (item === 1) {
                g.fillStyle = "#ffe8c2";
                g.beginPath();
                g.arc(cx, cy, 2.5, 0, Math.PI * 2);
                g.fill();
            } else if (item === 2) {
                g.fillStyle = "#fff3b0";
                g.beginPath();
                g.arc(cx, cy, pulse, 0, Math.PI * 2);
                g.fill();
            } else {
                drawFruit(g, cx, cy);
            }
        }
    }
}

function drawFruit(g, cx, cy) {
    g.strokeStyle = "#7cb518";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx - 5, cy + 2);
    g.quadraticCurveTo(cx - 3, cy - 8, cx + 2, cy - 10);
    g.moveTo(cx + 5, cy + 3);
    g.quadraticCurveTo(cx + 4, cy - 7, cx + 2, cy - 10);
    g.stroke();

    g.fillStyle = "#7cb518";
    g.beginPath();
    g.ellipse(cx + 6, cy - 9, 5, 2.5, -0.4, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = "#e63946";
    g.beginPath();
    g.arc(cx - 5, cy + 5, 5.5, 0, Math.PI * 2);
    g.arc(cx + 5, cy + 6, 5.5, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = "rgba(255,255,255,0.7)";
    g.beginPath();
    g.arc(cx - 7, cy + 3, 1.5, 0, Math.PI * 2);
    g.arc(cx + 3, cy + 4, 1.5, 0, Math.PI * 2);
    g.fill();
}

function drawPlayer(g, x, y, time) {
    const cx = x + tileSize / 2;
    const cy = y + tileSize / 2;
    const r = 13;
    const angles = { R: 0, D: Math.PI / 2, L: Math.PI, U: -Math.PI / 2 };
    const a = angles[player.facing];

    // The mouth opens and closes while moving
    const open = player.moving
        ? 0.06 * Math.PI + 0.3 * Math.PI * Math.abs(Math.sin(time / 90))
        : 0.08 * Math.PI;

    g.fillStyle = "#ff9f1c";
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, r, a + open, a + Math.PI * 2 - open);
    g.closePath();
    g.fill();

    // Eye, always on the upper side of the face
    let ex = Math.cos(a + Math.PI / 2);
    let ey = Math.sin(a + Math.PI / 2);
    if (ey > 0.01 || (Math.abs(ey) <= 0.01 && ex < 0)) { ex = -ex; ey = -ey; }
    g.fillStyle = "#1b1b2f";
    g.beginPath();
    g.arc(cx + ex * 5 + Math.cos(a) * 2, cy + ey * 5 + Math.sin(a) * 2, 2.2, 0, Math.PI * 2);
    g.fill();
}

function drawBot(g, bot, x, y, time) {
    const cx = x + tileSize / 2;
    const cy = y + tileSize / 2;
    const flashing = bot.scared && scaredTicks < 50 && Math.floor(scaredTicks / 5) % 2 === 0;
    const body = bot.scared ? (flashing ? "#f1f1f1" : "#2f4bff") : bot.color;

    // Antenna
    g.strokeStyle = body;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx, cy - 9);
    g.lineTo(cx, cy - 14);
    g.stroke();
    g.fillStyle = body;
    g.beginPath();
    g.arc(cx, cy - 15, 2.5, 0, Math.PI * 2);
    g.fill();

    // Body and feet (the feet move like steps)
    roundRect(g, cx - 12, cy - 10, 24, 20, 8);
    g.fill();
    const step = Math.floor(time / 150) % 2 === 0;
    g.fillRect(cx - 10 + (step ? 0 : 2), cy + 8, 6, 5);
    g.fillRect(cx + 4 - (step ? 0 : 2), cy + 8, 6, 5);

    if (bot.scared) {
        // Worried face
        g.fillStyle = flashing ? "#d00000" : "#ffffff";
        g.fillRect(cx - 6, cy - 5, 4, 4);
        g.fillRect(cx + 2, cy - 5, 4, 4);
        g.strokeStyle = g.fillStyle;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(cx - 7, cy + 4);
        g.lineTo(cx - 4, cy + 1);
        g.lineTo(cx - 1, cy + 4);
        g.lineTo(cx + 2, cy + 1);
        g.lineTo(cx + 5, cy + 4);
        g.lineTo(cx + 7, cy + 2);
        g.stroke();
    } else {
        // Eyes that look where the bot is going
        const look = DIRS[bot.dir] || { dx: 0, dy: 0 };
        for (const ex of [-5, 5]) {
            g.fillStyle = "#ffffff";
            g.beginPath();
            g.arc(cx + ex, cy - 3, 4, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = "#0a1030";
            g.beginPath();
            g.arc(cx + ex + look.dx * 1.5, cy - 3 + look.dy * 1.5, 2, 0, Math.PI * 2);
            g.fill();
        }
    }
}

function drawPanel(g, title, lines, color = "#ffd23f") {
    g.fillStyle = "rgba(5, 6, 15, 0.82)";
    roundRect(g, 54, 224, boardWidth - 108, 224, 16);
    g.fill();
    g.strokeStyle = "#4361ee";
    g.lineWidth = 3;
    g.stroke();

    g.textAlign = "center";
    g.fillStyle = color;
    g.font = "bold 40px system-ui, sans-serif";
    g.fillText(title, boardWidth / 2, 292);

    g.fillStyle = "#ffffff";
    g.font = "20px system-ui, sans-serif";
    lines.forEach((line, i) => g.fillText(line, boardWidth / 2, 338 + i * 30));
    g.textAlign = "left";
}

function drawOverlay(g) {
    if (state === "start") {
        drawPanel(g, "CHOMP MAZE", [
            "Eat every dot and avoid the bots",
            "Press Space, tap or swipe to start",
            "Arrows / WASD or swipe · P pause"
        ]);
    } else if (state === "paused") {
        drawPanel(g, "PAUSED", ["Press P or tap to resume"]);
    } else if (state === "gameover") {
        drawPanel(g, "GAME OVER", [
            "Score: " + score,
            "Press Space or tap to play again"
        ], "#ff4d6d");
    } else if (state === "win") {
        drawPanel(g, "YOU WIN!", [
            "Final score: " + score,
            "Press Space or tap to play again"
        ], "#8ac926");
    } else if (state === "ready") {
        // A dark label keeps the text readable on top of the maze
        g.fillStyle = "rgba(5, 6, 15, 0.88)";
        roundRect(g, boardWidth / 2 - 80, 11 * tileSize - 36, 160, 72, 12);
        g.fill();

        g.textAlign = "center";
        g.fillStyle = "#ffd23f";
        g.font = "bold 26px system-ui, sans-serif";
        g.fillText("LEVEL " + (levelIndex + 1), boardWidth / 2, 11 * tileSize - 4);
        g.fillText("READY!", boardWidth / 2, 11 * tileSize + 26);
        g.textAlign = "left";
    }
}