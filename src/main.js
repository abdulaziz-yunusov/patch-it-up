// Creates the renderer and camera, runs the loop, switches screens.

import * as THREE from 'three';
import { buildShip, addLights, addSky, applyState, HELM_STANCE } from './world.js';
import { LocalPlayer } from './player.js';
import { Interactor } from './interact.js';
import { state } from './state.js';
import * as game from './game.js';
import { showScreen, currentScreen } from './screens.js';
import { initMenu, playerName } from './menu.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
addSky(scene);
addLights(scene);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 400);

const world = buildShip();
const ship = world.ship;
scene.add(ship);

// One local player for now; the other two arrive over the network in step 5.
const player = new LocalPlayer({ ship, camera, colliders: world.colliders, role: state.role });

const interactor = new Interactor({
  camera,
  ship,
  player,
  mayUse: (interact) => game.mayUse(interact, player.role),
  handlers: {
    patch: (interact) => game.patchBreach(interact.id),
    power: (interact) => game.movePower(interact.index),
    wheel: () => {
      // Taking the wheel plants you behind it, facing the bow.
      if (game.toggleWheel()) player.enter(HELM_STANCE.x, HELM_STANCE.z, HELM_STANCE.look);
    },
    pickup: (interact, target, io) => io.pickUp(target),
  },
});

const lockOverlay = document.getElementById('lockOverlay');
const statusLine = document.getElementById('status');

player.controls.addEventListener('lock', () => (lockOverlay.hidden = true));
player.controls.addEventListener('unlock', () => {
  if (currentScreen() === 'flight') lockOverlay.hidden = false;
});

document.getElementById('clickToPlay').addEventListener('click', () => player.controls.lock());
document.getElementById('leaveShip').addEventListener('click', () => {
  player.controls.unlock();
  interactor.drop();
  state.atWheel = false;
  player.exit(scene);
  showScreen('menu');
});

// Until the lobby hands out roles (step 6), 1 2 3 switch between them.
const ROLE_KEYS = { Digit1: 'mechanic', Digit2: 'engineer', Digit3: 'pilot' };
addEventListener('keydown', (e) => {
  const role = ROLE_KEYS[e.code];
  if (!role || currentScreen() !== 'flight') return;
  player.setRole(role);
  state.role = role;
});

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
  // Stern of the engine room, facing the bow.
  player.enter(-10, 0);
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

const clock = new THREE.Clock();
function loop() {
  const dt = clock.getDelta();
  const t = clock.elapsedTime;

  // The ship rocks in the storm
  ship.rotation.z = Math.sin(t * 0.8) * 0.06;
  ship.rotation.x = Math.sin(t * 0.5) * 0.03;

  if (currentScreen() === 'flight') {
    player.atWheel = state.atWheel;
    player.update(dt);
    interactor.update(dt);
    if (state.atWheel) game.steer(dt, player.keys);
    updateStatus();
  } else {
    orbitShip(t);
  }

  // Every browser draws the scene from the state (the host owns it, step 5).
  applyState(world, state);

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

function updateStatus() {
  const role = player.role[0].toUpperCase() + player.role.slice(1);
  const parts = [role, `power ${state.power.join('-')}`, `helm ${state.steering.toFixed(2)}`];
  if (interactor.carried) parts.push('carrying patch kit');
  statusLine.textContent = parts.join(' · ');
}

// Dev-only handle for driving the game from the console or a test script.
// The F3 debug view of the plan's testing notes can hang off this later.
if (import.meta.env.DEV) {
  window.patch = { scene, camera, ship, world, player, interactor, state, game, THREE };
}

showScreen('menu');
loop();

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
