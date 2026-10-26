// The job list: what needs doing aboard right now, for the jobs this
// player looks after. That is their own uniform's, plus any job nobody
// wears (a crew short of three, or a teammate whose line has dropped),
// which goes to the crew member nearest to it: a solo flyer sees
// everything, a full crew sees one job each.
//
// Worked out on every browser from the shared state it already has, so it
// costs the host nothing. jobsFor() decides the list; the panel itself
// (drawing it, ticking finished jobs off) is updateJobList() below.

import { RULES, ROLES, livePower } from './state.js';
import { BREACH_SPOTS, HOOK_SPOTS } from './world.js';
import { ROOM_LABEL, roomAt } from './game.js';

const SPOT_ROOM = Object.fromEntries(BREACH_SPOTS.map((s) => [s.id, s.room]));
const TUBES = ['Engines', 'Shields', 'Lift'];
const the = (room) => `the ${ROOM_LABEL[room]}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const STOKE_BELOW = 0.45; // the furnace bar under this: shovel some coal
const COLD = 0.25; // and under this it is urgent

// A job nobody wears goes to the crew member next door: the rooms stand in
// a row (engine, power, helm), and the pilot is kept at the wheel as long
// as anyone else can go. Anyone may still use those stations; this only
// decides whose list they go on, so two people don't run for one lever.
const STAND_IN = {
  mechanic: ['engineer', 'pilot'],
  engineer: ['mechanic', 'pilot'],
  pilot: ['engineer', 'mechanic'],
};

// The jobs on this player's list, by name: ['mechanic', 'engineer'].
export function coveredRoles(state, me) {
  if (!me) return [];
  const here = Object.values(state.players).filter((p) => p.signal !== 'lost');
  const worn = (role) => here.some((p) => p.role === role);
  return ROLES.filter((role) => {
    if (me.role === role) return true;
    if (worn(role)) return false;
    // Nobody wears it: the first stand-in who is aboard takes it, or,
    // with none of them aboard (still undressed), everyone does.
    const standIn = STAND_IN[role].find((r) => worn(r));
    return standIn ? me.role === standIn : true;
  });
}

// The list for one player: [{ id, text, urgent }], the most urgent first.
// key(action) gives the key the player has bound to an action.
export function jobsFor(state, me, key) {
  if (!me || state.phase !== 'flight') return [];
  const roles = coveredRoles(state, me);
  const mechanic = roles.includes('mechanic');
  const engineer = roles.includes('engineer');
  const pilot = roles.includes('pilot');
  const jobs = [];
  const ids = new Set();
  const add = (id, text, urgent = false) => {
    if (ids.has(id)) return;
    ids.add(id);
    jobs.push({ id, text, urgent });
  };
  const raid = state.raid;
  const storm = state.storm;
  const alongside = raid.phase === 'alongside';
  const holes = Object.entries(state.breaches)
    .filter(([, open]) => open)
    .map(([id]) => id);

  // --- everyone ------------------------------------------------------------
  if (storm.active && storm.warned && !me.atWheel) {
    add('brace', `Brace! Hold ${key('interact')}: storm wall in ${Math.ceil(storm.left)} s`, true);
  }
  if (alongside) {
    for (const [id, b] of Object.entries(raid.boarders)) {
      add(`boarder:${id}`, `Shove the pirate out of ${the(roomAt(b.x))} (tap ${key('interact')})`, true);
    }
    for (const [id, hook] of Object.entries(raid.hooks)) {
      add(`hook:${id}`, `Cut the grapple in ${the(HOOK_SPOTS[hook.spot]?.room ?? 'power')} (hold ${key('interact')})`, true);
    }
  }

  // --- pilot -----------------------------------------------------------------
  if (pilot) {
    if (storm.active && !storm.warned) {
      add('bell', `Ring the bell (${key('bell')}): storm wall in ${Math.ceil(storm.left)} s`, true);
    }
    const lined = state.rock.active && Math.abs(state.rock.lane - state.drift) <= RULES.rockHitWidth;
    if (lined) add('rock', `Steer clear of the rock (${key('left')} / ${key('right')})`, true);
    if (!Object.values(state.players).some((p) => p.atWheel)) add('wheel', 'Take the wheel at the helm');
    if (raid.phase === 'sighted' && !engineer) {
      add('pirates', `Pirates to ${raid.side > 0 ? 'starboard' : 'port'}: call for engines (${key('callout')})`, true);
    }
  }

  // --- fires: the mechanic's and the engineer's (anyone can carry a bucket) --
  if (mechanic || engineer) {
    for (const [room, fire] of Object.entries(state.fires)) {
      if (!fire) continue;
      const left = Math.max(1, RULES.fireBuckets - (fire.water ?? 0));
      add(
        `fire:${room}`,
        me.bucket
          ? `Throw your water on the fire in ${the(room)}`
          : `Put out the fire in ${the(room)}: ${plural(left, 'bucket')} (rail in the engine room)`,
        true
      );
    }
  }

  // --- a blown fuse: the mechanic fetches a spare, anyone fits it ---------------
  const blown = [0, 1, 2].filter((i) => state.blown[i]);
  if (blown.length && (mechanic || engineer)) {
    const names = blown.map((i) => TUBES[i]).join(' and ');
    let text;
    if (me.fuse) text = `Fit the spare fuse at the fuse box (power room): ${names} is dead`;
    else if (state.fuses <= 0) text = `${names} fuse blown, and no spares left`;
    else if (mechanic) text = `${names} fuse blown: take a spare from the crate (engine room) to the fuse box`;
    else text = `${names} fuse blown: the mechanic brings a spare, fit it at the fuse box`;
    add('fuse', text, true);
  }

  // --- engineer --------------------------------------------------------------
  if (engineer) {
    const hot = [0, 1, 2].filter((i) => !state.blown[i] && state.tubeHeat[i] >= RULES.overheatWarn);
    if (hot.length) {
      const names = hot.map((i) => TUBES[i]).join(' and ');
      add(
        'vent',
        state.ventReadyIn > 0
          ? `${names} overheating: take a unit out (valve ready in ${Math.ceil(state.ventReadyIn)} s)`
          : `${names} overheating: hold ${key('interact')} on the steam valve`,
        true
      );
    }
    const shields = livePower(1);
    const engines = livePower(0);
    if (storm.active && shields < RULES.stormSafeShields) {
      add('shields', `Shields to ${RULES.stormSafeShields} before the storm wall hits`, true);
    } else if (alongside && shields < RULES.raidShieldBlock) {
      add('shields', `Shields to ${RULES.raidShieldBlock} to stop their cannonballs`, true);
    } else if (state.rock.active && shields < RULES.shieldThreshold) {
      add('shields', `Shields to ${RULES.shieldThreshold} to turn the rock aside`);
    }
    if (raid.phase === 'sighted' && engines < RULES.raidOutrunEngines) {
      add('engines', `Engines to ${RULES.raidOutrunEngines} to outrun the pirates`, true);
    } else if (state.rock.active && engines < 2) {
      add('engines', 'Engines to 2 so the pilot can steer round the rock');
    }
    if (state.climb < -0.3 && !state.blown[2] && state.power[2] < RULES.maxPerTube) {
      add('lift', 'More power to Lift: the ship is sinking');
    }
    if (state.spare > 0) add('spare', `Put ${plural(state.spare, 'spare unit')} into the tubes (power room levers)`);
  }

  // --- mechanic --------------------------------------------------------------
  if (mechanic) {
    const holdsKit = state.kit.heldBy === me.id;
    if (holdsKit && state.kit.planks <= 0) add('restock', 'Kit empty: restock at the supply rack (engine room)', holes.length > 0);
    if (holes.length && !holdsKit) {
      const holder = state.kit.heldBy && state.players[state.kit.heldBy];
      add('kit', holder ? `Get the patch kit from ${holder.name}` : `Pick up the patch kit (${the(roomAt(state.kit.x))})`);
    }
    for (const id of holes) add(`hole:${id}`, `Patch the hole in ${the(SPOT_ROOM[id])}`);
    if (state.heat < STOKE_BELOW) {
      add('stoke', `Stoke the furnace (engine room): ${Math.round(state.heat * 100)}%`, state.heat < COLD);
    }
  }

  // Urgent first; otherwise in the order above.
  return jobs.filter((j) => j.urgent).concat(jobs.filter((j) => !j.urgent));
}

// --- the panel ----------------------------------------------------------------

const MAX_SHOWN = 7;
const TICK_MS = 1300; // a finished job stays, ticked and struck through, this long
const rows = new Map(); // id -> { li, text, doneAt }
let els = null;

function panel() {
  els ??= {
    root: document.getElementById('jobList'),
    title: document.getElementById('jobTitle'),
    list: document.getElementById('jobItems'),
    empty: document.getElementById('jobEmpty'),
    more: document.getElementById('jobMore'),
  };
  return els;
}

// show: whether the panel belongs on screen at all (in flight, not in
// training); roles: the jobs covered, for the title.
export function updateJobList(jobs, { show, roles, now }) {
  const ui = panel();
  ui.root.hidden = !show;
  if (!show) {
    clearJobList();
    return;
  }
  const title = roles.length === 3
    ? 'Your jobs · every station'
    : `Your jobs · ${roles.map((r, i) => (i ? r : r[0].toUpperCase() + r.slice(1))).join(' + ')}`;
  if (ui.title.textContent !== title) ui.title.textContent = title;

  const listed = jobs.slice(0, MAX_SHOWN);
  const live = new Set(listed.map((j) => j.id));
  // Finished (or crowded out): ticked off, then gone.
  for (const [id, row] of rows) {
    if (live.has(id)) continue;
    if (!row.doneAt) {
      row.doneAt = now;
      row.li.classList.add('done');
      row.li.firstChild.textContent = '✓';
    } else if (now - row.doneAt > TICK_MS) {
      row.li.remove();
      rows.delete(id);
    }
  }
  // New and changed jobs, in the list's order (the ticked ones stay put).
  let before = null;
  for (const job of listed) {
    let row = rows.get(job.id);
    if (!row || row.doneAt) {
      row?.li.remove();
      const li = document.createElement('li');
      const box = document.createElement('span');
      box.className = 'job-box';
      box.textContent = '';
      const text = document.createElement('span');
      text.className = 'job-text';
      li.append(box, text);
      row = { li, text: '', doneAt: 0 };
      rows.set(job.id, row);
    }
    if (row.text !== job.text) {
      row.li.lastChild.textContent = job.text;
      row.text = job.text;
    }
    row.li.classList.toggle('urgent', job.urgent);
    const at = before ? before.nextSibling : ui.list.firstChild;
    if (at !== row.li) ui.list.insertBefore(row.li, at);
    before = row.li;
  }
  ui.empty.hidden = rows.size > 0;
  const extra = jobs.length - listed.length;
  ui.more.hidden = extra <= 0;
  if (extra > 0) ui.more.textContent = `+ ${extra} more`;
}

export function clearJobList() {
  for (const row of rows.values()) row.li.remove();
  rows.clear();
}
