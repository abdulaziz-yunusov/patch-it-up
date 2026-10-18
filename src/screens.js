// Shows one HTML screen at a time: menu, join, flight, result.

let current = 'menu';

export function showScreen(name) {
  document.querySelectorAll('.screen').forEach((el) => (el.hidden = el.id !== name));
  current = name;
}

export function currentScreen() {
  return current;
}
