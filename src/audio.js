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
    'assets/zonecomplete.mp3', 'assets/winworld.mp3', 'assets/loose.mp3'
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
