import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { buildShip } from './ship.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#353a68');
scene.fog = new THREE.Fog('#353a68', 20, 80);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(-6, 1.6, 0);

scene.add(new THREE.HemisphereLight('#ffd58a', '#2d3459', 1.2));
const sun = new THREE.DirectionalLight('#ffffff', 1.2);
sun.position.set(5, 10, 3);
scene.add(sun);

const ship = buildShip();
scene.add(ship);

// Click to play: mouse look needs pointer lock
const controls = new PointerLockControls(camera, document.body);
const startScreen = document.getElementById('start');
startScreen.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => (startScreen.style.display = 'none'));
controls.addEventListener('unlock', () => (startScreen.style.display = 'flex'));

const keys = {};
addEventListener('keydown', (e) => (keys[e.code] = true));
addEventListener('keyup', (e) => (keys[e.code] = false));

const clock = new THREE.Clock();
function loop() {
  const dt = clock.getDelta();
  const t = clock.elapsedTime;

  if (controls.isLocked) {
    const speed = 4 * dt;
    if (keys.KeyW) controls.moveForward(speed);
    if (keys.KeyS) controls.moveForward(-speed);
    if (keys.KeyD) controls.moveRight(speed);
    if (keys.KeyA) controls.moveRight(-speed);
  }

  // The ship rocks in the storm
  ship.rotation.z = Math.sin(t * 0.8) * 0.06;
  ship.rotation.x = Math.sin(t * 0.5) * 0.03;

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
