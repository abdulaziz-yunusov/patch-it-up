// A steady heartbeat that keeps going when the page is out of sight.
//
// requestAnimationFrame stops altogether in a hidden tab, a minimised
// window, and (on Windows) a window covered by another; the page's own
// timers slow to once a second or worse. A worker's timer keeps its pace,
// so the host keeps the ship flying and a joiner keeps its seat while
// someone glances at another window.

export function startPulse(hz, beat) {
  const period = Math.round(1000 / hz);
  try {
    const source = `setInterval(() => postMessage(0), ${period});`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    worker.onmessage = () => beat();
    return;
  } catch {
    // No workers here: a page timer still beats, if more slowly when hidden.
  }
  setInterval(beat, period);
}
