(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);

  const game = $("#game");
  const canvas = $("#scene");
  const ctx = canvas.getContext("2d");

  const levelEl = $("#level");
  const rescuedEl = $("#rescued");
  const missEl = $("#miss");
  const hitEl = $("#hit");
  const mission = $("#mission");
  const progress = $("#progress");

  const overlay = $("#overlay");
  const title = $("#title");
  const desc = $("#desc");
  const startButton = $("#start");
  const pauseButton = $("#pause");
  const soundButton = $("#sound");
  const newGameButton = $("#newGame");

  const feedback = $("#feedback");
  const waveBanner = $("#waveBanner");
  const levelMap = $("#levelMap");
  const journeyStatus = $("#journeyStatus");
  const bgm = $("#bgm");

  const MAX_LEVEL = 10;
  const MAX_MISSES = 2;
  const MAX_HITS = 2;
  const MISS_LINE_Y = 0.865;
  const SAVE_KEY = "lostStarsSave";

  const LEVELS = [
    { stars: 5, speed: 0.25, gap: 1.25, lanes: 5 },
    { stars: 6, speed: 0.27, gap: 1.20, lanes: 5 },
    { stars: 7, speed: 0.29, gap: 1.15, lanes: 5 },
    { stars: 8, speed: 0.31, gap: 1.10, lanes: 6 },
    { stars: 9, speed: 0.33, gap: 1.05, lanes: 6 },
    { stars: 10, speed: 0.35, gap: 1.00, lanes: 6 },
    { stars: 11, speed: 0.37, gap: 0.95, lanes: 7 },
    { stars: 12, speed: 0.39, gap: 0.90, lanes: 7 },
    { stars: 13, speed: 0.41, gap: 0.85, lanes: 7 },
    { stars: 15, speed: 0.43, gap: 0.80, lanes: 8 }
  ];

  function freshSave() {
    return {
      highestUnlockedLevel: 1,
      clearedLevels: []
    };
  }

  function normalizeSave(data) {
    if (!data || typeof data !== "object") {
      return freshSave();
    }

    let cleared = Array.isArray(data.clearedLevels)
      ? data.clearedLevels.filter(
          (n) =>
            Number.isInteger(n) &&
            n >= 1 &&
            n <= MAX_LEVEL
        )
      : [];

    cleared = [...new Set(cleared)].sort((a, b) => a - b);

    let highest = 1;

    for (const clearedLevel of cleared) {
      highest = Math.max(
        highest,
        clearedLevel < MAX_LEVEL
          ? clearedLevel + 1
          : MAX_LEVEL
      );
    }

    if (
      Number.isInteger(data.highestUnlockedLevel) &&
      data.highestUnlockedLevel >= 1 &&
      data.highestUnlockedLevel <= MAX_LEVEL
    ) {
      highest = Math.max(
        highest,
        data.highestUnlockedLevel
      );
    }

    return {
      highestUnlockedLevel: Math.min(MAX_LEVEL, highest),
      clearedLevels: cleared
    };
  }

  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);

      return raw
        ? normalizeSave(JSON.parse(raw))
        : freshSave();
    } catch {
      try {
        localStorage.removeItem(SAVE_KEY);
      } catch {}

      return freshSave();
    }
  }

  function writeSave() {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify(saveData)
      );
    } catch {}
  }

  let saveData = loadSave();
  let level = saveData.highestUnlockedLevel;

  let running = false;
  let paused = false;
  let raf = 0;
  let lastTime = 0;

  let resumeCountdown = false;
  let countdownValue = 0;
  let countdownTimer = null;

  let rescued = 0;
  let misses = 0;
  let hits = 0;

  let waveTimer = 0;
  let invincible = 0;

  let successMode = false;
  let successTime = 0;

  let dangerMode = false;
  let dangerWarning = false;
  let dangerTimer = 0;
  let dangerSpawnTimer = 0;
  let dangerSpawnCount = 0;
  let dangerSpawnLimit = 0;
  let dangerStarsSpawned = 0;

  let wavesSinceLastStar = 0;

  let lastWaveType = "";
  let previousWaveType = "";
  let lastStarLane = -1;
  let lastRockLane = -1;
  let lastBigStart = -1;

  let recentStarLanes = [];

  let lanes = [];
  let laneCount = 5;

  let playerLane = 2;

  let player = {
    x: 0,
    y: 0.80
  };

  let targetX = 0;

  let stars = [];
  let rocks = [];
  let dust = [];
  let fireworks = [];

  let W = 1;
  let H = 1;

  let audioContext = null;
  let soundEnabled = true;

  if (bgm) {
    bgm.volume = 0.28;
    bgm.loop = true;
  }

  function settings() {
    return LEVELS[level - 1];
  }

  function createLanes(count) {
    return Array.from(
      { length: count },
      (_, i) => (i + 0.5) / count
    );
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function randomInt(min, max) {
    return Math.floor(rand(min, max + 1));
  }

  function randomItem(array) {
    return array[randomInt(0, array.length - 1)];
  }

  function getAudio() {
    if (!soundEnabled) return null;

    if (!audioContext) {
      const AudioClass =
        window.AudioContext ||
        window.webkitAudioContext;

      if (!AudioClass) return null;

      audioContext = new AudioClass();
    }

    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    return audioContext;
  }

  function playBGM() {
    if (
      !soundEnabled ||
      !bgm ||
      !running ||
      paused ||
      resumeCountdown
    ) {
      return;
    }

    const promise = bgm.play();

    if (promise?.catch) {
      promise.catch(() => {});
    }
  }

  function pauseBGM() {
    if (bgm) {
      bgm.pause();
    }
  }

  function resetBGM() {
    if (!bgm) return;

    bgm.pause();
    bgm.currentTime = 0;
  }

  function tone(
    frequency,
    duration,
    type = "sine",
    volume = 0.04,
    delay = 0
  ) {
    if (!soundEnabled) return;

    const audio = getAudio();
    if (!audio) return;

    const start = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      volume,
      start + 0.015
    );
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      start + duration
    );

    oscillator.connect(gain);
    gain.connect(audio.destination);

    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  }

  function soundMove() {
    tone(230, 0.05, "sine", 0.016);
  }

  function soundStar() {
    tone(660, 0.08, "sine", 0.045);
    tone(880, 0.12, "sine", 0.045, 0.055);
  }

  function soundMiss() {
    tone(210, 0.15, "sawtooth", 0.03);
    tone(140, 0.20, "sawtooth", 0.025, 0.08);
  }

  function soundHit() {
    tone(100, 0.18, "square", 0.045);
    tone(70, 0.22, "sawtooth", 0.025, 0.05);
  }

  function soundDanger() {
    tone(180, 0.14, "square", 0.03);
    tone(180, 0.14, "square", 0.03, 0.22);
    tone(180, 0.14, "square", 0.03, 0.44);
  }

  function soundSuccess() {
    tone(523, 0.13, "sine", 0.05);
    tone(659, 0.13, "sine", 0.05, 0.09);
    tone(784, 0.15, "sine", 0.05, 0.18);
    tone(1046, 0.30, "sine", 0.06, 0.29);
  }

  function soundGameOver() {
    tone(300, 0.15, "triangle", 0.04);
    tone(210, 0.18, "triangle", 0.04, 0.13);
    tone(120, 0.30, "triangle", 0.045, 0.27);
  }

  function getNextWaveDelay() {
    return Math.max(
      0.68,
      settings().gap * rand(0.82, 1.28)
    );
  }

  function spawnStar(lane, y = -0.08) {
    stars.push({
      lane,
      x: lanes[lane],
      y,
      active: true
    });
  }

  function spawnRock(lane, y = -0.10) {
    rocks.push({
      lane,
      x: lanes[lane],
      y,
      active: true,
      big: false
    });
  }

  function spawnBigRock(startLane, y = -0.10) {
    rocks.push({
      startLane,
      endLane: startLane + 1,
      y,
      active: true,
      big: true
    });
  }

  function chooseStarLane() {
    let candidates = Array.from(
      { length: laneCount },
      (_, i) => i
    );

    if (lastStarLane !== -1) {
      const separated = candidates.filter(
        (lane) =>
          Math.abs(lane - lastStarLane) >= 2
      );

      if (separated.length) {
        candidates = separated;
      } else {
        candidates = candidates.filter(
          (lane) => lane !== lastStarLane
        );
      }
    }

    if (recentStarLanes.length >= 3) {
      const counts = Array(laneCount).fill(0);

      for (const lane of recentStarLanes) {
        counts[lane]++;
      }

      const minimum = Math.min(
        ...candidates.map(
          (lane) => counts[lane]
        )
      );

      const lessUsed = candidates.filter(
        (lane) => counts[lane] === minimum
      );

      if (lessUsed.length) {
        candidates = lessUsed;
      }
    }

    return randomItem(candidates);
  }

  function rememberStarLane(lane) {
    recentStarLanes.push(lane);

    if (recentStarLanes.length > 4) {
      recentStarLanes.shift();
    }

    lastStarLane = lane;
  }

  function waveStar() {
    const lane = chooseStarLane();

    spawnStar(lane);
    rememberStarLane(lane);
  }

  function chooseRockLane() {
    let candidates = Array.from(
      { length: laneCount },
      (_, i) => i
    );

    if (
      lastRockLane !== -1 &&
      candidates.length > 1
    ) {
      candidates = candidates.filter(
        (lane) => lane !== lastRockLane
      );
    }

    return randomItem(candidates);
  }

  function waveRock() {
    const lane = chooseRockLane();

    spawnRock(lane);
    lastRockLane = lane;
  }

  function waveBigRock() {
    let starts = Array.from(
      { length: laneCount - 1 },
      (_, i) => i
    );

    if (
      lastBigStart !== -1 &&
      starts.length > 1
    ) {
      starts = starts.filter(
        (start) => start !== lastBigStart
      );
    }

    const start = randomItem(starts);

    spawnBigRock(start);
    lastBigStart = start;
  }

  function dangerSettings() {
    if (level === 7) {
      return {
        duration: 3.0,
        count: 5,
        gapMin: 0.55,
        gapMax: 0.68
      };
    }

    if (level === 8) {
      return {
        duration: 3.2,
        count: 6,
        gapMin: 0.52,
        gapMax: 0.64
      };
    }

    if (level === 9) {
      return {
        duration: 3.4,
        count: 7,
        gapMin: 0.48,
        gapMax: 0.60
      };
    }

    return {
      duration: 3.6,
      count: 8,
      gapMin: 0.45,
      gapMax: 0.56
    };
  }

  function startDangerWave() {
    if (dangerMode || dangerWarning) {
      return;
    }

    dangerWarning = true;
    dangerTimer = 0.7;

    showWave("⚠ DANGER WAVE", true);
    soundDanger();
  }

  function beginDangerStorm() {
    const config = dangerSettings();

    dangerWarning = false;
    dangerMode = true;
    dangerTimer = config.duration;
    dangerSpawnTimer = 0;
    dangerSpawnCount = 0;
    dangerSpawnLimit = config.count;
    dangerStarsSpawned = 0;
  }

  function getDangerBlockedLanes() {
    const blocked = new Set();

    for (const rock of rocks) {
      if (!rock.active) continue;

      if (rock.y < -0.22 || rock.y > 0.23) {
        continue;
      }

      if (rock.big) {
        blocked.add(rock.startLane);
        blocked.add(rock.endLane);
      } else {
        blocked.add(rock.lane);
      }
    }

    return blocked;
  }

  function trySpawnDangerStar() {
    if (dangerStarsSpawned >= 2) {
      return;
    }

    const chance =
      level >= 9
        ? 0.22
        : 0.28;

    if (Math.random() > chance) {
      return;
    }

    const blocked = getDangerBlockedLanes();

    let candidates = Array.from(
      { length: laneCount },
      (_, i) => i
    ).filter(
      (lane) => !blocked.has(lane)
    );

    if (!candidates.length) {
      return;
    }

    if (lastStarLane !== -1) {
      const separated = candidates.filter(
        (lane) =>
          Math.abs(lane - lastStarLane) >= 2
      );

      if (separated.length) {
        candidates = separated;
      }
    }

    const lane = randomItem(candidates);

    spawnStar(lane, -0.18);
    rememberStarLane(lane);

    dangerStarsSpawned++;
  }

  function spawnDangerRock() {
    const blocked = getDangerBlockedLanes();

    let available = Array.from(
      { length: laneCount },
      (_, i) => i
    ).filter(
      (lane) => !blocked.has(lane)
    );

    const maxCurrentlyBlocked =
      Math.max(1, laneCount - 2);

    const remainingCapacity =
      maxCurrentlyBlocked - blocked.size;

    if (
      remainingCapacity <= 0 ||
      available.length <= 2
    ) {
      dangerSpawnTimer = 0.18;
      return;
    }

    let amount = 1;

    if (
      level >= 8 &&
      available.length >= 4 &&
      remainingCapacity >= 2 &&
      Math.random() < 0.30
    ) {
      amount = 2;
    }

    amount = Math.min(
      amount,
      remainingCapacity,
      available.length - 2
    );

    if (amount <= 0) {
      dangerSpawnTimer = 0.18;
      return;
    }

    for (let i = 0; i < amount; i++) {
      const index = randomInt(
        0,
        available.length - 1
      );

      const lane = available[index];

      available.splice(index, 1);

      spawnRock(lane, -0.10);
    }

    dangerSpawnCount++;
    trySpawnDangerStar();
  }

  function updateDanger(dt) {
    if (dangerWarning) {
      dangerTimer -= dt;

      if (dangerTimer <= 0) {
        beginDangerStorm();
      }

      return;
    }

    if (!dangerMode) {
      return;
    }

    const config = dangerSettings();

    dangerTimer -= dt;
    dangerSpawnTimer -= dt;

    if (
      dangerSpawnTimer <= 0 &&
      dangerSpawnCount < dangerSpawnLimit
    ) {
      spawnDangerRock();

      dangerSpawnTimer = rand(
        config.gapMin,
        config.gapMax
      );
    }

    if (
      dangerTimer <= 0 ||
      dangerSpawnCount >= dangerSpawnLimit
    ) {
      dangerMode = false;
      dangerSpawnTimer = 0;
      waveTimer = getNextWaveDelay();
    }
  }

  function chooseWaveType() {
    let choices = [
      "star",
      "rock",
      "rock"
    ];

    if (wavesSinceLastStar >= 2) {
      choices.push(
        "star",
        "star",
        "star"
      );
    }

    if (lastWaveType === "star") {
      choices = choices.filter(
        (type) => type !== "star"
      );
    }

    if (
      level >= 5 &&
      lastWaveType !== "big"
    ) {
      choices.push("big");
    }

    if (
      level >= 7 &&
      lastWaveType !== "danger" &&
      previousWaveType !== "danger"
    ) {
      choices.push("danger");
    }

    return randomItem(choices);
  }

  function spawnWave() {
    if (dangerMode || dangerWarning) {
      return;
    }

    const type = chooseWaveType();

    if (type === "star") {
      waveStar();
      wavesSinceLastStar = 0;
    } else {
      wavesSinceLastStar++;
    }

    if (type === "rock") {
      waveRock();
    } else if (type === "big") {
      waveBigRock();
    } else if (type === "danger") {
      startDangerWave();
    }

    previousWaveType = lastWaveType;
    lastWaveType = type;
  }

  function clearCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }

    resumeCountdown = false;
    countdownValue = 0;
  }

  function setupLevel() {
    cancelAnimationFrame(raf);
    clearCountdown();

    laneCount = settings().lanes;
    lanes = createLanes(laneCount);

    rescued = 0;
    misses = 0;
    hits = 0;

    waveTimer = rand(0.45, 0.75);
    invincible = 0;

    successMode = false;
    successTime = 0;

    dangerMode = false;
    dangerWarning = false;
    dangerTimer = 0;
    dangerSpawnTimer = 0;
    dangerSpawnCount = 0;
    dangerSpawnLimit = 0;
    dangerStarsSpawned = 0;

    wavesSinceLastStar = 0;

    lastWaveType = "";
    previousWaveType = "";
    lastStarLane = -1;
    lastRockLane = -1;
    lastBigStart = -1;

    recentStarLanes = [];

    stars = [];
    rocks = [];
    fireworks = [];

    playerLane =
      Math.floor((laneCount - 1) / 2);

    player = {
      x: lanes[playerLane],
      y: 0.80
    };

    targetX = player.x;

    hud();
    renderLevelMap();
    draw();
  }

  function hud() {
    levelEl.textContent =
      `${level} / ${MAX_LEVEL}`;

    rescuedEl.textContent =
      `${rescued} / ${settings().stars}`;

    missEl.textContent =
      `${misses} / ${MAX_MISSES}`;

    hitEl.textContent =
      `${hits} / ${MAX_HITS}`;

    progress.style.width =
      `${
        Math.min(
          1,
          rescued / settings().stars
        ) * 100
      }%`;

    mission.textContent =
      `LEVEL ${level} · STAR ${rescued}/${settings().stars}`;
  }

  function say(text, danger = false) {
    feedback.textContent = text;

    feedback.classList.remove(
      "show",
      "danger"
    );

    if (danger) {
      feedback.classList.add("danger");
    }

    void feedback.offsetWidth;

    feedback.classList.add("show");
  }

  function showWave(text, danger = false) {
    waveBanner.textContent = text;

    waveBanner.classList.remove(
      "show",
      "danger"
    );

    if (danger) {
      waveBanner.classList.add("danger");
    }

    void waveBanner.offsetWidth;

    waveBanner.classList.add("show");
  }

  function moveLeft() {
    if (
      !running ||
      paused ||
      resumeCountdown ||
      successMode ||
      playerLane <= 0
    ) {
      return;
    }

    playerLane--;
    targetX = lanes[playerLane];

    soundMove();
  }

  function moveRight() {
    if (
      !running ||
      paused ||
      resumeCountdown ||
      successMode ||
      playerLane >= laneCount - 1
    ) {
      return;
    }

    playerLane++;
    targetX = lanes[playerLane];

    soundMove();
  }

  function updatePlayer(dt) {
    player.x +=
      (targetX - player.x) *
      Math.min(1, 28 * dt);

    if (
      Math.abs(targetX - player.x) <
      0.001
    ) {
      player.x = targetX;
    }
  }

  function updateWaves(dt) {
    updateDanger(dt);

    if (dangerMode || dangerWarning) {
      return;
    }

    waveTimer -= dt;

    if (waveTimer <= 0) {
      spawnWave();
      waveTimer = getNextWaveDelay();
    }
  }

  function getPlayerHitbox() {
    const scale = Math.max(
      0.72,
      Math.min(1, 5 / laneCount)
    );

    return {
      left:
        player.x * W - 8 * scale,
      right:
        player.x * W + 8 * scale,
      top:
        player.y * H - 16 * scale,
      bottom:
        player.y * H + 12 * scale
    };
  }

  function getNormalRockRadius() {
    return Math.max(
      13,
      Math.min(
        25,
        (W / laneCount) * 0.14
      )
    );
  }

  function getNormalRockHitbox(rock) {
    const x = rock.x * W;
    const y = rock.y * H;

    const radius =
      getNormalRockRadius();

    const hitRadius =
      radius * 0.70;

    return {
      left: x - hitRadius,
      right: x + hitRadius,
      top: y - hitRadius,
      bottom: y + hitRadius
    };
  }

  function getBigRockRect(rock) {
    const laneWidth =
      W / laneCount;

    const left =
      rock.startLane *
        laneWidth +
      laneWidth * 0.10;

    const right =
      (rock.endLane + 1) *
        laneWidth -
      laneWidth * 0.10;

    const height =
      Math.min(
        66,
        H * 0.10
      );

    const y =
      rock.y * H;

    return {
      left,
      right,
      top: y - height / 2,
      bottom: y + height / 2,
      width: right - left,
      height,
      y
    };
  }

  function getBigRockHitbox(rock) {
    const rect =
      getBigRockRect(rock);

    const padX =
      Math.min(
        14,
        rect.width * 0.06
      );

    const padY =
      rect.height * 0.18;

    return {
      left: rect.left + padX,
      right: rect.right - padX,
      top: rect.top + padY,
      bottom: rect.bottom - padY
    };
  }

  function boxesOverlap(a, b) {
    return (
      a.left < b.right &&
      a.right > b.left &&
      a.top < b.bottom &&
      a.bottom > b.top
    );
  }

  function rockHitsPlayer(rock) {
    const playerBox =
      getPlayerHitbox();

    const rockBox =
      rock.big
        ? getBigRockHitbox(rock)
        : getNormalRockHitbox(rock);

    return boxesOverlap(
      playerBox,
      rockBox
    );
  }

  function updateObjects(dt) {
    const speed =
      settings().speed;

    const laneWidth =
      1 / laneCount;

    const starHorizontal =
      Math.min(
        0.075,
        laneWidth * 0.28
      );

    for (const star of stars) {
      if (!star.active) {
        continue;
      }

      star.y += speed * dt;

      const horizontal =
        Math.abs(
          star.x - player.x
        );

      const vertical =
        Math.abs(
          star.y - player.y
        );

      if (
        horizontal < starHorizontal &&
        vertical < 0.065
      ) {
        star.active = false;
        rescued++;

        soundStar();
        say("STAR GET!");

        if (
          rescued >=
          settings().stars
        ) {
          startSuccess();
          return;
        }

        hud();
        continue;
      }

      if (
        star.y >
        MISS_LINE_Y
      ) {
        star.active = false;
        misses++;

        soundMiss();

        say(
          `STAR MISSED! ${misses}/2`,
          true
        );

        hud();

        if (
          misses >=
          MAX_MISSES
        ) {
          gameOver("miss");
          return;
        }
      }
    }

    for (const rock of rocks) {
      if (!rock.active) {
        continue;
      }

      rock.y += speed * dt;

      if (rock.y > 1.12) {
        rock.active = false;
        continue;
      }

      if (invincible > 0) {
        continue;
      }

      if (rockHitsPlayer(rock)) {
        rock.active = false;
        hits++;
        invincible = 0.90;

        soundHit();

        say(
          `ASTEROID HIT! ${hits}/2`,
          true
        );

        hud();

        if (
          hits >=
          MAX_HITS
        ) {
          gameOver("hit");
          return;
        }
      }
    }

    stars = stars.filter(
      (star) => star.active
    );

    rocks = rocks.filter(
      (rock) => rock.active
    );
  }

  function startSuccess() {
    if (successMode) return;

    successMode = true;
    successTime = 0;

    stars = [];
    rocks = [];

    dangerMode = false;
    dangerWarning = false;

    targetX = 0.5;

    createFireworks();
    soundSuccess();

    say("MISSION SUCCESS!");
    hud();
  }

  function createFireworks() {
    fireworks = [];

    const centers = [
      [0.12, 0.18],
      [0.30, 0.28],
      [0.50, 0.15],
      [0.70, 0.28],
      [0.88, 0.18],
      [0.20, 0.48],
      [0.80, 0.48],
      [0.35, 0.62],
      [0.65, 0.62]
    ];

    for (const [x, y] of centers) {
      for (let i = 0; i < 52; i++) {
        const angle =
          Math.random() *
          Math.PI *
          2;

        const speed =
          rand(0.10, 0.38);

        fireworks.push({
          x,
          y,
          vx:
            Math.cos(angle) *
            speed,
          vy:
            Math.sin(angle) *
            speed,
          life:
            rand(1.5, 2.8),
          size:
            rand(2, 6)
        });
      }
    }
  }

  function updateSuccess(dt) {
    successTime += dt;

    player.x +=
      (0.5 - player.x) *
      Math.min(1, 12 * dt);

    player.y +=
      (0.43 - player.y) *
      Math.min(1, 8 * dt);

    for (const particle of fireworks) {
      particle.x +=
        particle.vx * dt;

      particle.y +=
        particle.vy * dt;

      particle.vy +=
        0.10 * dt;

      particle.life -= dt;
    }

    if (successTime >= 3.2) {
      completeLevel();
    }
  }

  function saveLevelClear() {
    if (
      !saveData.clearedLevels.includes(level)
    ) {
      saveData.clearedLevels.push(level);
    }

    saveData.clearedLevels.sort(
      (a, b) => a - b
    );

    saveData.highestUnlockedLevel =
      level < MAX_LEVEL
        ? Math.max(
            saveData.highestUnlockedLevel,
            level + 1
          )
        : MAX_LEVEL;

    writeSave();
    renderLevelMap();
  }

  function completeLevel() {
    running = false;
    paused = false;

    clearCountdown();
    cancelAnimationFrame(raf);

    pauseBGM();
    saveLevelClear();

    pauseButton.disabled = true;
    pauseButton.textContent = "PAUSE";

    overlay.classList.remove("hidden");

    if (level >= MAX_LEVEL) {
      resetBGM();

      title.textContent =
        "MISSION COMPLETE!";

      desc.textContent =
        "10개의 구조 임무를 모두 완료했습니다!";

      startButton.textContent =
        "PLAY AGAIN";

      return;
    }

    title.textContent =
      `LEVEL ${level} COMPLETE!`;

    desc.textContent =
      `구조 성공! 다음은 LEVEL ${level + 1}입니다.`;

    startButton.textContent =
      "NEXT LEVEL";
  }

  function gameOver(reason) {
    running = false;
    paused = false;

    clearCountdown();
    cancelAnimationFrame(raf);

    pauseBGM();
    soundGameOver();

    pauseButton.disabled = true;
    pauseButton.textContent = "PAUSE";

    overlay.classList.remove("hidden");

    title.textContent =
      "GAME OVER";

    desc.textContent =
      reason === "hit"
        ? `운석에 2번 충돌했습니다. LEVEL ${level}을 다시 도전하세요.`
        : `별을 2번 놓쳤습니다. LEVEL ${level}을 다시 도전하세요.`;

    startButton.textContent =
      "TRY AGAIN";
  }

  function renderLevelMap() {
    levelMap.innerHTML = "";

    for (
      let i = 1;
      i <= MAX_LEVEL;
      i++
    ) {
      const node =
        document.createElement("div");

      const dot =
        document.createElement("div");

      const number =
        document.createElement("span");

      node.className =
        "level-node";

      dot.className =
        "level-dot";

      number.className =
        "level-number";

      const completed =
        saveData.clearedLevels.includes(i);

      if (completed) {
        node.classList.add("completed");
      }

      if (i === level) {
        node.classList.add("current");
      }

      if (i === MAX_LEVEL) {
        node.classList.add("final");
      }

      if (completed) {
        dot.textContent = "✓";
      } else if (i === level) {
        dot.textContent = "🚀";
      } else if (i === MAX_LEVEL) {
        dot.textContent = "★";
      } else {
        dot.textContent = "○";
      }

      number.textContent =
        `LV.${i}`;

      node.append(
        dot,
        number
      );

      levelMap.appendChild(node);
    }

    journeyStatus.textContent =
      `클리어 ${saveData.clearedLevels.length} / ${MAX_LEVEL} · 현재 LEVEL ${level}`;
  }

  function resize() {
    const rect =
      game.getBoundingClientRect();

    W =
      canvas.width =
        Math.max(
          1,
          Math.floor(rect.width)
        );

    H =
      canvas.height =
        Math.max(
          1,
          Math.floor(rect.height)
        );

    if (!dust.length) {
      for (
        let i = 0;
        i < 220;
        i++
      ) {
        dust.push({
          x: Math.random(),
          y: Math.random(),
          size: rand(0.5, 1.8),
          alpha: rand(0.2, 0.8)
        });
      }
    }

    draw();
  }

  function drawBackground() {
    const gradient =
      ctx.createLinearGradient(
        0,
        0,
        0,
        H
      );

    if (
      dangerMode ||
      dangerWarning
    ) {
      gradient.addColorStop(
        0,
        "#471d50"
      );

      gradient.addColorStop(
        0.5,
        "#32215c"
      );

      gradient.addColorStop(
        1,
        "#32164d"
      );
    } else {
      gradient.addColorStop(
        0,
        "#172f70"
      );

      gradient.addColorStop(
        0.5,
        "#253b7a"
      );

      gradient.addColorStop(
        1,
        "#321f68"
      );
    }

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    for (const dot of dust) {
      ctx.globalAlpha =
        dot.alpha;

      ctx.fillStyle =
        "#fff";

      ctx.beginPath();

      ctx.arc(
        dot.x * W,
        dot.y * H,
        dot.size,
        0,
        Math.PI * 2
      );

      ctx.fill();
    }

    ctx.globalAlpha = 1;

    if (
      dangerMode ||
      dangerWarning
    ) {
      ctx.fillStyle =
        `rgba(251,113,133,${
          0.025 +
          Math.abs(
            Math.sin(
              performance.now() / 180
            )
          ) *
          0.045
        })`;

      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawLanes() {
    ctx.save();

    ctx.strokeStyle =
      dangerMode ||
      dangerWarning
        ? "rgba(251,113,133,.25)"
        : "rgba(191,219,254,.17)";

    ctx.lineWidth = 1;

    for (
      let i = 1;
      i < laneCount;
      i++
    ) {
      const x =
        W * (i / laneCount);

      ctx.beginPath();

      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);

      ctx.stroke();
    }

    ctx.restore();
  }

  function drawMissLine() {
    if (successMode) return;

    const y =
      MISS_LINE_Y * H;

    ctx.save();

    ctx.strokeStyle =
      "rgba(251,113,133,.72)";

    ctx.shadowColor =
      "rgba(251,113,133,.45)";

    ctx.shadowBlur = 6;
    ctx.lineWidth = 2;

    ctx.setLineDash([8, 8]);

    ctx.beginPath();

    ctx.moveTo(18, y);
    ctx.lineTo(W - 18, y);

    ctx.stroke();

    ctx.restore();
  }

  function drawStar(star) {
    if (!star.active) return;

    const x = star.x * W;
    const y = star.y * H;

    const radius =
      Math.max(
        10,
        Math.min(
          16,
          (W / laneCount) * 0.12
        )
      );

    ctx.save();

    ctx.translate(x, y);

    ctx.shadowColor =
      "#fde68a";

    ctx.shadowBlur = 20;

    ctx.fillStyle =
      "#fff3a6";

    ctx.strokeStyle =
      "#fff";

    ctx.lineWidth = 1.2;

    ctx.beginPath();

    for (
      let i = 0;
      i < 10;
      i++
    ) {
      const angle =
        -Math.PI / 2 +
        i * Math.PI / 5;

      const r =
        i % 2 === 0
          ? radius
          : radius * 0.43;

      const px =
        Math.cos(angle) * r;

      const py =
        Math.sin(angle) * r;

      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }

    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  function getNormalRockRadius() {
    return Math.max(
      13,
      Math.min(
        25,
        (W / laneCount) * 0.14
      )
    );
  }

  function drawNormalRock(rock) {
    const x = rock.x * W;
    const y = rock.y * H;

    const radius =
      getNormalRockRadius();

    ctx.save();

    ctx.translate(x, y);

    ctx.shadowColor =
      "rgba(0,0,0,.5)";

    ctx.shadowBlur = 9;

    ctx.fillStyle =
      "#64748b";

    ctx.strokeStyle =
      "#b7c4d8";

    ctx.lineWidth = 2;

    ctx.beginPath();

    ctx.arc(
      0,
      0,
      radius,
      0,
      Math.PI * 2
    );

    ctx.fill();
    ctx.stroke();

    ctx.fillStyle =
      "#35435a";

    ctx.beginPath();

    ctx.arc(
      -radius * 0.28,
      -radius * 0.20,
      radius * 0.19,
      0,
      Math.PI * 2
    );

    ctx.fill();

    ctx.beginPath();

    ctx.arc(
      radius * 0.30,
      radius * 0.18,
      radius * 0.14,
      0,
      Math.PI * 2
    );

    ctx.fill();

    ctx.restore();
  }

  function getBigRockRect(rock) {
    const laneWidth =
      W / laneCount;

    const left =
      rock.startLane *
        laneWidth +
      laneWidth * 0.10;

    const right =
      (rock.endLane + 1) *
        laneWidth -
      laneWidth * 0.10;

    const height =
      Math.min(
        66,
        H * 0.10
      );

    const y =
      rock.y * H;

    return {
      left,
      right,
      top: y - height / 2,
      bottom: y + height / 2,
      width: right - left,
      height,
      y
    };
  }

  function drawBigRock(rock) {
    const rect =
      getBigRockRect(rock);

    ctx.save();

    ctx.shadowColor =
      "#111827";

    ctx.shadowBlur = 14;

    ctx.fillStyle =
      "#475569";

    ctx.strokeStyle =
      "#cbd5e1";

    ctx.lineWidth = 2;

    ctx.beginPath();

    ctx.roundRect(
      rect.left,
      rect.top,
      rect.width,
      rect.height,
      Math.min(
        24,
        rect.height / 2
      )
    );

    ctx.fill();
    ctx.stroke();

    ctx.fillStyle =
      "#293548";

    ctx.beginPath();

    ctx.arc(
      rect.left +
        rect.width * 0.32,
      rect.y - 7,
      Math.min(
        8,
        rect.height * 0.15
      ),
      0,
      Math.PI * 2
    );

    ctx.fill();

    ctx.beginPath();

    ctx.arc(
      rect.left +
        rect.width * 0.68,
      rect.y + 8,
      Math.min(
        7,
        rect.height * 0.13
      ),
      0,
      Math.PI * 2
    );

    ctx.fill();

    ctx.restore();
  }

  function drawRock(rock) {
    if (!rock.active) return;

    if (rock.big) {
      drawBigRock(rock);
    } else {
      drawNormalRock(rock);
    }
  }

  function drawShip() {
    const x =
      player.x * W;

    const y =
      player.y * H;

    const scale =
      Math.max(
        0.72,
        Math.min(
          1,
          5 / laneCount
        )
      );

    ctx.save();

    ctx.translate(x, y);
    ctx.scale(scale, scale);

    if (
      invincible > 0 &&
      Math.floor(
        invincible * 12
      ) % 2 === 0
    ) {
      ctx.globalAlpha =
        0.35;
    }

    ctx.shadowColor =
      successMode
        ? "#86efac"
        : "#7dd3fc";

    ctx.shadowBlur =
      successMode
        ? 35
        : 18;

    ctx.fillStyle =
      "#f8fafc";

    ctx.beginPath();

    ctx.moveTo(0, -22);
    ctx.lineTo(17, 15);
    ctx.lineTo(0, 9);
    ctx.lineTo(-17, 15);

    ctx.closePath();
    ctx.fill();

    ctx.fillStyle =
      "#38bdf8";

    ctx.beginPath();

    ctx.arc(
      0,
      -5,
      5,
      0,
      Math.PI * 2
    );

    ctx.fill();

    ctx.fillStyle =
      successMode
        ? "#86efac"
        : dangerMode ||
          dangerWarning
        ? "#fb7185"
        : "#818cf8";

    ctx.beginPath();

    ctx.moveTo(-6, 11);
    ctx.lineTo(0, 34);
    ctx.lineTo(6, 11);

    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawSuccess() {
    const x = W / 2;
    const y = H * 0.40;

    const width =
      Math.min(
        350,
        W * 0.48
      );

    const height =
      Math.min(
        210,
        H * 0.34
      );

    ctx.save();

    ctx.shadowColor =
      "#4ade80";

    ctx.shadowBlur = 70;

    ctx.fillStyle =
      "rgba(34,197,94,.20)";

    ctx.strokeStyle =
      "#86efac";

    ctx.lineWidth = 5;

    ctx.beginPath();

    ctx.roundRect(
      x - width / 2,
      y - height / 2,
      width,
      height,
      24
    );

    ctx.fill();
    ctx.stroke();

    ctx.fillStyle =
      "#dcfce7";

    ctx.font =
      "900 20px sans-serif";

    ctx.textAlign =
      "center";

    ctx.fillText(
      "★ EXIT ZONE ★",
      x,
      y - height * 0.34
    );

    ctx.restore();

    for (const particle of fireworks) {
      if (particle.life <= 0) {
        continue;
      }

      ctx.save();

      ctx.globalAlpha =
        Math.min(
          1,
          particle.life
        );

      ctx.fillStyle =
        "#fde68a";

      ctx.shadowColor =
        "#fde68a";

      ctx.shadowBlur = 14;

      ctx.beginPath();

      ctx.arc(
        particle.x * W,
        particle.y * H,
        particle.size,
        0,
        Math.PI * 2
      );

      ctx.fill();

      ctx.restore();
    }

    ctx.save();

    ctx.fillStyle = "#fff";
    ctx.shadowColor = "#4ade80";
    ctx.shadowBlur = 30;

    ctx.font =
      `1000 ${Math.max(
        25,
        Math.min(
          34,
          W * 0.045
        )
      )}px sans-serif`;

    ctx.textAlign = "center";

    ctx.fillText(
      "MISSION SUCCESS!",
      W / 2,
      H * 0.74
    );

    ctx.fillStyle =
      "#bbf7d0";

    ctx.font =
      "800 13px sans-serif";

    ctx.fillText(
      `LEVEL ${level} CLEAR`,
      W / 2,
      H * 0.74 + 25
    );

    ctx.restore();
  }

  function drawCountdown() {
    if (
      !resumeCountdown ||
      countdownValue <= 0
    ) {
      return;
    }

    ctx.save();

    ctx.fillStyle =
      "rgba(7,15,40,.45)";

    ctx.fillRect(
      0,
      0,
      W,
      H
    );

    const size =
      Math.max(
        70,
        Math.min(
          130,
          W * 0.11
        )
      );

    ctx.font =
      `1000 ${size}px sans-serif`;

    ctx.textAlign =
      "center";

    ctx.textBaseline =
      "middle";

    ctx.fillStyle =
      "#ffffff";

    ctx.shadowColor =
      "#60a5fa";

    ctx.shadowBlur = 35;

    ctx.fillText(
      countdownValue,
      W / 2,
      H / 2
    );

    ctx.restore();
  }

  function draw() {
    drawBackground();
    drawLanes();
    drawMissLine();

    if (successMode) {
      drawSuccess();
      drawShip();
      return;
    }

    for (const rock of rocks) {
      drawRock(rock);
    }

    for (const star of stars) {
      drawStar(star);
    }

    drawShip();

    if (resumeCountdown) {
      drawCountdown();
    } else if (paused) {
      ctx.fillStyle =
        "rgba(7,15,40,.50)";

      ctx.fillRect(
        0,
        0,
        W,
        H
      );

      ctx.fillStyle =
        "#fff";

      ctx.font =
        "900 27px sans-serif";

      ctx.textAlign =
        "center";

      ctx.fillText(
        "PAUSED",
        W / 2,
        H / 2
      );
    }
  }

  function pauseGame() {
    if (
      !running ||
      paused ||
      resumeCountdown
    ) {
      return;
    }

    paused = true;

    cancelAnimationFrame(raf);
    pauseBGM();

    pauseButton.textContent =
      "RESUME";

    draw();
  }

  function resumeGame() {
    if (
      !running ||
      !paused ||
      resumeCountdown
    ) {
      return;
    }

    resumeCountdown = true;
    countdownValue = 3;

    pauseButton.disabled = true;

    draw();

    countdownTimer =
      setInterval(() => {
        countdownValue--;

        if (countdownValue <= 0) {
          clearInterval(
            countdownTimer
          );

          countdownTimer = null;

          resumeCountdown = false;
          paused = false;

          pauseButton.disabled =
            false;

          pauseButton.textContent =
            "PAUSE";

          lastTime =
            performance.now();

          playBGM();
          game.focus();

          raf =
            requestAnimationFrame(
              loop
            );

          return;
        }

        draw();
      }, 1000);
  }

  function startLevel() {
    running = true;
    paused = false;

    clearCountdown();

    pauseButton.disabled =
      false;

    pauseButton.textContent =
      "PAUSE";

    overlay.classList.add(
      "hidden"
    );

    getAudio();
    playBGM();

    lastTime =
      performance.now();

    game.focus();

    cancelAnimationFrame(raf);

    raf =
      requestAnimationFrame(
        loop
      );
  }

  function begin() {
    const mode =
      startButton.textContent;

    if (
      mode === "NEXT LEVEL"
    ) {
      level =
        Math.min(
          MAX_LEVEL,
          level + 1
        );
    } else if (
      mode === "PLAY AGAIN"
    ) {
      level = 1;
      resetBGM();
    }

    setupLevel();
    startLevel();
  }

  function showFirstLevelInstructions() {
    title.textContent =
      "잃어버린 별을 구출하세요";

    desc.innerHTML = `
      우주선은 자동으로 앞으로 이동합니다.<br>
      PC에서는 ← → 방향키로 이동하세요.<br>
      모바일에서는 게임 화면의 왼쪽 또는 오른쪽을 터치해 이동하세요.<br>
      내려오는 별을 구출하고 운석을 피해야 합니다.<br>
      별을 2번 놓치거나 운석에 2번 충돌하면 GAME OVER입니다.<br>
      필요한 별을 모두 구출하면 다음 LEVEL로 이동합니다.
    `;

    startButton.textContent =
      "START RESCUE";
  }

  function startNewGame() {
    cancelAnimationFrame(raf);
    clearCountdown();

    running = false;
    paused = false;

    resetBGM();

    saveData =
      freshSave();

    writeSave();

    level = 1;

    setupLevel();

    pauseButton.disabled =
      true;

    pauseButton.textContent =
      "PAUSE";

    overlay.classList.remove(
      "hidden"
    );

    showFirstLevelInstructions();
  }

  function loop(now) {
    if (
      !running ||
      paused ||
      resumeCountdown
    ) {
      return;
    }

    const dt =
      Math.min(
        (now - lastTime) /
          1000,
        0.05
      );

    lastTime = now;

    if (successMode) {
      updateSuccess(dt);
      draw();

      if (running) {
        raf =
          requestAnimationFrame(
            loop
          );
      }

      return;
    }

    if (invincible > 0) {
      invincible -= dt;
    }

    updatePlayer(dt);
    updateWaves(dt);
    updateObjects(dt);

    if (!running) {
      return;
    }

    hud();
    draw();

    raf =
      requestAnimationFrame(
        loop
      );
  }

  game.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight"
      ) {
        return;
      }

      event.preventDefault();

      if (event.repeat) {
        return;
      }

      if (
        event.key ===
        "ArrowLeft"
      ) {
        moveLeft();
      } else {
        moveRight();
      }
    }
  );

  game.addEventListener(
    "pointerdown",
    (event) => {
      if (
        event.pointerType !== "touch" ||
        !running ||
        paused ||
        resumeCountdown ||
        successMode
      ) {
        return;
      }

      const rect =
        game.getBoundingClientRect();

      const touchX =
        event.clientX -
        rect.left;

      if (
        touchX <
        rect.width / 2
      ) {
        moveLeft();
      } else {
        moveRight();
      }
    }
  );

  startButton.addEventListener(
    "click",
    begin
  );

  newGameButton.addEventListener(
    "click",
    startNewGame
  );

  pauseButton.addEventListener(
    "click",
    () => {
      if (!running) return;

      if (paused) {
        resumeGame();
      } else {
        pauseGame();
      }
    }
  );

  soundButton.addEventListener(
    "click",
    () => {
      soundEnabled =
        !soundEnabled;

      if (soundEnabled) {
        soundButton.textContent =
          "🔊 SOUND";

        getAudio();

        if (
          running &&
          !paused &&
          !resumeCountdown
        ) {
          playBGM();
        }

        tone(
          660,
          0.10,
          "sine",
          0.04
        );
      } else {
        soundButton.textContent =
          "🔇 SOUND";

        pauseBGM();
      }

      if (
        running &&
        !paused &&
        !resumeCountdown
      ) {
        game.focus();
      }
    }
  );

  document.addEventListener(
    "visibilitychange",
    () => {
      if (
        document.hidden &&
        running &&
        !paused &&
        !resumeCountdown
      ) {
        pauseGame();
      }
    }
  );

  window.addEventListener(
    "resize",
    resize
  );

  resize();
  setupLevel();
  renderLevelMap();

  if (
    saveData.clearedLevels.length > 0
  ) {
    title.textContent =
      `LEVEL ${level}부터 계속하기`;

    desc.textContent =
      `이전 진행 기록을 불러왔습니다. LEVEL ${level}부터 계속합니다.`;

    startButton.textContent =
      "CONTINUE";
  } else {
    showFirstLevelInstructions();
  }
})();