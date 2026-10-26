// The captain's log: what each flight earned, and what that opens up.
//
// A flight earns up to three stars: land the ship, land with altitude to
// spare, and the route's own challenge. Every browser keeps its own log of
// the flights it flew (in the save), so the best on each route and the
// hats at the mirror are yours; the host's log also decides which routes
// the route board offers.
//
// The crew's titles at the end come from what each player did on the
// flight (state.stats, counted by the host).

import { HAT_STARS, HATS, ROUTES, RULES } from './state.js';
import { load, save } from './save.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Each route's third star.
const CHALLENGES = {
  noSpread: {
    text: 'No fire spreads to another room',
    done: (log) => !log.spread,
    note: (log) => (log.spread ? `fire spread ${plural(log.spread, 'time')}` : ''),
  },
  allBraced: {
    text: 'Everyone braced for every storm wall',
    done: (log) => !log.thrown,
    note: (log) => (log.thrown ? `${plural(log.thrown, 'crew member')} thrown about` : ''),
  },
  noLoot: {
    text: 'The pirates get away with nothing',
    done: (log) => !log.looted,
    note: (log) => (log.looted ? `looted ${plural(log.looted, 'time')}` : ''),
  },
};

export const starString = (n) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n));

// The goals of a flight that has ended, and the stars they make. Only a
// ship that makes port earns the second and third.
export function evaluateFlight(state) {
  const route = ROUTES[state.route] ?? ROUTES[0];
  const log = state.log ?? {};
  const landed = state.result === 'landed';
  const altitude = Math.max(0, Math.round(state.altitude));
  const challenge = CHALLENGES[route.challenge] ?? CHALLENGES.noSpread;
  const goals = [
    { text: 'Land the ship', done: landed, note: '' },
    {
      text: `Land with ${RULES.landingGoal}% altitude or more`,
      done: landed && altitude >= RULES.landingGoal,
      note: landed ? `landed at ${altitude}%` : '',
    },
    { text: challenge.text, done: landed && challenge.done(log), note: challenge.note(log) },
  ];
  return { route: route.name, landed, altitude, goals, stars: goals.filter((g) => g.done).length };
}

// --- the log in this browser ----------------------------------------------------

// route name -> { best, bestAltitude, flights, landings }. A save from an
// older version (or edited by hand) can hold anything: each number is
// checked on the way out. The dock reads this every frame, so it is kept
// parsed until it changes (here, or in another tab).
let cached = null;
function routes() {
  if (cached) return cached;
  const log = load().log;
  cached = log && typeof log === 'object' && log.routes && typeof log.routes === 'object' ? log.routes : {};
  return cached;
}
addEventListener('storage', () => (cached = null));

const count = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function routeRecord(index) {
  const saved = ROUTES[index] ? routes()[ROUTES[index].name] : null;
  return {
    best: Math.min(3, count(saved?.best)),
    bestAltitude: Math.min(100, count(saved?.bestAltitude)),
    flights: count(saved?.flights),
    landings: count(saved?.landings),
  };
}

export function totalStars() {
  return ROUTES.reduce((sum, _, i) => sum + routeRecord(i).best, 0);
}

export function routeOpen(index) {
  const rule = ROUTES[index]?.open;
  if (!ROUTES[index]) return false;
  if (!rule) return true;
  if (rule.landedOn !== undefined) return routeRecord(rule.landedOn).landings > 0;
  return totalStars() >= (rule.stars ?? 0);
}

// What opens a route that is still shut, in a few words.
export function routeNeeds(index) {
  const rule = ROUTES[index]?.open;
  if (!rule) return '';
  if (rule.landedOn !== undefined) return `land on ${ROUTES[rule.landedOn].name} to open it`;
  return `earn ${rule.stars} ★ to open it`;
}

// How many hats (no hat included) a log of this many stars opens.
export function hatsOpen(stars) {
  return HAT_STARS.filter((need) => need <= stars).length;
}

// Note a finished flight on its route. Returns what is new: a best, and
// whatever it opened.
export function recordFlight(evaluation, routeIndex) {
  const route = ROUTES[routeIndex];
  if (!route) return { newBest: false, previous: 0, opened: [] };
  const routesBefore = ROUTES.map((_, i) => routeOpen(i));
  const hatsBefore = hatsOpen(totalStars());
  const was = routeRecord(routeIndex);
  const data = load();
  const log = data.log && typeof data.log === 'object' ? data.log : {};
  save({
    ...data,
    log: {
      ...log,
      routes: {
        ...routes(),
        [route.name]: {
          best: Math.max(was.best, evaluation.stars),
          bestAltitude: evaluation.landed ? Math.max(was.bestAltitude, evaluation.altitude) : was.bestAltitude,
          flights: was.flights + 1,
          landings: was.landings + (evaluation.landed ? 1 : 0),
        },
      },
    },
  });
  cached = null;

  const opened = [];
  ROUTES.forEach((r, i) => {
    if (!routesBefore[i] && routeOpen(i)) opened.push(`The ${r.name} route, at the route board`);
  });
  const hatsAfter = hatsOpen(totalStars());
  for (let i = hatsBefore; i < hatsAfter; i++) opened.push(`The ${HATS[i]}, at the mirror`);
  return { newBest: evaluation.stars > was.best, previous: was.best, opened };
}

// What to aim for next, in a line or two: a route still to open by
// landing somewhere, and the nearest thing more stars would open.
export function nextGoals() {
  const stars = totalStars();
  const lines = [];
  let nearest = null;
  ROUTES.forEach((route, i) => {
    if (routeOpen(i)) return;
    if (route.open.landedOn !== undefined) lines.push(`Land on ${ROUTES[route.open.landedOn].name} to open ${route.name}`);
    else if (!nearest || route.open.stars < nearest.need) nearest = { need: route.open.stars, what: `the ${route.name} route` };
  });
  HAT_STARS.forEach((need, i) => {
    if (need > stars && (!nearest || need < nearest.need)) nearest = { need, what: `the ${HATS[i]}` };
  });
  if (nearest) {
    const more = nearest.need - stars;
    lines.push(`${more} more ★ for ${nearest.what}`);
  }
  return lines;
}

// --- the crew's titles -------------------------------------------------------------

const TITLES = [
  { key: 'patched', title: 'Hull doctor', what: (n) => `${plural(n, 'hole')} patched` },
  { key: 'stokes', title: 'Stoker', what: (n) => `${plural(n, 'shovel')} of coal` },
  { key: 'power', title: 'Sparks', what: (n) => `${plural(n, 'job')} at the power tubes` },
  { key: 'doused', title: 'Firefighter', what: (n) => `${plural(n, 'bucket')} on the flames` },
  { key: 'cut', title: 'Rope cutter', what: (n) => `${plural(n, 'grapple')} cut` },
  { key: 'overboard', title: 'Pirate tosser', what: (n) => `${plural(n, 'pirate')} overboard` },
  { key: 'dodged', title: 'Steady hand', what: (n) => `${plural(n, 'rock')} dodged at the wheel` },
];

// One title for each crew member: what they did most of, measured against
// the rest of the crew, with no title given twice.
export function crewAwards(state) {
  const crew = Object.values(state.players).sort((a, b) => (a.id === 'host' ? -1 : b.id === 'host' ? 1 : a.id.localeCompare(b.id)));
  const stats = state.stats ?? {};
  const did = (p, key) => count(stats[p.id]?.[key]);
  const options = [];
  for (const title of TITLES) {
    const total = crew.reduce((sum, p) => sum + did(p, title.key), 0);
    for (const p of crew) {
      const n = did(p, title.key);
      if (n) options.push({ p, title, n, share: n / total });
    }
  }
  options.sort((a, b) => b.share - a.share || b.n - a.n);
  const given = new Map();
  const used = new Set();
  for (const { p, title, n } of options) {
    if (given.has(p.id) || used.has(title.key)) continue;
    given.set(p.id, { title: title.title, detail: title.what(n) });
    used.add(title.key);
  }
  return crew.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    ...(given.get(p.id) ?? { title: 'Lookout', detail: 'kept a sharp eye on the sky' }),
  }));
}
