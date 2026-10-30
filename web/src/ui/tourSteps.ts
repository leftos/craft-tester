import type { TourStep } from '@/ui/tour.ts';

/**
 * The version of the step lists below; a change to their steps bumps it, so progress stored against
 * an older list is not resumed on the new one.
 */
export const TOUR_STEPS_VERSION = 2;

/** The clearance part, run over KOAK `ws-koak-phraseology-practice-1a-swa1740` in clearance mode. */
export const CLEARANCE_TOUR: readonly TourStep[] = [
  {
    anchor: 'strip',
    title: 'The flight strip',
    body: 'This is the plan clearance delivery reads from: Southwest 1740, a Boeing 737 with RNAV, to Los Angeles, filed on the Candle departure at FL350.',
    advance: 'next',
  },
  {
    anchor: 'atis',
    title: 'The ATIS',
    body: "The ATIS gives Oakland's runway configuration. In SFOW the jets depart runway 30.",
    advance: 'next',
  },
  {
    anchor: 'procedure',
    title: 'Clearance limit and departure',
    body: 'The departure is filled in for you: the Candle, the SID the SOP assigns this route from runway 30. The clearance limit above it, Los Angeles, is too.',
    advance: 'next',
  },
  {
    anchor: 'routeTemplate',
    title: 'Route',
    body: "The first fix after the SID, SUSEY, is one of the Candle's transitions, so the route is read as a transition, then as filed. Pick the transition.",
    advance: { pick: 'routeTemplate', value: 'transition' },
  },
  {
    anchor: 'routeFix',
    title: 'Transition',
    body: 'Now pick the transition fix: SUSEY.',
    advance: { pick: 'routeFix', value: 'SUSEY' },
  },
  {
    anchor: 'altitudePhrase',
    title: 'Altitude',
    body: 'The Candle departure publishes crossing restrictions and a top altitude, so the flight is told to climb via SID.',
    advance: { pick: 'altitudePhrase', value: 'climb_via' },
  },
  {
    anchor: 'expect',
    title: 'Expect clause',
    body: 'The Candle chart publishes its own expect-altitude note, so no expect clause is needed.',
    advance: { pick: 'expect', value: 'none' },
  },
  {
    anchor: 'frequency',
    title: 'Departure frequency',
    body: 'Southbound jets off the Candle talk to NorCal on the Sutro frequency, 135.1.',
    advance: { pick: 'frequency', value: '135.1' },
  },
  {
    anchor: 'runway',
    title: 'Expect runway',
    body: 'Tell the pilot the runway to expect: 30, from the ATIS.',
    advance: { pick: 'runway', value: '30' },
  },
  {
    anchor: 'submit',
    title: 'Submit',
    body: 'Submit the clearance to see it graded.',
    advance: 'submit',
  },
  {
    anchor: 'results',
    title: 'Results',
    body: 'Each row shows what you picked, what the SOP expects and the rule behind it.',
    advance: 'next',
    continueLabel: 'Next: amending a flight plan',
  },
];

/** The Amend part, run over KOAK `ws-koak-amendment-practice-1a-jsx201` in amendment mode. */
export const AMEND_TOUR: readonly TourStep[] = [
  {
    anchor: 'strip',
    title: 'Amending a flight plan',
    body: 'In Amend mode you check the plan before you clear it. JSX 201, an Embraer 135 with RNAV, files to Las Vegas on the Candle departure and Q174 at FL350.',
    advance: 'next',
  },
  {
    anchor: 'box-type',
    title: 'Type and equipment',
    body: 'An RNAV suffix on a jet filing a Q route: nothing to fix. Mark it correct as filed.',
    advance: { box: 'type', answer: { kind: 'as_filed' } },
  },
  {
    anchor: 'box-altitude',
    title: 'Altitude',
    body: "Las Vegas is east of Oakland, and FL350 is odd, as an eastbound flight's level must be. Correct as filed.",
    advance: { box: 'altitude', answer: { kind: 'as_filed' } },
  },
  {
    anchor: 'box-route',
    title: 'Route',
    body: 'Q174 to FLCHR is one of the Las Vegas routings in the letter of agreement. Correct as filed.',
    advance: { box: 'route', answer: { kind: 'as_filed' } },
  },
  {
    anchor: 'boxes-submit',
    title: 'Submit the strip',
    body: 'Submit your answers for the three boxes.',
    advance: 'submit',
  },
  {
    anchor: 'procedure',
    title: 'Now clear it',
    body: 'With the plan checked, you now clear it. In Amend mode you also pick the departure, since an amendment can change it; here nothing changed, so the clearance reads the plan as filed.',
    advance: 'next',
    continueLabel: 'Next: test yourself',
  },
];

/** The last part, over home's Test card. */
export const HOME_TOUR: readonly TourStep[] = [
  {
    anchor: 'home-test',
    title: 'Test yourself',
    body: 'When you are ready, a test draws several strips, timed if you choose, and shows your score at the end. Start one from here.',
    advance: 'next',
  },
];
