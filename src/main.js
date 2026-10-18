// Creates the renderer and camera, runs the loop, switches screens.

import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { buildShip } from './ship.js';
import { showScreen, currentScreen } from './screens.js';
import { initMenu, playerName } from './menu.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#353a68');
scene.fog = new THREE.Fog('#353a68', 20, 120);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 400);

scene.add(new THREE.HemisphereLight('#ffd58a', '#2d3459', 1.2));
const sun = new THREE.DirectionalLight('#ffffff', 1.2);
sun.position.set(5, 10, 3);
scene.add(sun);

const ship = buildShip();
scene.add(ship);

// Walking around is the step 3 job of player.js; this is the prototype kept alive
// so "Host game" and "Climb aboard" lead somewhere you can run.
const controls = new PointerLockControls(camera, document.body);
const lockOverlay = document.getElementById('lockOverlay');
const keys = {};

controls.addEventListener('lock', () => (lockOverlay.hidden = true));
controls.addEventListener('unlock', () => {
  if (currentScreen() === 'flight') lockOverlay.hidden = false;
});

document.getElementById('clickToPlay').addEventListener('click', () => controls.lock());
document.getElementById('leaveShip').addEventListener('click', () => {
  controls.unlock();
  showScreen('menu');
});

addEventListener('keydown', (e) => (keys[e.code] = true));
addEventListener('keyup', (e) => (keys[e.code] = false));

initMenu({
  onHost: () => {
    // Step 5 creates the room here and hands the code out in the lobby.
    console.log(`${playerName()} is hosting`);
    boardShip();
  },
  onJoin: (code) => {
    // Step 5 connects to the host with this code.
    console.log(`${playerName()} is joining ${code}`);
    boardShip();
  },
});

function boardShip() {
  camera.position.set(-6, 1.6, 0);
  camera.rotation.set(0, -Math.PI / 2, 0);
  lockOverlay.hidden = false;
  showScreen('flight');
}

// Behind the menu: the ship turns slowly, seen from outside and from above,
// far enough back that the hull reads around the menu panel.
function orbitShip(t) {
  const angle = t * 0.08;
  camera.position.set(Math.cos(angle) * 32, 9, Math.sin(angle) * 32);
  camera.lookAt(0, 2, 0);
  // Turn away a little so the ship sits beside the menu panel, not behind it.
  camera.rotation.y += 0.42;
}

function walk(dt) {
  const step = 4 * dt;
  if (keys.KeyW) controls.moveForward(step);
  if (keys.KeyS) controls.moveForward(-step);
  if (keys.KeyD) controls.moveRight(step);
  if (keys.KeyA) controls.moveRight(-step);
}

const clock = new THREE.Clock();
function loop() {
  const dt = clock.getDelta();
  const t = clock.elapsedTime;

  // The ship rocks in the storm
  ship.rotation.z = Math.sin(t * 0.8) * 0.06;
  ship.rotation.x = Math.sin(t * 0.5) * 0.03;

  if (currentScreen() === 'flight') {
    if (controls.isLocked) walk(dt);
  } else {
    orbitShip(t);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

showScreen('menu');
loop();

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
