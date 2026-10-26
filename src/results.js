// The result screen: how the flight ended, the stars it earned against
// each goal, a best on the route, what opened up and what to aim for next,
// and a title for every crew member. Shown once per flight; a browser that
// flew it notes it in its own log (log.js) on the way.
//
// Names come from other people's browsers, so they only ever go into the
// page as text.

import { ROUTES, RULES } from './state.js';
import { ROOM_LABEL } from './game.js';
import { crewAwards, evaluateFlight, nextGoals, recordFlight, routeRecord, starString } from './log.js';

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function ending(state) {
  const holes = state.patched === 1 ? '1 breach' : `${state.patched} breaches`;
  const raids = state.raid?.repelled ?? 0;
  const pirates = raids ? ` Pirates driven off: ${raids}.` : '';
  const lines = {
    landed: ['Landed!', `Three minutes in the air, ${holes} patched.${pirates}`],
    burned: ['Burned down', `Fire took all three rooms. ${holes} patched before the end.${pirates}`],
  };
  return lines[state.result] ?? ['The ship went down', `${holes} patched before the altitude ran out.${pirates}`];
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Why she went down, or came in low, from the host's tally of where the
// height went (state.log.lost): the biggest drain in one sentence, what to
// do about it, and each drain as a share of the whole. Null when there is
// nothing to explain: a good landing, or an older host with no tally.
export function whyLost(state) {
  const log = state.log ?? {};
  if (state.result === 'burned') {
    const first = ROOM_LABEL[log.firstFire];
    return {
      cause: first
        ? `The fire started in the ${first} and spread until every room was alight.`
        : 'The fire spread until every room was alight.',
      tip: `${RULES.fireBuckets} buckets put a fire out (the rail in the engine room). Left alone, it spreads to the next room every ${RULES.fireSpreadSeconds} s.`,
      parts: [],
    };
  }
  const low = state.result === 'landed' && state.altitude < RULES.landingGoal;
  const lost = log.lost;
  if ((state.result !== 'down' && !low) || !lost) return null;

  const parts = [
    ...Object.keys(lost.holes).map((room) => ({
      kind: 'holes',
      room,
      label: `Holes · ${ROOM_LABEL[room]}`,
      amount: lost.holes[room],
    })),
    { kind: 'lift', label: 'Not enough Lift', amount: Math.max(0, lost.sink - lost.lift) },
    { kind: 'hooks', label: 'Pirate grapples', amount: lost.hooks },
    { kind: 'storm', label: 'Storm walls', amount: lost.storm },
  ].filter((part) => part.amount >= 0.5);
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  if (!total) return null;
  for (const part of parts) part.share = part.amount / total;
  parts.sort((a, b) => b.amount - a.amount);

  // For the sentence a hole is a hole, whichever room it tore in.
  const holes = parts.filter((part) => part.kind === 'holes');
  const holeShare = holes.reduce((sum, part) => sum + part.share, 0);
  const other = parts.find((part) => part.kind !== 'holes');
  const top = holes.length && !(other?.share > holeShare) ? { kind: 'holes', share: holeShare } : other;

  let what;
  let tip;
  if (top.kind === 'holes') {
    const worst = holes[0];
    const torn = log.torn ?? {};
    const room = ROOM_LABEL[worst.room];
    const n = torn[worst.room] ?? 0;
    if (worst.share >= holeShare * 0.6) what = n ? `${plural(n, 'hole')} left open in the ${room}` : `holes left open in the ${room}`;
    else {
      const all = Object.values(torn).reduce((sum, k) => sum + k, 0);
      what = `holes left open all over the ship${all ? ` (${all} of them)` : ''}, the worst in the ${room}`;
    }
    tip = `Every open hole bleeds ${RULES.altitudeLossPerBreach}% a second. Patch them as soon as they tear, and give Lift a unit more while any are open.`;
  } else if (top.kind === 'lift') {
    const made = lost.sink ? Math.round((lost.lift / lost.sink) * 100) : 0;
    what = `Lift running short: it made up only ${made}% of the ship's steady sink`;
    tip = `Each unit in Lift gives back ${RULES.liftPerUnit}% a second, so ${Math.ceil(RULES.sinkRate / RULES.liftPerUnit)} units only hold her level: spare units go there first.`;
    if ((log.cold ?? 0) >= 15) tip += ` The furnace also ran cold for ${Math.round(log.cold)} s, and a cold furnace loses units: keep it stoked.`;
  } else if (top.kind === 'hooks') {
    what = 'pirate grapples left on the rail';
    tip = `Each grapple drags her down ${RULES.hookDrag}% a second: cut them loose as soon as they bite.`;
  } else {
    const hits = state.storm?.hits ?? 0;
    what = hits ? plural(hits, 'storm wall') : 'storm walls';
    tip = `Every storm wall knocks off ${RULES.stormAltitudeLoss}%, and each Shields unit short of ${RULES.stormSafeShields} tears a hole too: ring the bell, brace, and raise the shields.`;
  }
  const most = top.share >= 0.5;
  const lead = low
    ? most ? 'Most of the height you lost went to' : 'The biggest drain on your height was'
    : most ? 'Most of your height went to' : 'The biggest drain on your height was';
  return {
    cause: `${lead} ${what}.`,
    tip,
    low,
    parts: parts.filter((part) => part.share >= 0.04).slice(0, 4).map(({ label, share }) => ({ label, share })),
  };
}

function showWhy(state) {
  const why = whyLost(state);
  const box = $('resultWhy');
  box.hidden = !why;
  if (!why) return;
  box.classList.toggle('low', !!why.low);
  $('resultCause').textContent = why.cause;
  $('resultTip').textContent = why.tip;
  $('resultBreakdown').replaceChildren(
    ...why.parts.map((part) => {
      const share = Math.round(part.share * 100);
      const bar = el('span', 'bar');
      const fill = el('span');
      fill.style.width = `${share}%`;
      bar.append(fill);
      const row = el('li');
      row.append(el('span', 'label', part.label), bar, el('span', 'share', `${share}%`));
      return row;
    })
  );
}

// flew: whether this browser was aboard for the flight (only then does it
// go in the log). colorOf(role): the role's colour, for the crew list.
export function showResult(state, { flew, colorOf }) {
  const evaluation = evaluateFlight(state);
  const record = flew ? recordFlight(evaluation, state.route) : null;
  const route = ROUTES[state.route] ?? ROUTES[0];

  const [title, detail] = ending(state);
  $('resultTitle').textContent = title;
  $('resultDetail').textContent = detail;
  showWhy(state);

  // Three stars, lit one after another.
  const stars = $('resultStars');
  stars.replaceChildren(
    ...[0, 1, 2].map((i) => {
      const star = el('span', i < evaluation.stars ? 'star lit' : 'star', '★');
      star.style.animationDelay = `${0.3 + i * 0.35}s`;
      return star;
    })
  );
  stars.setAttribute('aria-label', `${evaluation.stars} of 3 stars on ${route.name}`);

  $('resultGoals').replaceChildren(
    ...evaluation.goals.map((goal) => {
      const waiting = !goal.done && goal.needsLanding;
      const item = el('li', goal.done ? 'done' : waiting ? 'waiting' : 'missed');
      item.append(el('span', 'mark', goal.done ? '✓' : waiting ? '–' : '✗'), el('span', 'goal', goal.text));
      if (goal.note) item.append(el('span', 'note', goal.note));
      else if (waiting) item.append(el('span', 'note quiet', 'needs a landing'));
      return item;
    })
  );

  const best = routeRecord(state.route).best;
  const recordLine = $('resultRecord');
  recordLine.textContent = record?.newBest
    ? `New best on ${route.name}: ${starString(evaluation.stars)}`
    : `Best on ${route.name}: ${starString(best)}`;
  recordLine.classList.toggle('new', !!record?.newBest);

  const news = [
    ...(record?.opened ?? []).map((text) => el('li', 'opened', `Unlocked: ${text}`)),
    ...nextGoals().map((text) => el('li', 'next', `Next: ${text}`)),
  ];
  $('resultUnlocks').replaceChildren(...news);

  $('resultCrew').replaceChildren(
    el('div', 'card-label', 'Crew titles'),
    ...crewAwards(state).map((award) => {
      const row = el('div', 'crew-title');
      const dot = el('span', 'dot');
      dot.style.background = colorOf(award.role);
      const who = el('span', 'who', award.name);
      const what = el('span', 'what');
      what.append(el('strong', '', award.title), el('span', '', ` · ${award.detail}`));
      row.append(dot, who, what);
      return row;
    })
  );
}
