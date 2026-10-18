// Finds what you are looking at, shows "E · Patch" under the crosshair,
// and - on the host - runs the action for whichever player asked for it.
// One system for every station: lockers, levers, the wheel, breaches.

import * as THREE from 'three';
import { RULES } from './state.js';
import { PLAYER, lookDirection } from './player.js';
import { keyLabel, settings } from './settings.js';

const CENTRE = new THREE.Vector2(0, 0);
const DOT = '·';

// The nearest thing along the ray that carries userData.interact.
function firstInteractive(ship, raycaster) {
  for (const hit of raycaster.intersectObjects(ship.children, true)) {
    for (let node = hit.object; node && node !== ship; node = node.parent) {
      if (node.userData.interact) return node;
    }
  }
  return null;
}

// What this browser shows you: the prompt and the hold bar. The action
// itself belongs to the host, so nothing here changes the game.
export class InteractionView {
  // me() is this browser's player in the shared state; canUse(interact,
  // player) says why a station cannot be used right now, or null.
  constructor({ ship, camera, player, me, canUse }) {
    this.ship = ship;
    this.camera = camera;
    this.player = player;
    this.me = me;
    this.canUse = canUse;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = RULES.reach;
    this.target = null;
    this.held = 0;

    this.prompt = document.getElementById('prompt');
    this.progress = document.getElementById('progress');
    this.progressFill = document.getElementById('progressFill');
  }

  update(dt) {
    const locked = this.player.controls.isLocked;
    let target = null;
    if (locked) {
      this.raycaster.setFromCamera(CENTRE, this.camera);
      this.raycaster.far = RULES.reach;
      target = firstInteractive(this.ship, this.raycaster);
    }
    if (target !== this.target) {
      this.target = target;
      this.held = 0;
    }

    const interact = target?.userData.interact ?? null;
    const reason = interact ? this.canUse(interact, this.me()) : null;
    const allowed = Boolean(interact) && reason === null;
    this.showPrompt(interact, reason);

    // The bar is a mirror of the host's timer, not the timer itself.
    if (interact?.hold && allowed && this.player.isDown('interact') && locked) {
      this.held = Math.min(interact.hold, this.held + dt);
      this.showProgress(this.held / interact.hold);
    } else {
      this.held = 0;
      this.showProgress(0);
    }
  }

  showPrompt(interact, reason) {
    if (!interact) {
      this.prompt.hidden = true;
      return;
    }
    this.prompt.hidden = false;
    this.prompt.classList.toggle('denied', reason !== null);
    const key = keyLabel(settings.keys.interact);
    this.prompt.textContent = reason ?? `${key} ${DOT} ${interact.label}`;
  }

  showProgress(fraction) {
    this.progress.hidden = fraction <= 0;
    this.progressFill.style.width = `${Math.round(fraction * 100)}%`;
  }
}

// The host's copy: one ray per player, from where that player stands and
// along the direction their last input said they were looking.
export class HostInteractions {
  constructor(ship) {
    this.ship = ship;
    this.raycaster = new THREE.Raycaster();
    this.holds = new Map(); // player id -> { target, time }
    this._origin = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
  }

  update(dt, players, bodies, inputs, { canUse, run }) {
    for (const player of Object.values(players)) {
      const body = bodies.get(player.id);
      const input = inputs.get(player.id);
      if (!body || !input) continue;

      const target = this.lookFrom(body, input);
      const interact = target?.userData.interact ?? null;
      if (!interact || canUse(interact, player) !== null) {
        this.holds.delete(player.id);
        input.useTap = false;
        continue;
      }

      if (interact.hold) {
        if (!input.use) {
          this.holds.delete(player.id);
        } else {
          const previous = this.holds.get(player.id);
          const time = (previous?.target === target ? previous.time : 0) + dt;
          if (time >= interact.hold) {
            this.holds.delete(player.id);
            run(interact, player, body);
          } else {
            this.holds.set(player.id, { target, time });
          }
        }
      } else if (input.useTap) {
        run(interact, player, body);
      }
      input.useTap = false; // one tap, one action
    }
  }

  lookFrom(body, input) {
    this._origin.set(
      body.position.x,
      body.position.y + PLAYER.eyeHeight - PLAYER.radius,
      body.position.z
    );
    this.ship.localToWorld(this._origin);
    lookDirection(input.yaw ?? 0, input.pitch ?? 0, this._dir)
      .applyQuaternion(this.ship.getWorldQuaternion(this._quaternion))
      .normalize();
    this.raycaster.set(this._origin, this._dir);
    this.raycaster.far = RULES.reach;
    return firstInteractive(this.ship, this.raycaster);
  }
}
