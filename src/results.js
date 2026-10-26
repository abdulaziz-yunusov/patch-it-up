// The result screen: how the flight ended, the stars it earned against
// each goal, a best on the route, what opened up and what to aim for next,
// and a title for every crew member. Shown once per flight; a browser that
// flew it notes it in its own log (log.js) on the way.
//
// Names come from other people's browsers, so they only ever go into the
// page as text.

import { ROUTES } from './state.js';
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

// flew: whether this browser was aboard for the flight (only then does it
// go in the log). colorOf(role): the role's colour, for the crew list.
export function showResult(state, { flew, colorOf }) {
  const evaluation = evaluateFlight(state);
  const record = flew ? recordFlight(evaluation, state.route) : null;
  const route = ROUTES[state.route] ?? ROUTES[0];

  const [title, detail] = ending(state);
  $('resultTitle').textContent = title;
  $('resultDetail').textContent = detail;

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
