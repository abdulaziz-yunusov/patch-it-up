// Finds what you are looking at, shows "E - Patch" under the crosshair,
// and runs the action. One system for every station: lockers, levers,
// the wheel, breaches.

import * as THREE from 'three';
import { RULES } from './state.js';

const CENTRE = new THREE.Vector2(0, 0);
const DOT = '·';

export class Interactor {
  // handlers: { patch, power, wheel, pickup } - what each action name does.
  constructor({ camera, ship, player, handlers, mayUse }) {
    this.camera = camera;
    this.ship = ship;
    this.player = player;
    this.handlers = handlers;
    this.mayUse = mayUse;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = RULES.reach;
    this.target = null; // the mesh under the crosshair
    this.held = 0; // seconds E has been held on this target
    this.pressed = false;
    this.tapped = false; // a tap shorter than one frame must still count
    this.carried = null;

    this.prompt = document.getElementById('prompt');
    this.progress = document.getElementById('progress');
    this.progressFill = document.getElementById('progressFill');

    // E comes from the events, not a per-frame poll: a quick tap can begin
    // and end between two frames and would otherwise be missed.
    addEventListener('keydown', (e) => {
      if (e.code !== 'KeyE' || e.repeat) return;
      this.pressed = true;
      this.tapped = true;
    });
    addEventListener('keyup', (e) => {
      if (e.code === 'KeyE') this.pressed = false;
    });
    player.controls.addEventListener('unlock', () => {
      this.pressed = false;
      this.tapped = false;
    });

    // Right click drops what you carry; the browser menu would eat it.
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousedown', (e) => {
      if (e.button === 2) this.drop();
    });
  }

  update(dt) {
    const locked = this.player.controls.isLocked;
    const holding = this.pressed && locked;
    const tapped = this.tapped && locked;
    this.tapped = false;

    const target = locked ? this.findTarget() : null;
    if (target !== this.target) {
      this.target = target;
      this.held = 0;
    }

    const interact = target?.userData.interact ?? null;
    const allowed = interact ? this.mayUse(interact) : false;
    this.showPrompt(interact, allowed);

    if (interact && allowed) {
      if (interact.hold) this.holdAction(interact, target, holding, dt);
      else if (tapped) this.run(interact, target);
    } else {
      this.held = 0;
      this.showProgress(0);
    }
  }

  // A ray straight out of the middle of the screen, 2.5 m long.
  findTarget() {
    this.raycaster.setFromCamera(CENTRE, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.ship.children, true)) {
      for (let node = hit.object; node; node = node.parent) {
        if (node.userData.interact) return node;
        if (node === this.ship) break;
      }
    }
    return null;
  }

  holdAction(interact, target, pressed, dt) {
    if (!pressed) {
      this.held = 0;
      this.showProgress(0);
      return;
    }
    this.held += dt;
    this.showProgress(Math.min(1, this.held / interact.hold));
    if (this.held >= interact.hold) {
      this.held = 0;
      this.showProgress(0);
      this.run(interact, target);
    }
  }

  run(interact, target) {
    const handler = this.handlers[interact.action];
    if (handler) handler(interact, target, this);
  }

  // Carrying: one item at a time, stuck in front of the camera.
  pickUp(mesh) {
    if (this.carried) return false;
    this.carried = mesh;
    mesh.userData.homeY = mesh.position.y;
    this.camera.add(mesh);
    mesh.position.set(0.48, -0.4, -1);
    mesh.rotation.set(0, 0.5, 0);
    return true;
  }

  drop() {
    const mesh = this.carried;
    if (!mesh) return false;
    this.carried = null;
    this.ship.add(mesh);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    forward.y = 0;
    forward.normalize().multiplyScalar(0.8);
    mesh.position.copy(this.player.position).add(forward);
    mesh.position.y = mesh.userData.homeY ?? 0.2;
    mesh.rotation.set(0, 0, 0);
    return true;
  }

  showPrompt(interact, allowed) {
    if (!interact) {
      this.prompt.hidden = true;
      return;
    }
    const role = interact.role ? interact.role[0].toUpperCase() + interact.role.slice(1) : '';
    this.prompt.hidden = false;
    this.prompt.classList.toggle('denied', !allowed);
    this.prompt.textContent = allowed ? `E ${DOT} ${interact.label}` : `${role} only`;
  }

  showProgress(fraction) {
    this.progress.hidden = fraction <= 0;
    this.progressFill.style.width = `${Math.round(fraction * 100)}%`;
  }
}
