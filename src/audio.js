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
  const osc = c.createOscillator();
  const g = sfxGain(0.08);
  osc.type = 'square';
  osc.frequency.setValueAtTime(800, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(200, c.currentTime + 0.06);
  osc.connect(g);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.06);
}

export function playEnemyHit() {
  const c = getCtx();
  const osc = c.createOscillator();
  const g = sfxGain(0.12);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(300, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(80, c.currentTime + 0.1);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.1);
  osc.connect(g);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.1);
}

export function playEnemyKill() {
  const c = getCtx();
  const bufferSize = c.sampleRate * 0.08;
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const noise = c.createBufferSource();
  noise.buffer = buffer;
  const g = sfxGain(0.1);
  noise.connect(g);
  noise.start(c.currentTime);

  const osc = c.createOscillator();
  const g2 = sfxGain(0.08);
  osc.type = 'square';
  osc.frequency.setValueAtTime(600, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(100, c.currentTime + 0.12);
  g2.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.12);
  osc.connect(g2);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.12);
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

export function playLevelUp() {
  const c = getCtx();
  const notes = [523, 659, 784, 1047];
  notes.forEach((freq, i) => {
    const osc = c.createOscillator();
    const g = sfxGain(0.12);
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.001, c.currentTime + i * 0.1);
    g.gain.linearRampToValueAtTime(0.12, c.currentTime + i * 0.1 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + i * 0.1 + 0.25);
    osc.connect(g);
    osc.start(c.currentTime + i * 0.1);
    osc.stop(c.currentTime + i * 0.1 + 0.3);
  });
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

export function playVictory() {
  const c = getCtx();
  const melody = [523, 659, 784, 1047, 784, 1047];
  const durations = [0.15, 0.15, 0.15, 0.3, 0.15, 0.4];
  let time = c.currentTime;
  melody.forEach((freq, i) => {
    const osc = c.createOscillator();
    const g = sfxGain(0.15);
    osc.type = 'triangle';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.15, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + durations[i]);
    osc.connect(g);
    osc.start(time);
    osc.stop(time + durations[i] + 0.05);
    time += durations[i];
  });
}

export function playDefeat() {
  const c = getCtx();
  const osc = c.createOscillator();
  const g = sfxGain(0.15);
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(400, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(80, c.currentTime + 0.8);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 1.0);
  osc.connect(g);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 1.0);
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
