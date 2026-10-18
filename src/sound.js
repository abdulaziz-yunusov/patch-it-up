// Tiny sound player for one-shot effects in public/sounds/.
// Browsers only allow sound after a click, which "Click to play" gives us.

const BASE = `${import.meta.env.BASE_URL}sounds/`;
const cache = new Map();

export function play(name, volume = 0.6) {
  let audio = cache.get(name);
  if (!audio) {
    audio = new Audio(`${BASE}${name}.wav`);
    cache.set(name, audio);
  }
  const shot = audio.cloneNode(); // lets the same sound overlap itself
  shot.volume = volume;
  shot.play().catch(() => {}); // blocked before the first click: fine
}
