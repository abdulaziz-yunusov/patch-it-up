// The crew character (public/models/character.glb, built in
// art/character.blend) and the code that makes it move like a person.
//
// Nothing about the animation is sent over the network. Every browser
// watches how a player's position and facing change and works out the
// rest: which way the feet go, how fast they step, when they leave the
// ground and how hard they land. Only things that cannot be seen from
// movement (hammering, carrying, waving) come from the shared state.
//
// The layers, bottom to top:
//   1. Clips from Blender, split into a lower body (legs, hips) and an
//      upper body (spine, arms, head), so arms can carry or steer while
//      the legs keep walking.
//   2. Locomotion: idle / walk / run blended by speed. Walk and run are
//      stride-locked: their time comes from distance travelled, not the
//      clock, so feet do not slide at any speed.
//   3. Direction: when strafing the hips turn toward the movement and the
//      chest turns back to face forward; walking backwards plays the
//      cycle in reverse.
//   4. Air: jump while rising, fall while dropping, a landing that is as
//      deep as the fall was hard.
//   5. Turning on the spot: the body lags behind the head and catches up
//      with a little shuffle of the feet.
//   6. Procedural touches on top of the clips: head and chest follow the
//      look direction, a lean into turns and into speed changes.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const URL = `${import.meta.env?.BASE_URL ?? './'}models/character.glb`;

// Bone names as three.js sees them (GLTFLoader drops the dots).
const LOWER = new Set(['root', 'hips', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']);

// How far one full walk / run cycle (two steps) carries the character.
// Measured from the clips (how far the planted foot moves back per cycle),
// so the feet stay put on the ground at any speed.
const STRIDE = { walk: 1.14, run: 1.76 };

// Every other clip (Idle, Walk, Run, Jump, Fall, Steer, Carry, Hammer) loops.
const ONCE = ['Land', 'TurnStep', 'Reach', 'Wave'];

let template = null;
let loading = null;

// Load the model once; every crew member is a clone of it.
export function loadCharacter(url = URL) {
  if (!loading) {
    loading = new GLTFLoader()
      .loadAsync(url)
      .then((gltf) => {
        template = gltf;
        return gltf;
      })
      .catch((err) => {
        console.warn('Character model missing, players stay spheres:', err);
        return null;
      });
  }
  return loading;
}

export const characterReady = () => !!template;

// For tools and tests that load the file themselves.
export function useCharacterGltf(gltf) {
  template = gltf;
  loading = Promise.resolve(gltf);
}

// --- small maths helpers ------------------------------------------------

const clamp = THREE.MathUtils.clamp;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// Frame-rate independent easing toward a target.
const ease = (from, to, rate, dt) => from + (to - from) * (1 - Math.exp(-rate * dt));
const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const easeAngle = (from, to, rate, dt) => from + wrapAngle(to - from) * (1 - Math.exp(-rate * dt));

// A critically damped spring (like Unity's SmoothDamp): follows a moving
// target smoothly, never overshoots, and keeps its speed between frames,
// so a head that is already turning carries on turning instead of jerking.
function smoothDamp(state, key, target, smoothTime, dt, maxSpeed = Infinity) {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const velKey = `${key}Vel`;
  let change = state[key] - target;
  const maxChange = maxSpeed * smoothTime;
  change = clamp(change, -maxChange, maxChange);
  const temp = (state[velKey] + omega * change) * dt;
  state[velKey] = (state[velKey] - omega * temp) * decay;
  let out = state[key] - change + (change + temp) * decay;
  // never overshoot
  if ((target - state[key] > 0) === (out > target)) {
    out = target;
    state[velKey] = 0;
  }
  state[key] = out;
  return out;
}

// Eases into a limit instead of hitting a wall: small turns pass through
// unchanged, big ones flatten out near the limit.
const softLimit = (x, limit) => limit * Math.tanh(x / limit);

// Split a clip into the tracks for the lower and the upper body.
function splitClip(clip) {
  const lower = [];
  const upper = [];
  for (const track of clip.tracks) {
    const bone = track.name.split('.')[0];
    (LOWER.has(bone) ? lower : upper).push(track);
  }
  return {
    lower: new THREE.AnimationClip(`${clip.name}_lower`, clip.duration, lower),
    upper: new THREE.AnimationClip(`${clip.name}_upper`, clip.duration, upper),
  };
}

const _qParent = new THREE.Quaternion();
const _leanQ = new THREE.Quaternion();
const _leanP = new THREE.Vector3();
const _qRoot = new THREE.Quaternion();
const _qWant = new THREE.Quaternion();
const _qHead = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _qTurn = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

// Turn a bone about an axis given in the character's own space (not the
// bone's), whatever its parents are doing. This is what lets "look up"
// mean the same thing for the head whether it is standing or kneeling.
function turnBone(bone, axisModel, angle, frame) {
  if (!bone || Math.abs(angle) < 1e-5) return;
  frame.getWorldQuaternion(_qTurn);
  _axis.copy(axisModel).applyQuaternion(_qTurn);
  bone.parent.getWorldQuaternion(_qParent);
  _qTurn.setFromAxisAngle(_axis, angle);
  // parent⁻¹ · turn · parent: the world turn expressed in the parent's frame
  const local = _qParent.clone().invert().multiply(_qTurn).multiply(_qParent);
  bone.quaternion.premultiply(local);
  bone.updateMatrixWorld(true);
}

// --- one crew member ------------------------------------------------------

export class Character {
  // color: the shirt colour (role). The group sits where the player's
  // sphere centre is, like the old sphere did; the model's feet are below.
  // model: optional. Any model built on the crew skeleton (the sky pirates
  // in pirates.glb) can be passed in; it gets the crew's animations.
  constructor(color = '#d9d2c5', footOffset = 0.4, model = null) {
    if (!template) throw new Error('loadCharacter() first');
    this.root = new THREE.Group(); // positioned at the body centre, turned to face
    this.lean = new THREE.Group(); // leans into turns and speed changes, at the feet
    this.lean.position.y = -footOffset;
    this.footOffset = footOffset;
    this.flyW = 0; // 0 on foot, 1 flying (double-tap Space)
    this.root.add(this.lean);

    this.model = cloneSkinned(model ?? template.scene);
    this.model.position.set(0, 0, 0); // a pirate keeps its size, not its spot in the line-up
    // Five pirates share one skeleton in pirates.glb, so three.js renames
    // the later ones' bones thighL_1, thighL_2... The clips need the plain
    // names back.
    if (model) {
      this.model.traverse((o) => {
        if (o.isBone) o.name = o.name.replace(/_\d+$/, '');
      });
    }
    this.lean.add(this.model);

    // Each crew member gets their own shirt colour.
    this.shirt = null;
    this.model.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      if (obj.material?.name === 'shirt') {
        this.shirt ??= obj.material.clone();
        obj.material = this.shirt;
      }
    });
    this.setColor(color);

    this.bones = {};
    this.model.traverse((obj) => {
      if (obj.isBone) this.bones[obj.name] = obj;
    });
    // The pose the animations produced last frame, before the look and
    // lean code bent it. three.js only rewrites a bone when its animated
    // value changes, so a bone that never moves in any clip (the neck, the
    // hips' turn) would otherwise keep last frame's bend and add this
    // frame's on top: the head would drift further every frame.
    this.animPose = new Map();
    // Sockets may carry a prefix (pirate_captain_socket_hat).
    const socketNamed = (end) => {
      let found = null;
      this.model.traverse((o) => {
        if (!found && o.name.endsWith(end)) found = o;
      });
      return found;
    };
    this.hatSocket = socketNamed('socket_hat') ?? this.bones.head;
    this.holdSocket = socketNamed('socket_hold') ?? this.bones.chest;
    this.spinners = [];
    this.headgear = []; // a role's cap or helmet: hidden under a hat from the mirror
    this.model.traverse((o) => {
      if (o.name.includes('spin_')) this.spinners.push(o); // propellers and the like
      if (o.isMesh && o.name.includes('headgear')) this.headgear.push(o);
    });
    this.hammer = ['prop_hammer_handle', 'prop_hammer_head']
      .map((n) => this.model.getObjectByName(n))
      .filter(Boolean);
    this.hammer.forEach((m) => (m.visible = false));

    // Two actions per clip: one for the legs, one for the rest.
    this.mixer = new THREE.AnimationMixer(this.model);
    this.lower = {};
    this.upper = {};
    for (const clip of template.animations) {
      const { lower, upper } = splitClip(clip);
      for (const [layer, part] of [[this.lower, lower], [this.upper, upper]]) {
        const action = this.mixer.clipAction(part);
        const once = ONCE.includes(clip.name);
        action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = once;
        action.enabled = true;
        action.setEffectiveWeight(0);
        action.play();
        if (!once) action.time = Math.random() * clip.duration; // no two idles in step
        layer[clip.name] = action;
      }
    }
    // Walk and run are driven by distance, not by the clock.
    for (const name of ['Walk', 'Run']) {
      this.lower[name].timeScale = 0;
      this.upper[name].timeScale = 0;
    }

    // How the head sits on an upright, forward-facing body, measured in the
    // standing pose the animations use (the file's bind pose differs from
    // it by a half turn, so it cannot be used). The look code turns this.
    for (const [name, a] of Object.entries(this.lower)) a.setEffectiveWeight(name === 'Idle' ? 1 : 0);
    for (const [name, a] of Object.entries(this.upper)) a.setEffectiveWeight(name === 'Idle' ? 1 : 0);
    const idleTime = this.lower.Idle.time;
    this.lower.Idle.time = 0;
    this.upper.Idle.time = 0;
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    this.headRest = this.root.getWorldQuaternion(new THREE.Quaternion()).invert()
      .multiply(this.bones.head.getWorldQuaternion(new THREE.Quaternion()));
    this.lower.Idle.time = idleTime;
    this.upper.Idle.time = idleTime;

    // Motion state.
    this.lastPos = null;
    this.vel = new THREE.Vector3(); // smoothed, ship space
    this.prevVelFwd = 0;
    this.speed = 0;
    this.vy = 0;
    this.bodyYaw = null;
    this.hipYaw = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.phase = 0; // 0..1 through two steps
    this.airTime = 0;
    this.airW = 0;
    this.fallSpeed = 0;
    this.turning = false;
    this.leanRoll = 0;
    this.leanPitch = 0;
    this.yawRate = 0;
    this.lastYaw = null;
    this.smoothYawRate = 0;
    this.slowFwd = 0; // a slower-filtered forward speed, for a calm lean

    // The head: its own smoothed look direction (relative to the body) and
    // how strongly it is held steady against the body's sway.
    this.head = {
      world: null, worldVel: 0, // where the eyes point in the world (smoothed)
      extra: 0, extraVel: 0, // glances and activity offsets (smoothed)
      yaw: 0, pitch: 0, pitchVel: 0, hold: 1, holdVel: 0,
    };
    this.glance = { yaw: 0, pitch: 0, nextAt: 2 + Math.random() * 3, still: 0, t: 0 };

    // One-shots: name -> { t, dur, weight }
    this.shots = {};
    this.overrides = { Hammer: 0, Steer: 0, Carry: 0 };
    this.lastUses = null;
    this.lastWaves = null;
    this.blendTime = 0;
  }

  setColor(color) {
    this.shirt?.color.set(color);
  }

  // The role's own cap or helmet, shown unless a mirror hat is on.
  showHeadgear(on) {
    for (const part of this.headgear) part.visible = on;
  }

  // Hats from the dock mirror were made for the old 0.4 m sphere; on the
  // head they are scaled down to fit.
  attachHat(group) {
    group.scale.setScalar(0.62);
    group.position.set(0, 0.02, 0);
    this.hatSocket.add(group);
  }

  play(name, weight = 1) {
    const dur = this.lower[name]?.getClip().duration ?? 0.5;
    this.lower[name]?.reset().play();
    this.upper[name]?.reset().play();
    this.shots[name] = { t: 0, dur, weight };
  }

  // s: what this player is doing this frame.
  //   pos      body centre in ship space (THREE.Vector3)
  //   yaw      where they look (radians), pitch up/down
  //   air      true while off the ground (from the physics); optional
  //   bodyYaw  force the body to face this way (at the wheel)
  //   atWheel  hands on the wheel; steering -1..1 tilts the shoulders
  //   carrying holding the patch kit
  //   act      'patch' while hammering a breach
  //   uses     counter: goes up each time they use something
  //   waves    counter: goes up each time they wave
  update(dt, s) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);
    const pos = s.pos;

    // --- how they are moving --------------------------------------------
    if (!this.lastPos) {
      this.lastPos = pos.clone();
      this.bodyYaw = s.bodyYaw ?? s.yaw;
      this.lastYaw = s.yaw;
    }
    const rawVx = (pos.x - this.lastPos.x) / dt;
    const rawVy = (pos.y - this.lastPos.y) / dt;
    const rawVz = (pos.z - this.lastPos.z) / dt;
    this.lastPos.copy(pos);
    // A teleport (respawn, correction) is not a sprint.
    const jump = Math.hypot(rawVx, rawVz) > 15;
    if (!jump) {
      this.vel.x = ease(this.vel.x, rawVx, 14, dt);
      this.vel.z = ease(this.vel.z, rawVz, 14, dt);
      this.vy = ease(this.vy, rawVy, 18, dt);
    }
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.speed = speed;

    // In the air? Prefer what the physics says; otherwise guess from height.
    const inAir = s.air ?? Math.abs(this.vy) > 1.2;
    if (inAir) {
      this.airTime += dt;
      this.fallSpeed = Math.min(this.fallSpeed, this.vy);
    } else {
      // Only a real fall earns a landing; stepping off a crate does not.
      if (this.airTime > 0.22) {
        const impact = clamp(-this.fallSpeed / 7, 0.35, 1);
        this.play('Land', impact);
      }
      this.airTime = 0;
      this.fallSpeed = 0;
    }
    const airborne = inAir && this.airTime > 0.08;
    // Flying is its own state: not falling, not jumping.
    const flying = !!s.flying;
    this.flyW = ease(this.flyW, flying ? 1 : 0, flying ? 6 : 10, dt);
    const falling = airborne && !flying;
    this.airW = ease(this.airW, falling ? 1 : 0, falling ? 14 : 22, dt);

    // --- facing: the head turns first, the body follows ------------------
    this.lookYaw = s.yaw;
    this.lookPitch = clamp(s.pitch ?? 0, -1.1, 1.1);
    this.yawRate = this.lastYaw === null ? 0 : wrapAngle(s.yaw - this.lastYaw) / dt;
    this.lastYaw = s.yaw;

    if (s.bodyYaw !== undefined && s.bodyYaw !== null) {
      this.bodyYaw = easeAngle(this.bodyYaw, s.bodyYaw, 10, dt);
      this.turning = false;
    } else if (speed > 0.4 || airborne) {
      this.bodyYaw = easeAngle(this.bodyYaw, s.yaw, 12, dt);
      this.turning = false;
    } else {
      const off = wrapAngle(s.yaw - this.bodyYaw);
      if (!this.turning && Math.abs(off) > THREE.MathUtils.degToRad(55)) {
        this.turning = true;
        if (!this.shots.TurnStep) this.play('TurnStep', 0.8);
      }
      if (this.turning) {
        this.bodyYaw = easeAngle(this.bodyYaw, s.yaw, 7, dt);
        if (Math.abs(wrapAngle(s.yaw - this.bodyYaw)) < 0.05) this.turning = false;
      }
    }
    this.root.rotation.y = this.bodyYaw;

    // Movement relative to the body: forward and to the right.
    const sin = Math.sin(this.bodyYaw);
    const cos = Math.cos(this.bodyYaw);
    const fwd = -sin * this.vel.x - cos * this.vel.z;
    const right = cos * this.vel.x - sin * this.vel.z;
    let moveAngle = speed > 0.05 ? Math.atan2(right, fwd) : 0;
    // Mostly backwards: face forward and run the cycle in reverse.
    let direction = 1;
    if (Math.abs(moveAngle) > THREE.MathUtils.degToRad(105)) {
      direction = -1;
      moveAngle = wrapAngle(moveAngle - Math.PI);
    }
    const moving = smoothstep(0.12, 0.6, speed);
    const hipTarget = clamp(moveAngle, -0.95, 0.95) * moving * (1 - this.airW) * (1 - this.flyW);
    this.hipYaw = ease(this.hipYaw, hipTarget, 9, dt);

    // --- stride-locked cycle -------------------------------------------
    const runW = smoothstep(1.7, 3.2, speed);
    const stride = STRIDE.walk + (STRIDE.run - STRIDE.walk) * runW;
    this.phase = (this.phase + (direction * speed * dt) / stride + 1) % 1;
    for (const name of ['Walk', 'Run']) {
      const d = this.lower[name].getClip().duration;
      this.lower[name].time = this.phase * d;
      this.upper[name].time = this.phase * d;
    }

    // Uses and waves arrive as counters from the shared state.
    if (s.uses !== undefined) {
      if (this.lastUses !== null && s.uses > this.lastUses && s.act !== 'patch') this.play('Reach', 1);
      this.lastUses = s.uses;
    }
    if (s.waves !== undefined) {
      if (this.lastWaves !== null && s.waves > this.lastWaves) this.play('Wave', 1);
      this.lastWaves = s.waves;
    }

    // --- one-shots age; their weight fades in and out --------------------
    const shotW = {};
    for (const [name, shot] of Object.entries(this.shots)) {
      shot.t += dt;
      if (shot.t >= shot.dur) {
        delete this.shots[name];
        continue;
      }
      const fadeIn = clamp(shot.t / 0.06, 0, 1);
      const fadeOut = clamp((shot.dur - shot.t) / (shot.dur * 0.35), 0, 1);
      shotW[name] = shot.weight * Math.min(fadeIn, fadeOut);
    }
    // A landing gives way quickly if they run off again.
    if (shotW.Land) shotW.Land *= 1 - moving * 0.65;
    if (shotW.TurnStep) shotW.TurnStep *= 1 - moving;

    // --- continuous overrides --------------------------------------------
    const hammering = s.act === 'patch';
    const steering = s.atWheel && !hammering ? 1 : 0;
    const carrying = s.carrying && !hammering && !steering ? 1 : 0;
    this.overrides.Hammer = ease(this.overrides.Hammer, hammering ? 1 : 0, 10, dt);
    this.overrides.Steer = ease(this.overrides.Steer, steering, 8, dt);
    this.overrides.Carry = ease(this.overrides.Carry, carrying, 10, dt);
    this.hammer.forEach((m) => (m.visible = this.overrides.Hammer > 0.4));

    // --- weights -----------------------------------------------------------
    // Legs: ground locomotion, then air, then a landing on top.
    const ground = 1 - this.airW;
    const rising = smoothstep(-1.5, 0.8, this.vy);
    const onFoot = 1 - this.flyW;
    const swoop = smoothstep(0.8, 4, speed); // hover when slow, swoop when fast
    const legs = {
      Idle: ground * (1 - moving) * onFoot,
      Walk: ground * moving * (1 - runW) * onFoot,
      Run: ground * moving * runW * onFoot,
      Jump: this.airW * rising * onFoot,
      Fall: this.airW * (1 - rising) * onFoot,
      FlyHover: this.flyW * (1 - swoop),
      FlyForward: this.flyW * swoop,
    };
    // One-shots on the legs (a landing, a turning shuffle).
    const base = { ...legs };
    for (const name of ['Land', 'TurnStep']) {
      const w = shotW[name] ?? 0;
      for (const k of Object.keys(base)) base[k] *= 1 - w;
      base[name] = w;
    }
    // Hammering kneels: it takes over the legs too.
    const kneel = this.overrides.Hammer * ground;
    const lowerW = {};
    for (const [k, w] of Object.entries(base)) lowerW[k] = w * (1 - kneel);
    lowerW.Hammer = kneel;

    // Upper body: same as the legs, unless the hands are busy.
    const upperW = { ...base };
    const busy = Math.max(this.overrides.Hammer, this.overrides.Steer, this.overrides.Carry);
    for (const k of Object.keys(upperW)) upperW[k] *= 1 - busy;
    const busyTotal = this.overrides.Hammer + this.overrides.Steer + this.overrides.Carry || 1;
    upperW.Hammer = (busy * this.overrides.Hammer) / busyTotal;
    upperW.Steer = (busy * this.overrides.Steer) / busyTotal;
    upperW.Carry = (busy * this.overrides.Carry) / busyTotal;
    for (const name of ['Reach', 'Wave']) {
      const w = shotW[name] ?? 0;
      for (const k of Object.keys(upperW)) upperW[k] *= 1 - w;
      upperW[name] = w;
    }

    for (const [name, action] of Object.entries(this.lower)) action.setEffectiveWeight(lowerW[name] ?? 0);
    for (const [name, action] of Object.entries(this.upper)) action.setEffectiveWeight(upperW[name] ?? 0);

    // Undo last frame's procedural bends, let the clips write, then keep a
    // copy of the clean result for next frame.
    for (const [bone, pose] of this.animPose) {
      bone.quaternion.copy(pose.q);
      bone.position.copy(pose.p);
    }
    this.mixer.update(dt);
    for (const bone of Object.values(this.bones)) {
      let pose = this.animPose.get(bone);
      if (!pose) this.animPose.set(bone, (pose = { q: new THREE.Quaternion(), p: new THREE.Vector3() }));
      pose.q.copy(bone.quaternion);
      pose.p.copy(bone.position);
    }
    this.model.updateMatrixWorld(true);

    // --- procedural layer -----------------------------------------------
    const b = this.bones;
    // Hips toward the movement, chest back toward the front.
    turnBone(b.hips, UP, -this.hipYaw, this.root);
    turnBone(b.spine, UP, this.hipYaw * 0.55, this.root);
    turnBone(b.chest, UP, this.hipYaw * 0.45, this.root);

    this.updateHead(dt, { moving, shotW, rising });

    // At the wheel the shoulders follow the steering.
    if (this.overrides.Steer > 0.01) {
      turnBone(b.chest, new THREE.Vector3(0, 0, -1), (s.steering ?? 0) * 0.18 * this.overrides.Steer, this.root);
    }

    // Lean into turns (faster turn, faster run = more lean) and tip
    // forward when speeding up, back when stopping.
    // Both come from filtered values: a raw mouse flick or a late network
    // update must not twitch the whole body.
    this.smoothYawRate = ease(this.smoothYawRate, clamp(this.yawRate, -6, 6), 5, dt);
    const rollTarget = clamp(this.smoothYawRate * speed * 0.03, -0.18, 0.18) * (1 - this.airW);
    const prevSlow = this.slowFwd;
    this.slowFwd = ease(this.slowFwd, fwd, 6, dt);
    const accel = (this.slowFwd - prevSlow) / dt;
    const pitchTarget = clamp(-accel * 0.01, -0.12, 0.12) * (1 - this.airW);
    // Flying: tip forward into the direction of travel (back when flying
    // backwards), bank into turns and into sideways drifts.
    const ahead = clamp(fwd / 6, -1, 1);
    const flyPitch = -0.85 * Math.max(0, ahead) + 0.3 * Math.max(0, -ahead);
    const flyRoll = clamp(this.smoothYawRate * 0.1 * (0.4 + speed / 6), -0.5, 0.5) + clamp((-right / 6) * 0.4, -0.4, 0.4);
    const f = this.flyW;
    this.leanRoll = ease(this.leanRoll, rollTarget * (1 - f) + flyRoll * f, 4 + 2 * (1 - f), dt);
    this.leanPitch = ease(this.leanPitch, pitchTarget * (1 - f) + flyPitch * f, 3 + 2 * (1 - f), dt);
    this.lean.rotation.set(this.leanPitch, 0, this.leanRoll);
    // On foot the lean pivots at the feet; in flight about the hips, so the
    // body tips like a swimmer rather than a falling plank.
    const pivot = 0.8 * f;
    _leanQ.setFromEuler(this.lean.rotation);
    _leanP.set(0, pivot, 0).applyQuaternion(_leanQ);
    this.lean.position.set(-_leanP.x, -this.footOffset + pivot - _leanP.y, -_leanP.z);
    // A pirate's backpack propeller: idles slowly, whirs in the air.
    for (const spinner of this.spinners) spinner.rotation.y += dt * (6 + (this.airW + this.flyW) * 30 + speed * 3);
  }

  // Where the head points, and how it gets there.
  //   1. A target: where the player looks, relative to the body. Turns past
  //      the neck's comfortable range ease into the limit (and the body
  //      turns to catch up, see update()).
  //   2. Moments that need the eyes elsewhere bend that target: looking
  //      down at the hands while hammering, at the ground when landing.
  //   3. When the player stands still and does not touch the mouse for a
  //      while, the character glances around a little on its own.
  //   4. A spring moves the head toward the target: quick, smooth, no
  //      overshoot, no jitter from mouse or network noise.
  //   5. Chest and neck take a share of the turn; the head finishes it and
  //      is held steady in space, so it does not wobble with the hips while
  //      running or roll with the lean in a turn.
  updateHead(dt, { moving, shotW, rising }) {
    const h = this.head;
    const g = this.glance;
    const b = this.bones;

    // 1. The player's look. It is smoothed in the world, not relative to
    //    the body, so the body's own catch-up turning never leaks into the
    //    head: the eyes glide while the body does whatever it does.
    if (h.world === null) h.world = this.lookYaw;
    // Target the shortest way round, then keep the angle in -π..π.
    smoothDamp(h, 'world', h.world + wrapAngle(this.lookYaw - h.world), 0.11, dt, 10);
    h.world = wrapAngle(h.world);
    let pitch = softLimit(this.lookPitch, 0.85);

    // 2. Activities bend the target.
    const hammer = this.overrides.Hammer;
    pitch += (-0.75 - pitch) * hammer; // eyes on the nail
    pitch += (-0.15 - pitch) * this.overrides.Carry * 0.4; // over the box
    const land = shotW.Land ?? 0;
    pitch += (-0.45 - pitch) * land * 0.6; // where the feet come down
    const falling = this.airW * (1 - rising);
    pitch += (-0.5 - pitch) * falling * 0.5;
    let extra = (shotW.Wave ?? 0) * 0.2; // a friendly look toward the waving hand

    // 3. Idle glances: only after a few seconds of standing still.
    const idle = (1 - moving) * (1 - this.airW) * (1 - Math.max(hammer, this.overrides.Steer));
    const mouseStill = Math.abs(this.yawRate) < 0.05;
    g.still = idle > 0.9 && mouseStill ? g.still + dt : 0;
    g.t += dt;
    if (g.still > 2.5 && g.t > g.nextAt) {
      g.yaw = (Math.random() * 2 - 1) * 0.4;
      g.pitch = (Math.random() * 2 - 1) * 0.12 - 0.03;
      g.t = 0;
      g.nextAt = 1.6 + Math.random() * 3.2;
    } else if (g.still === 0) {
      g.yaw = 0;
      g.pitch = 0;
    }
    extra += g.yaw;
    pitch += g.pitch;

    // 4. Springs. Glances are lazier than following the mouse.
    const lazy = g.still > 2.5 ? 0.35 : 0.1;
    smoothDamp(h, 'extra', extra, lazy, dt, 6);
    smoothDamp(h, 'pitch', pitch, lazy * 0.9, dt, 7);
    // Relative to the body, eased into the neck's limit.
    h.yaw = softLimit(wrapAngle(h.world - this.bodyYaw), 1.25) * (1 - hammer * 0.7) + h.extra;

    // How firmly the head is held steady: fully when standing or walking,
    // a bit looser running and in the air (some bounce reads as effort),
    // loose during a hard landing so the impact shows.
    const hold = clamp(1 - moving * 0.08 - this.airW * 0.3 - land * 0.45 - (shotW.Wave ?? 0) * 0.2, 0.3, 1);
    smoothDamp(h, 'hold', hold, 0.15, dt);

    // 5. Chest and neck share the turn, then the head lands exactly on it.
    turnBone(b.chest, UP, h.yaw * 0.18, this.root);
    turnBone(b.neck, UP, h.yaw * 0.27, this.root);
    turnBone(b.chest, RIGHT, h.pitch * 0.12, this.root);
    turnBone(b.neck, RIGHT, h.pitch * 0.25, this.root);

    const head = b.head;
    if (!head || !this.headRest) return;
    // Where the head should face in the world: body yaw (the root) plus
    // the look, with no roll. The lean and the hips' sway are left out on
    // purpose, which is what keeps the head steady.
    this.root.getWorldQuaternion(_qRoot);
    _euler.set(h.pitch, h.yaw, 0, 'YXZ');
    _qWant.setFromEuler(_euler);
    _qWant.premultiply(_qRoot).multiply(this.headRest);
    head.getWorldQuaternion(_qHead);
    _qHead.slerp(_qWant, h.hold);
    head.parent.getWorldQuaternion(_qParent);
    head.quaternion.copy(_qParent.invert().multiply(_qHead));
    head.updateMatrixWorld(true);
  }
}

// One character for a player, or null if the model has not loaded.
export function makeCharacter(color, footOffset) {
  return template ? new Character(color, footOffset) : null;
}

// --- sky pirates -----------------------------------------------------------
// public/models/pirates.glb (art/sky_pirates.blend) holds five pirates built
// on the crew skeleton: captain, bosun, lookout, gunner, deckhand. They are
// animated with the crew's clips, so load the crew character first.
export const PIRATES = ['captain', 'bosun', 'lookout', 'gunner', 'deckhand'];
let pirateScene = null;
let pirateLoading = null;

export function loadPirates(url = `${import.meta.env?.BASE_URL ?? './'}models/pirates.glb`) {
  if (!pirateLoading) {
    pirateLoading = new GLTFLoader()
      .loadAsync(url)
      .then((gltf) => (pirateScene = gltf.scene))
      .catch((err) => {
        console.warn('Pirate models missing:', err);
        return null;
      });
  }
  return pirateLoading;
}

// For tools and tests that load the file themselves.
export function usePirateScene(scene) {
  pirateScene = scene;
  pirateLoading = Promise.resolve(scene);
}

// One pirate (by name from PIRATES), animated like the crew; null until
// both models have loaded.
export function makePirate(name, footOffset = 0.4) {
  const node = pirateScene?.getObjectByName(`pirate_${name}`);
  return template && node ? new Character('#ffffff', footOffset, node) : null;
}

// --- the crew's roles ----------------------------------------------------------
// public/models/crew_roles.glb (art/crew_roles.blend): the mechanic, the
// engineer and the pilot, on the crew skeleton. Before a uniform is taken
// a player is the plain deckhand from character.glb. Each outfit's main
// colour is its 'shirt' material, recoloured from the role palette.
let roleScene = null;
let roleLoading = null;

export function loadCrewRoles(url = `${import.meta.env?.BASE_URL ?? './'}models/crew_roles.glb`) {
  if (!roleLoading) {
    roleLoading = new GLTFLoader()
      .loadAsync(url)
      .then((gltf) => (roleScene = gltf.scene))
      .catch((err) => {
        console.warn('Crew role models missing, every role wears the deckhand look:', err);
        return null;
      });
  }
  return roleLoading;
}

export function useCrewRoles(scene) {
  roleScene = scene;
  roleLoading = Promise.resolve(scene);
}

// A crew member for a role ('crew', 'mechanic', 'engineer', 'pilot'), in
// the given colour; null until the character model has loaded.
export function makeCrewMember(role, color, footOffset = 0.4) {
  if (!template) return null;
  const node = role && role !== 'crew' ? roleScene?.getObjectByName(`crew_${role}`) : null;
  const character = new Character(color, footOffset, node);
  character.role = node ? role : 'crew';
  return character;
}

// Which look a role gets right now: its own outfit once crew_roles.glb has
// loaded, the deckhand before that (and before a uniform is taken).
export function lookForRole(role) {
  return role && role !== 'crew' && roleScene?.getObjectByName(`crew_${role}`) ? role : 'crew';
}
