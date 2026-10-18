// Tiny sound player for one-shot effects in public/sounds/.
// Browsers only allow sound after a click, which "Click to play" gives us.

import { settings } from './settings.js';

const BASE = `${import.meta.env.BASE_URL}sounds/`;
const cache = new Map();

export function play(name, volume = 0.6) {
  let audio = cache.get(name);
  if (!audio) {
    audio = new Audio(`${BASE}${name}.wav`);
    cache.set(name, audio);
  }
  // The settings' master and sound-effect sliders scale every sound.
  const level = volume * (settings.master / 100) * (settings.sfx / 100);
  if (level <= 0) return;
  const shot = audio.cloneNode(); // lets the same sound overlap itself
  shot.volume = Math.min(1, level);
  shot.play().catch(() => {}); // blocked before the first click: fine
}
