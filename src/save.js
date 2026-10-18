// The only file that touches storage. localStorage today, Steam Cloud
// later: everything else calls load() and save(data).

const KEY = 'patchitup.save';

export function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    return {}; // a private window, or something older stored under this key
  }
}

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage can be blocked; losing a remembered name is not worth a crash.
  }
}
