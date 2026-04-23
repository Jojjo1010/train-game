// Audio system with separate music/SFX volume controls

let ctx = null;
let masterGain = null;
let musicGain = null;
let sfxGainNode = null;
let musicPlaying = false;
let musicSource = null;
let musicBuffer = null;

let musicVolume = parseFloat(localStorage.getItem('vol_music') ?? '0.5');
let sfxVolume = parseFloat(localStorage.getItem('vol_sfx') ?? '0.5');

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(ctx.destination);

    musicGain = ctx.createGain();
    musicGain.gain.value = musicVolume;
    musicGain.connect(masterGain);

    sfxGainNode = ctx.createGain();
    sfxGainNode.gain.value = sfxVolume;
    sfxGainNode.connect(masterGain);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function sfxGain(volume = 0.3) {
  const c = getCtx();
  const g = c.createGain();
  g.gain.value = volume;
  g.connect(sfxGainNode);
  return g;
}

// --- Volume API ---
export function getMusicVolume() { return musicVolume; }
export function getSfxVolume() { return sfxVolume; }

export function setMusicVolume(v) {
  musicVolume = Math.max(0, Math.min(1, v));
  localStorage.setItem('vol_music', musicVolume.toString());
  if (musicGain) musicGain.gain.value = musicVolume;
}

export function setSfxVolume(v) {
  sfxVolume = Math.max(0, Math.min(1, v));
  localStorage.setItem('vol_sfx', sfxVolume.toString());
  if (sfxGainNode) sfxGainNode.gain.value = sfxVolume;
}

// --- SFX (unchanged, routed through sfxGainNode) ---
export function playShoot() {
  const c = getCtx();
  const t = c.currentTime;
  const pitchMult = 0.9 + Math.random() * 0.2;

  // Layer 1: noise snap (15ms)
  const noiseLen = c.sampleRate * 0.015;
  const noiseBuf = c.createBuffer(1, noiseLen, c.sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen);
  const noiseSrc = c.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  const gn = sfxGain(0.18);
  noiseSrc.connect(gn);
  noiseSrc.start(t);

  // Layer 2: low thump (30ms sine at 120Hz)
  const thump = c.createOscillator();
  const gt = sfxGain(0.12);
  thump.type = 'sine';
  thump.frequency.setValueAtTime(120 * pitchMult, t);
  thump.frequency.exponentialRampToValueAtTime(60, t + 0.03);
  gt.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  thump.connect(gt);
  thump.start(t);
  thump.stop(t + 0.04);

  // Layer 3: pitch sweep (louder + pitch varied)
  const osc = c.createOscillator();
  const g = sfxGain(0.15);
  osc.type = 'square';
  osc.frequency.setValueAtTime(800 * pitchMult, t);
  osc.frequency.exponentialRampToValueAtTime(200, t + 0.06);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  osc.connect(g);
  osc.start(t);
  osc.stop(t + 0.07);
}

export function playEnemyHit() {
  const c = getCtx();
  const pitchMult = 0.85 + Math.random() * 0.3;
  const osc = c.createOscillator();
  const g = sfxGain(0.12);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(300 * pitchMult, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(80, c.currentTime + 0.1);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.1);
  osc.connect(g);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.1);
}

export function playEnemyKill() {
  const c = getCtx();
  const pitchMult = 0.85 + Math.random() * 0.3;
  const bufferSize = c.sampleRate * 0.1;
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const noise = c.createBufferSource();
  noise.buffer = buffer;
  const g = sfxGain(0.14);
  noise.connect(g);
  noise.start(c.currentTime);

  const osc = c.createOscillator();
  const g2 = sfxGain(0.12);
  osc.type = 'square';
  osc.frequency.setValueAtTime(600 * pitchMult, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(100, c.currentTime + 0.12);
  g2.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.12);
  osc.connect(g2);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.12);
}

export function playWaveClear() {
  const c = getCtx();
  const t = c.currentTime;
  const tones = [400, 600];
  tones.forEach((freq, i) => {
    const osc = c.createOscillator();
    const g = sfxGain(0.12);
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const start = t + i * 0.08;
    g.gain.setValueAtTime(0.12, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.15);
    osc.connect(g);
    osc.start(start);
    osc.stop(start + 0.15);
  });
}

export function playTrainDamage() {
  const c = getCtx();
  const osc = c.createOscillator();
  const g = sfxGain(0.25);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(30, c.currentTime + 0.25);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3);
  osc.connect(g);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.3);

  const bufferSize = c.sampleRate * 0.15;
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize) * 0.6;
  const noise = c.createBufferSource();
  noise.buffer = buffer;
  const gn = sfxGain(0.15);
  noise.connect(gn);
  noise.start(c.currentTime);
}

export function playCoinPickup() {
  playMp3('assets/coin.mp3', 0.6);
}

export function playPowerup() {
  const c = getCtx();
  const osc = c.createOscillator();
  const g = sfxGain(0.15);
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(800, c.currentTime);
  osc.frequency.setValueAtTime(1200, c.currentTime + 0.08);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3);
  osc.connect(g);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.3);
}

// --- ONE-SHOT MP3 SFX ---
const mp3Cache = {};

async function playMp3(url, volume = 0.5) {
  const c = getCtx();
  if (!mp3Cache[url]) {
    const resp = await fetch(url);
    const arrayBuf = await resp.arrayBuffer();
    mp3Cache[url] = await c.decodeAudioData(arrayBuf);
  }
  const source = c.createBufferSource();
  source.buffer = mp3Cache[url];
  const g = sfxGain(volume);
  source.connect(g);
  source.start();
}

export function playLevelUpMp3() { playMp3('assets/levelup.mp3', 0.6); }
export function playZoneCompleteMp3() { playMp3('assets/zonecomplete.mp3', 0.7); }
export function playWinWorldMp3() { playMp3('assets/winworld.mp3', 0.7); }
export function playDefeatMp3() { playMp3('assets/loose.mp3', 0.7); }

export function playWeaponAcquire() {
  const c = getCtx();
  // Three ascending tones: C5 → E5 → G5 (523Hz → 659Hz → 784Hz)
  const tones = [523, 659, 784];
  const noteDuration = 0.08;
  tones.forEach((freq, i) => {
    const osc = c.createOscillator();
    const g = sfxGain(0.15);
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const start = c.currentTime + i * noteDuration;
    const end = start + noteDuration;
    g.gain.setValueAtTime(0.15, start);
    g.gain.exponentialRampToValueAtTime(0.001, end + 0.05);
    osc.connect(g);
    osc.start(start);
    osc.stop(end + 0.05);
  });
}

export function playStealCoin() {
  // Try MP3 first, fallback to synth
  playMp3('assets/steal.mp3', 1.0).catch(() => {});
  // Also play a synth coin-loss sound so it's always audible
  const c = getCtx();
  const osc = c.createOscillator();
  const g = sfxGain(0.4);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(200, c.currentTime + 0.15);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.18);
  osc.connect(g);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.18);
}

// Preload all MP3 SFX so first play is instant
export async function preloadSfx() {
  const c = getCtx();
  const urls = [
    'assets/coin.mp3', 'assets/steal.mp3', 'assets/levelup.mp3',
    'assets/zonecomplete.mp3', 'assets/winworld.mp3', 'assets/loose.mp3',
    'assets/kick.mp3'
  ];
  await Promise.all(urls.map(async (url) => {
    if (mp3Cache[url]) return;
    try {
      const resp = await fetch(url);
      const arrayBuf = await resp.arrayBuffer();
      mp3Cache[url] = await c.decodeAudioData(arrayBuf);
    } catch (e) { /* ignore missing files */ }
  }));
  // Also preload steal loop buffer
  await loadStealBuffer().catch(() => {});
}

// --- LOOPING STEAL SFX ---
let stealSource = null;
let stealBuffer = null;
let stealPlaying = false;

async function loadStealBuffer() {
  if (stealBuffer) return stealBuffer;
  const c = getCtx();
  const resp = await fetch('assets/steal.mp3');
  const arrayBuf = await resp.arrayBuffer();
  stealBuffer = await c.decodeAudioData(arrayBuf);
  return stealBuffer;
}

export async function startStealLoop() {
  if (stealPlaying) return;
  const c = getCtx();
  stealPlaying = true;
  const buf = await loadStealBuffer();
  if (!stealPlaying) return;
  stealSource = c.createBufferSource();
  stealSource.buffer = buf;
  stealSource.loop = true;
  stealSource.connect(sfxGainNode);
  stealSource.start();
}

export function stopStealLoop() {
  stealPlaying = false;
  if (stealSource) {
    try { stealSource.stop(); } catch(e) {}
    try { stealSource.disconnect(); } catch(e) {}
    stealSource = null;
  }
}

// --- BACKGROUND MUSIC (MP3 file, looping) ---
async function loadMusicBuffer() {
  if (musicBuffer) return musicBuffer;
  const c = getCtx();
  const resp = await fetch('assets/music.mp3');
  const arrayBuf = await resp.arrayBuffer();
  musicBuffer = await c.decodeAudioData(arrayBuf);
  return musicBuffer;
}

export async function startMusic() {
  if (musicPlaying) return;
  const c = getCtx();
  musicPlaying = true;

  const buf = await loadMusicBuffer();
  if (!musicPlaying) return; // stopped while loading

  musicSource = c.createBufferSource();
  musicSource.buffer = buf;
  musicSource.loop = true;
  musicSource.connect(musicGain);
  musicSource.start();
}

export function stopMusic() {
  musicPlaying = false;
  if (musicSource) {
    try { musicSource.stop(); } catch(e) {}
    try { musicSource.disconnect(); } catch(e) {}
    musicSource = null;
  }
}

// --- BRAWLER KICK SFX ---
export function playBrawlerKick() {
  playMp3('assets/kick.mp3', 0.7);
}

export function playKickLand() {
  const c = getCtx();
  const t = c.currentTime;

  // Layer 1: heavy bass impact (50Hz, 100ms)
  const bass = c.createOscillator();
  const gb = sfxGain(0.35);
  bass.type = 'sine';
  bass.frequency.setValueAtTime(50, t);
  bass.frequency.exponentialRampToValueAtTime(25, t + 0.1);
  gb.gain.setValueAtTime(0.35, t);
  gb.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  bass.connect(gb);
  bass.start(t);
  bass.stop(t + 0.12);

  // Layer 2: noise burst (30ms) — crash debris
  const noiseLen = c.sampleRate * 0.03;
  const noiseBuf = c.createBuffer(1, noiseLen, c.sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen);
  const noiseSrc = c.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  const gn = sfxGain(0.25);
  noiseSrc.connect(gn);
  noiseSrc.start(t);

  // Layer 3: sub rumble (35Hz, 80ms) — ground shake
  const rumble = c.createOscillator();
  const gr = sfxGain(0.2);
  rumble.type = 'sine';
  rumble.frequency.setValueAtTime(35, t + 0.01);
  rumble.frequency.exponentialRampToValueAtTime(20, t + 0.09);
  gr.gain.setValueAtTime(0.2, t + 0.01);
  gr.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  rumble.connect(gr);
  rumble.start(t);
  rumble.stop(t + 0.1);
}

// --- GARLIC TICK SFX ---
export function playGarlicTick() {
  const c = getCtx();
  const t = c.currentTime;
  const pitchMult = 0.9 + Math.random() * 0.2; // slight randomization
  const osc = c.createOscillator();
  const g = sfxGain(0.06);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(200 * pitchMult, t);
  g.gain.setValueAtTime(0.06, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  osc.connect(g);
  osc.start(t);
  osc.stop(t + 0.035);
}

// --- LOW-HP HEARTBEAT WARNING ---
let heartbeatOsc = null;
let heartbeatGain = null;
let heartbeatLFO = null;
let heartbeatActive = false;
let heartbeatBPM = 60;

/**
 * Update the low-HP heartbeat warning. Call each frame with current HP ratio (0..1).
 * Below 25% HP: plays a subtle low-frequency pulse that speeds up as HP drops.
 * Above 25%: silences the warning.
 */
export function updateLowHPWarning(hpPercent) {
  const threshold = 0.25;

  if (hpPercent >= threshold || hpPercent <= 0) {
    // Stop heartbeat
    if (heartbeatActive) {
      stopLowHPWarning();
    }
    return;
  }

  // HP is below 25% — calculate tempo
  // hpPercent goes from 0.25 (just entered danger) down to ~0.01
  // Map to BPM: 60 at 25% → 140 at 5% (clamped)
  const t = 1 - Math.max(0, (hpPercent - 0.05) / (threshold - 0.05)); // 0 at 25%, 1 at 5%
  const targetBPM = 60 + t * 80; // 60..140 BPM

  if (!heartbeatActive) {
    _startHeartbeat(targetBPM);
  } else {
    // Smoothly update tempo
    _updateHeartbeatTempo(targetBPM);
  }
}

function _startHeartbeat(bpm) {
  const c = getCtx();
  heartbeatActive = true;
  heartbeatBPM = bpm;

  // Main oscillator: low sine for the "thump"
  heartbeatOsc = c.createOscillator();
  heartbeatOsc.type = 'sine';
  heartbeatOsc.frequency.value = 45; // very low, sub-bass heartbeat

  // Gain node — kept quiet (30% of SFX volume)
  heartbeatGain = c.createGain();
  heartbeatGain.gain.value = 0; // LFO will modulate this

  // LFO (low-frequency oscillator) to create the pulsing rhythm
  heartbeatLFO = c.createOscillator();
  heartbeatLFO.type = 'sine';
  heartbeatLFO.frequency.value = bpm / 60; // convert BPM to Hz

  // LFO modulates gain: use a GainNode as a modulator
  const lfoGain = c.createGain();
  lfoGain.gain.value = 0.12; // pulse depth — subtle (30-40% of typical SFX at 0.3)
  heartbeatLFO._lfoGain = lfoGain;

  heartbeatLFO.connect(lfoGain);
  lfoGain.connect(heartbeatGain.gain);

  heartbeatOsc.connect(heartbeatGain);
  heartbeatGain.connect(sfxGainNode);

  heartbeatOsc.start();
  heartbeatLFO.start();
}

function _updateHeartbeatTempo(bpm) {
  if (!heartbeatLFO) return;
  const c = getCtx();
  heartbeatLFO.frequency.setTargetAtTime(bpm / 60, c.currentTime, 0.1);
  heartbeatBPM = bpm;
}

export function stopLowHPWarning() {
  heartbeatActive = false;
  if (heartbeatOsc) {
    try { heartbeatOsc.stop(); } catch(e) {}
    try { heartbeatOsc.disconnect(); } catch(e) {}
    heartbeatOsc = null;
  }
  if (heartbeatLFO) {
    try { heartbeatLFO.stop(); } catch(e) {}
    try { heartbeatLFO.disconnect(); } catch(e) {}
    if (heartbeatLFO._lfoGain) {
      try { heartbeatLFO._lfoGain.disconnect(); } catch(e) {}
    }
    heartbeatLFO = null;
  }
  if (heartbeatGain) {
    try { heartbeatGain.disconnect(); } catch(e) {}
    heartbeatGain = null;
  }
}
