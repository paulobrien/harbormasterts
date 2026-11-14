import { importIpa, type GameAssets } from './importer';
import { fetchBundledGame } from './bundled';
import { createGame, saveLevelForAssets, type GameController } from './game';
import { readShiftSave, writeShiftSave, clearShiftSave, type ShiftSave } from './shift-save';
import { readShiftStats, ShiftRecorder, type ShiftStats } from './stats';

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI: ${selector}`);
  return element;
};
const welcome = $<HTMLElement>('#welcome');
const screen = $<HTMLElement>('#game-screen');
const input = $<HTMLInputElement>('#file-input');
const status = $<HTMLElement>('#status');
const choose = $<HTMLButtonElement>('#choose-label');
const play = $<HTMLButtonElement>('#play');
const continueShift = $<HTMLButtonElement>('#continue-shift');
const install = $<HTMLButtonElement>('#install');
const change = $<HTMLButtonElement>('#change-file');
const score = $<HTMLElement>('#score');
const canvas = $<HTMLCanvasElement>('#canvas');
const overlay = $<HTMLElement>('#overlay');
const overlayTitle = $<HTMLElement>('#overlay-title');
const overlayText = $<HTMLElement>('#overlay-text');
const resumeButton = $<HTMLButtonElement>('#resume');
const restartButton = $<HTMLButtonElement>('#restart');
const muteButton = $<HTMLButtonElement>('#mute');
const fastForwardButton = $<HTMLButtonElement>('#fast-forward');
const settings = $<HTMLDialogElement>('#settings');
const musicSlider = $<HTMLInputElement>('#music-volume');
const effectsSlider = $<HTMLInputElement>('#effects-volume');
const autoDocking = $<HTMLInputElement>('#auto-docking');
// Accessing localStorage itself can throw, not just its methods. Keep the
// game usable and let persistence helpers report failed writes accurately.
function storageUnavailable() {
  document.querySelectorAll<HTMLElement>('[data-storage-warning]').forEach(element => { element.hidden = false; });
}
const localStore: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem(key) { try { return window.localStorage.getItem(key); } catch (error) { storageUnavailable(); throw error; } },
  setItem(key, value) { try { window.localStorage.setItem(key, value); } catch (error) { storageUnavailable(); throw error; } },
  removeItem(key) { try { window.localStorage.removeItem(key); } catch (error) { storageUnavailable(); throw error; } },
};
function readPreference(key: string): string | null {
  try { return localStore.getItem(key); } catch { return null; }
}
function writePreference(key: string, value: string): void {
  try { localStore.setItem(key, value); } catch { /* The current setting still works for this visit. */ }
}
let assets: GameAssets | undefined;
let controller: GameController | undefined;
let soundtrack: HTMLAudioElement | undefined;
let soundtrackUrl: string | undefined;
let muted = readPreference('harbor-muted') === '1';
let effectsMuted = readPreference('harbor-effects-muted') === '1';
function savedVolume(key: string, fallback: number): number {
  const value = readPreference(key);
  if (value === null) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}
let musicVolume = savedVolume('harbor-music-volume', .55);
let effectsVolume = savedVolume('harbor-effects-volume', .65);
let autoDockEnabled = readPreference('harbor-auto-dock') !== '0';
let fastForwardEnabled = false;
function setFastForward(enabled: boolean) {
  fastForwardEnabled = enabled;
  fastForwardButton.setAttribute('aria-pressed', String(enabled));
  controller?.setFastForward(enabled);
}
let shiftRecorder = new ShiftRecorder(localStore);
let currentShiftId = '';
let savedShift: ShiftSave | null = null;
let saveProblem = false;
const newShiftId = () => typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
function refreshContinue() {
  if (!assets) { savedShift = null; continueShift.hidden = true; return; }
  try {
    const found = readShiftSave(saveLevelForAssets(assets.levelText), localStore);
    savedShift = found?.pressure && found.activePacing ? found : null;
  } catch { savedShift = null; }
  continueShift.hidden = !savedShift;
  play.textContent = savedShift ? 'Start a new shift' : 'Play Treasure Island';
  play.classList.toggle('button-primary', !savedShift);
  play.classList.toggle('button-outline', !!savedShift);
}
function persistActiveShift(): boolean {
  if (!controller || !assets || ended || !currentShiftId) return false;
  const snapshot = controller.snapshot(currentShiftId);
  const saved = snapshot !== null && writeShiftSave(snapshot, saveLevelForAssets(assets.levelText), localStore);
  saveProblem = !saved;
  return saved;
}
let isPaused = false;
let ended = false;
let installPrompt: (Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }) | undefined;

function setStatus(text: string) { status.textContent = text; }
function showStats(stats: ShiftStats = readShiftStats(localStore)) {
  $<HTMLElement>('#shift-stats').hidden = stats.shifts === 0;
  $<HTMLElement>('#best-shift').textContent = String(stats.best);
  $<HTMLElement>('#avg-shift').textContent = String(stats.shifts ? Math.floor(stats.totalCargo / stats.shifts) : 0);
  $<HTMLElement>('#shifts-worked').textContent = String(stats.shifts);
  $<HTMLElement>('#total-cargo').textContent = String(stats.totalCargo);
}
showStats();
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('harbor-master-standalone', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function readStored(): Promise<File | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('files', 'readonly').objectStore('files').get('hd-ipa');
    request.onsuccess = () => { db.close(); resolve(request.result as File | undefined); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}
async function storeFile(file: File): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite');
    transaction.objectStore('files').put(file, 'hd-ipa');
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}
function syncMute() {
  muteButton.textContent = muted ? '♪̸' : '♫';
  muteButton.title = muted ? 'Unmute music' : 'Mute music';
  muteButton.setAttribute('aria-label', muteButton.title);
  if (soundtrack) soundtrack.muted = muted;
}
async function load(file: File, shouldStore: boolean): Promise<boolean> {
  setStatus('Getting the harbor ready…');
  choose.disabled = true;
  change.disabled = true;
  input.disabled = true;
  play.disabled = true;
  continueShift.disabled = true;
  try {
    const loaded = await importIpa(file);
    // Validate the level before replacing a playable game in memory or storage.
    saveLevelForAssets(loaded.levelText);
    let saved = true;
    if (shouldStore) {
      try { await storeFile(file); } catch { saved = false; }
    }
    assets = loaded;
    setStatus(saved ? 'Your game is ready. Let’s set sail!' : 'Ready to play! This device could not save the game files. You may need to add them again next time.');
    choose.hidden = true;
    play.hidden = false;
    change.hidden = false;
    refreshContinue();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read this file. Please try the Harbor Master HD IPA.';
    if (assets) {
      choose.hidden = true;
      change.hidden = false;
      play.hidden = false;
      refreshContinue();
      setStatus(`${message} Your previous game is still available.`);
    } else {
      savedShift = null;
      continueShift.hidden = true;
      choose.hidden = false;
      change.hidden = true;
      play.hidden = true;
      setStatus(message);
    }
    return false;
  } finally {
    choose.disabled = false;
    change.disabled = false;
    input.disabled = false;
    play.disabled = false;
    continueShift.disabled = false;
    input.value = '';
  }
}
function showPause(title: string, text: string, gameOver = false) {
  isPaused = !gameOver;
  ended = gameOver;
  controller?.pause();
  if (!gameOver) persistActiveShift();
  soundtrack?.pause();
  overlayTitle.textContent = title;
  overlayText.textContent = text + (!gameOver && saveProblem ? ' This shift could not be saved on this device.' : '');
  resumeButton.hidden = gameOver;
  restartButton.hidden = !gameOver;
  overlay.hidden = false;
}
function begin(restoreShift: ShiftSave | null = null) {
  if (!assets) return;
  setFastForward(false);
  currentShiftId = restoreShift?.shiftId || newShiftId();
  saveProblem = false;
  welcome.hidden = true;
  screen.hidden = false;
  overlay.hidden = true;
  controller?.destroy();
  soundtrack?.pause();
  soundtrack?.remove();
  if (soundtrackUrl) URL.revokeObjectURL(soundtrackUrl);
  soundtrackUrl = URL.createObjectURL(assets.music);
  soundtrack = new Audio(soundtrackUrl);
  soundtrack.id = 'soundtrack';
  soundtrack.hidden = true;
  document.body.append(soundtrack);
  soundtrack.loop = true;
  soundtrack.volume = musicVolume;
  syncMute();
  void soundtrack.play().catch(() => { /* A later tap may be needed on some browsers. */ });
  shiftRecorder = new ShiftRecorder(localStore, currentShiftId);
  controller = createGame(canvas, assets, {
    onScore: n => { score.textContent = String(n); },
    onGameOver: n => {
      clearShiftSave(localStore);
      savedShift = null;
      const stats = shiftRecorder.complete(n);
      showStats(stats);
      showPause('Oh ship!', `The boats collided. You delivered ${n} cargo${n === 1 ? '' : 'es'}. Best shift: ${stats.best}.`, true);
    },
  });
  if (restoreShift && !controller.restore(restoreShift)) {
    controller.destroy(); controller = undefined;
    soundtrack.pause(); soundtrack.remove(); soundtrack = undefined;
    if (soundtrackUrl) URL.revokeObjectURL(soundtrackUrl);
    soundtrackUrl = undefined;
    screen.hidden = true; welcome.hidden = false;
    setStatus('The saved shift could not be restored. You can start a new shift.');
    refreshContinue();
    return;
  }
  isPaused = false;
  ended = false;
  controller.setEffectsVolume(effectsMuted ? 0 : effectsVolume);
  controller.setAutoDock(autoDockEnabled);
  controller.start();
}
input.addEventListener('change', () => { const file = input.files?.[0]; if (file) void load(file, true); });
choose.addEventListener('click', () => input.click());
change.addEventListener('click', () => input.click());
play.addEventListener('click', () => {
  if (savedShift && !window.confirm('Start a new shift? Your saved shift will be replaced.')) return;
  clearShiftSave(localStore); savedShift = null;
  begin();
});
continueShift.addEventListener('click', () => { if (savedShift) begin(savedShift); });
$<HTMLButtonElement>('#pause').addEventListener('click', () => showPause('Paused', 'The harbor can wait a moment.'));
resumeButton.addEventListener('click', () => {
  if (!controller) return;
  overlay.hidden = true;
  isPaused = false;
  controller.resume();
  void soundtrack?.play().catch(() => {});
});
restartButton.addEventListener('click', () => {
  overlay.hidden = true;
  isPaused = false;
  ended = false;
  clearShiftSave(localStore); savedShift = null; currentShiftId = newShiftId();
  shiftRecorder = new ShiftRecorder(localStore, currentShiftId);
  controller?.restart();
  setFastForward(false);
  void soundtrack?.play().catch(() => {});
});
fastForwardButton.addEventListener('click', () => setFastForward(!fastForwardEnabled));
$<HTMLButtonElement>('#home').addEventListener('click', () => {
  if (controller && !ended) { controller.pause(); persistActiveShift(); }
  controller?.destroy(); controller = undefined;
  soundtrack?.pause();
  soundtrack?.remove();
  soundtrack = undefined;
  if (soundtrackUrl) URL.revokeObjectURL(soundtrackUrl);
  soundtrackUrl = undefined;
  screen.hidden = true; welcome.hidden = false;
  refreshContinue();
  if (saveProblem) setStatus('Your shift could not be saved on this device.');
});
muteButton.addEventListener('click', () => {
  muted = !muted; writePreference('harbor-muted', muted ? '1' : '0'); syncMute();
  if (!muted && !isPaused && !ended) void soundtrack?.play().catch(() => {});
});
const effectsButton = $<HTMLButtonElement>('#effects');
function syncEffects() {
  effectsButton.textContent = effectsMuted ? '◖×' : '◖))';
  effectsButton.title = effectsMuted ? 'Unmute sound effects' : 'Mute sound effects';
  effectsButton.setAttribute('aria-label', effectsButton.title);
  controller?.setEffectsVolume(effectsMuted ? 0 : effectsVolume);
}
effectsButton.addEventListener('click', () => { effectsMuted = !effectsMuted; writePreference('harbor-effects-muted', effectsMuted ? '1' : '0'); syncEffects(); });
syncEffects();
function showSettings() {
  if (controller && !isPaused && !ended) showPause('Paused', 'The harbor can wait a moment.');
  if (!settings.open) settings.showModal();
}
function syncVolumes() {
  musicSlider.value = String(Math.round(musicVolume * 100));
  effectsSlider.value = String(Math.round(effectsVolume * 100));
  $<HTMLOutputElement>('#music-value').value = `${musicSlider.value}%`;
  $<HTMLOutputElement>('#effects-value').value = `${effectsSlider.value}%`;
  if (soundtrack) soundtrack.volume = musicVolume;
  controller?.setEffectsVolume(effectsMuted ? 0 : effectsVolume);
}
musicSlider.addEventListener('input', () => {
  musicVolume = Math.max(0, Math.min(100, Number(musicSlider.value))) / 100;
  writePreference('harbor-music-volume', String(musicVolume));
  syncVolumes();
});
effectsSlider.addEventListener('input', () => {
  effectsVolume = Math.max(0, Math.min(100, Number(effectsSlider.value))) / 100;
  writePreference('harbor-effects-volume', String(effectsVolume));
  syncVolumes();
});
autoDocking.checked = autoDockEnabled;
autoDocking.addEventListener('change', () => {
  autoDockEnabled = autoDocking.checked;
  writePreference('harbor-auto-dock', autoDockEnabled ? '1' : '0');
  controller?.setAutoDock(autoDockEnabled);
});
$<HTMLButtonElement>('#welcome-settings').addEventListener('click', showSettings);
$<HTMLButtonElement>('#game-settings').addEventListener('click', showSettings);
syncVolumes();
$<HTMLButtonElement>('#fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { /* Fullscreen support varies; installed apps request fullscreen via manifest. */ }
});
// Keep a recent state if the operating system closes the tablet app unexpectedly.
window.setInterval(() => { if (controller && !isPaused && !ended) persistActiveShift(); }, 5000);
window.addEventListener('pagehide', () => { if (controller && !ended) { controller.pause(); persistActiveShift(); } });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && controller && !isPaused && !ended) showPause('Paused', 'Welcome back when you’re ready.');
});
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event as typeof installPrompt;
  install.hidden = false;
});
install.addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = undefined; install.hidden = true;
});
window.addEventListener('appinstalled', () => { install.hidden = true; installPrompt = undefined; });
if ('serviceWorker' in navigator) window.addEventListener('load', () => { void navigator.serviceWorker.register('./sw.js').catch(() => {}); });
async function prepareGame(): Promise<void> {
  choose.hidden = true;
  setStatus('Getting the harbor ready…');
  try {
    const saved = await readStored().catch(() => undefined);
    if (saved && await load(saved, false)) return;
    const bundle = await fetchBundledGame();
    await load(bundle, true);
  } catch {
    choose.hidden = false;
    setStatus('Game files could not be loaded. Add your game files, or reconnect and try again.');
  }
}
void prepareGame();
