// The player: a 0.4 m sphere with the camera at eye height inside it.
// You never see your own sphere, only the other players'.

import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

export const PLAYER = {
  radius: 0.4,
  eyeHeight: 1.5,
  speed: 4, // metres per second
  jumpSpeed: 4.6,
  gravity: 14,
};

export const ROLE_COLORS = {
  mechanic: '#e2574c',
  engineer: '#49b97a',
  pilot: '#4a86e8',
  crew: '#d9d2c5', // before a role is picked (step 6)
};

// A sphere with two eyes, so the others can tell which way you face.
export function createPlayerMesh(color = ROLE_COLORS.crew) {
  const body = new THREE.Group();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(PLAYER.radius, 20, 14),
    new THREE.MeshStandardMaterial({ color, flatShading: true })
  );
  body.userData.sphere = sphere; // so the role colour can change later
  body.add(sphere);

  const white = new THREE.MeshStandardMaterial({ color: '#fff4dc', flatShading: true });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), white);
    eye.position.set(side * 0.15, 0.1, -0.33); // -z is the way you look
    body.add(eye);
  }
  return body;
}

// Everything lives in the ship's local space, so when the ship rocks the
// player rocks with it: the mesh and the camera are both children of the ship.
export class LocalPlayer {
  constructor({ ship, camera, colliders, role = 'mechanic' }) {
    this.ship = ship;
    this.camera = camera;
    this.colliders = colliders;
    this.mesh = createPlayerMesh(ROLE_COLORS[role] ?? ROLE_COLORS.crew);
    this.mesh.visible = false; // your own sphere stays out of your way
    ship.add(this.mesh);

    this.role = role;
    this.atWheel = false; // at the wheel A and D steer instead of walking
    this.position = new THREE.Vector3(0, PLAYER.radius, 0);
    this.velocityY = 0;
    this.onGround = true;
    this.keys = {};

    this.controls = new PointerLockControls(camera, document.body);
    this.controls.addEventListener('unlock', () => (this.keys = {}));

    addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Space' && this.controls.isLocked) e.preventDefault();
    });
    addEventListener('keyup', (e) => (this.keys[e.code] = false));

    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._move = new THREE.Vector3();
    this._candidate = new THREE.Vector3();
    this._sphere = new THREE.Sphere(new THREE.Vector3(), PLAYER.radius);
  }

  // Step aboard at a spot in ship space, camera parented to the ship.
  enter(x, z, lookY = -Math.PI / 2) {
    this.position.set(x, PLAYER.radius, z);
    this.velocityY = 0;
    this.onGround = true;
    this.keys = {};
    this.ship.add(this.camera);
    this.camera.rotation.set(0, lookY, 0);
    this.syncView();
  }

  // Back to the menu: the camera leaves the ship and orbits again.
  exit(scene) {
    this.keys = {};
    scene.add(this.camera);
  }

  setRole(role) {
    this.role = role;
    this.mesh.userData.sphere.material.color.set(ROLE_COLORS[role] ?? ROLE_COLORS.crew);
  }

  update(dt) {
    if (!this.controls.isLocked) return;
    const { keys } = this;

    // Walk along the way you are looking, flat to the deck.
    this._forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this._forward.y = 0;
    this._forward.normalize();
    this._right.crossVectors(this._forward, this.camera.up).normalize();

    // At the wheel your feet stay planted: A and D steer instead (game.js).
    this._move.set(0, 0, 0);
    if (!this.atWheel) {
      if (keys.KeyW) this._move.add(this._forward);
      if (keys.KeyS) this._move.sub(this._forward);
      if (keys.KeyD) this._move.add(this._right);
      if (keys.KeyA) this._move.sub(this._right);
    }
    if (this._move.lengthSq() > 0) {
      this._move.normalize().multiplyScalar(PLAYER.speed * dt);
      // X and Z separately, so a wall you graze lets you slide along it.
      this.tryMove(this._move.x, 0, 0);
      this.tryMove(0, 0, this._move.z);
    }

    if (keys.Space && this.onGround && !this.atWheel) {
      this.velocityY = PLAYER.jumpSpeed;
      this.onGround = false;
    }
    this.velocityY -= PLAYER.gravity * dt;
    this.onGround = false;
    this.tryMove(0, this.velocityY * dt, 0);

    // The deck itself is not a collider: a sphere resting on it would
    // overlap and block every step. It is a floor height instead.
    if (this.position.y < PLAYER.radius) {
      this.position.y = PLAYER.radius;
      this.velocityY = 0;
      this.onGround = true;
    }

    this.syncView();
  }

  // Move if nothing solid is in the way, otherwise stay put on that axis.
  tryMove(dx, dy, dz) {
    this._candidate.set(this.position.x + dx, this.position.y + dy, this.position.z + dz);
    this._sphere.center.copy(this._candidate);
    if (this.colliders.some((box) => box.intersectsSphere(this._sphere))) {
      if (dy !== 0) {
        if (this.velocityY < 0) this.onGround = true; // landed on something solid
        this.velocityY = 0;
      }
      return false;
    }
    this.position.copy(this._candidate);
    return true;
  }

  syncView() {
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.camera.rotation.y;
    this.camera.position.set(
      this.position.x,
      this.position.y + PLAYER.eyeHeight - PLAYER.radius,
      this.position.z
    );
  }
}
