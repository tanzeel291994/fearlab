// Fixed polygraph content: calibration, warm-ups, and the backup host that runs
// whenever Claude isn't available. Lines are reused, so their voice clips are
// cached and cost no ElevenLabs credits after the first time.

// Easy, honest yes/no answers: this sets the player's baseline.
export const CALIBRATION = name => [
  `Is your name ${name}? Take your time.`,
  'Are you, at this moment, a human being?',
  'Have you ever eaten a sandwich?',
];

export const WARMUPS = [
  'If you were a snack, which one would you be and why?',
  'What is the most useless talent you have?',
  'What is your go-to excuse for leaving a party early?',
  'What would your friends say is your most annoying habit?',
  'What would your autobiography be called?',
  'What is a hill you would die on?',
  'Which app would be most embarrassing if we read your screen time out loud?',
  'What is the weirdest thing you have ever googled?',
  'If you were arrested, what would your friends assume you did?',
];

export const INTRO = name => `Welcome to the hot seat, ${name}. Three easy questions first, so the machine can learn what your honest face looks like. Enjoy it while it lasts.`;
export const WARMUP_INTRO = 'Lovely. Now, a few questions about you. Relax, this part does not count. Probably.';
export const THINKING = 'The machine is studying your answers. It has concerns.';

const QUESTIONS = {
  mild: [
    'What is the most childish thing you still do when nobody is watching?',
    'Have you ever waved back at someone who was actually waving at the person behind you?',
    'Have you ever pretended to know a song and just mumbled the words?',
    'What is the worst gift you have ever pretended to love?',
    'Have you ever said you too when a waiter told you to enjoy your meal?',
    'Have you ever laughed at a joke you did not understand, possibly in this very room?',
    'How many unread emails do you have right now? Do not round down.',
    'Have you ever hidden from a neighbour?',
    'Rate your own cooking out of ten, and remember people here have eaten it.',
    'Have you ever eaten something off the floor and checked if anyone saw?',
    'What is the longest you have kept using a mug without washing it?',
    'Have you ever pretended to be on the phone to avoid talking to someone?',
  ],
  spicy: [
    'Who in this room would you least want to be stuck in a lift with?',
    'Have you ever read someone else\'s messages over their shoulder?',
    'What is the worst date you have ever been on?',
    'Have you ever pretended your phone died to avoid replying to someone?',
    'Who in this room do you think talks about you behind your back?',
    'What is the most embarrassing photo in your camera roll right now?',
    'Have you ever lied about your age, and by how much?',
    'Have you ever texted something about a person to that exact person by mistake?',
    'Who was your most embarrassing celebrity crush?',
    'Have you ever stalked an ex online, and how far back did you scroll?',
    'What is something you did as a teenager that your parents still do not know about?',
    'Have you ever left a group chat on read for a week on purpose?',
  ],
  savage: [
    'Who in this room has the worst taste in partners?',
    'Which friend here would you sacrifice first in a zombie apocalypse?',
    'What is the pettiest revenge you have ever taken?',
    'Who here would you least trust with your phone unlocked?',
    'Have you ever pretended to like a friend\'s partner?',
    'What is something you have said about someone here that you hope they never find out?',
    'Have you ever taken credit for someone else\'s work?',
    'Rank the people in this room by how good they are at keeping secrets.',
    'Have you ever faked being sick to skip work, and what was the illness?',
    'Who in this room do you secretly think is the worst driver?',
    'What is the biggest lie you have told someone in this room?',
  ],
};

// Work after almost any answer, so the backup host can still dig in.
const FOLLOWUPS = [
  'Interesting. Name names. First names only, we are not monsters.',
  'And when exactly was the last time? Be specific.',
  'Who else in this room knows about this?',
  'And roughly how many times? The machine can count.',
  'And what did you tell people afterwards?',
  'On a scale of one to ten, how guilty do you feel about that?',
  'And would you do it again? Think carefully.',
];

// Roasts for each tell, matched against the tell text from the sensors.
// A roast is a string, or a function of the tell text when it quotes the player.
const TELL_ROASTS = [
  [/honesty flag/, [
    tell => `You said ${quoted(tell)}. Nobody honest says ${quoted(tell)}.`,
    tell => `${capitalize(quoted(tell))}, you said. The machine heard. The machine always hears.`,
  ]],
  [/pitch/, ['Your voice just went up like a kettle about to boil.', 'Your voice went so high only dogs could hear the lie.']],
  [/smirk/, ['And you smirked. Liars love their own work.', 'That little smile says you are proud of something you should not be.']],
  [/heart rate/, ['Your heart rate just filed a formal complaint.', 'Your heart is beating like it has seen your search history.']],
  [/eyes darted/, ['Your eyes left the room faster than your dignity.', 'You looked away like the answer was written on the ceiling.']],
  [/paused/, ['That pause was long enough to make a cup of tea.', 'The machine aged a year waiting for that answer.']],
  [/silent/, ['Silence. The machine accepts that as a full confession.']],
  [/ums and uhs/, ['Um, uh, er. That is not an answer, that is a dial tone.']],
  [/repeated the question/, ['Repeating the question. Classic stalling. Lawyers love that one.']],
  [/short denial/, ['No, never? Very quick. Suspiciously quick.', 'A two-word denial. The machine has seen enough crime shows.']],
  [/mumbled/, ['Mumbling into your chin will not save you.']],
  [/blinking/, ['You blinked like you were sending Morse code for help.']],
  [/tense brow/, ['Those lips were pressed tighter than a secret.']],
];

const VERDICT_LINES = {
  busted: ['Busted. Even the webcam looked away.', 'Lie detected. Somebody call your mother.', 'The machine says liar, and the machine is only wrong twice a year.'],
  suspicious: ['Suspicious. Very suspicious. I am writing that down.', 'The machine is not convinced, and frankly neither am I.'],
  hmm: ['The machine is undecided, which is never a good sign.', 'Mostly believable. Mostly.'],
  cool: ['Truthful, apparently. Or you are a very good liar, which is worse.', 'The machine believes you. I do not, but the machine does.', 'Ice cold. Either an honest person or a professional.'],
};

const TITLES = [
  [45, ['Certified Professional Liar', 'Menace to Polygraphs', 'Wanted in Three Group Chats']],
  [22, ['Part-Time Fibber', 'Suspicious Snack Thief', 'Person of Great Interest']],
  [0, ['Suspiciously Honest Citizen', 'Too Calm to Trust', 'Boringly Innocent Civilian']],
];

const REPORTS = [
  [40, 'Final verdict: the machine believes almost nothing you said, and frankly it needs a lie down. You are free to go, but we are keeping an eye on you.'],
  [20, 'Final verdict: mostly honest, occasionally creative with the truth. Like a weather forecast. Case closed, for now.'],
  [0, 'Final verdict: you are either the most honest person in this room or the best liar we have ever tested. The machine is scared of you.'],
];

const pickOne = list => list[Math.floor(Math.random() * list.length)];
const quoted = tell => (tell.match(/"(.+)"/)?.[1] ?? 'honestly').replace(/\bi\b/g, 'I');
const capitalize = text => text[0].toUpperCase() + text.slice(1);

// Stands in for Claude: same shape as the server's replies.
export class BackupHost {
  #asked = new Set();
  #spice;

  constructor(spice = 'spicy') {
    this.#spice = spice;
  }

  start() {
    return {
      say: 'The machine has read your warm-up answers. It has concerns. Let us begin.',
      question: this.#nextQuestion(),
      title: 'Person of Interest',
      followup: false,
    };
  }

  answer({ reading, round, rounds, canFollowUp }) {
    const roast = TELL_ROASTS.find(([pattern]) => reading.tells.some(t => pattern.test(t)));
    let say = pickOne(VERDICT_LINES[reading.verdict]);
    if (roast) {
      const line = pickOne(roast[1]);
      const tell = reading.tells.find(t => roast[0].test(t));
      say = `${typeof line === 'function' ? line(tell) : line} ${say}`;
    }
    const digIn = canFollowUp && (reading.verdict === 'busted' || reading.verdict === 'suspicious') && Math.random() < 0.6;
    const ending = round >= rounds && !digIn;
    return {
      say,
      question: digIn ? pickOne(FOLLOWUPS) : ending ? '' : this.#nextQuestion(),
      title: titleFor(reading.stress),
      followup: digIn,
    };
  }

  finish({ averageStress }) {
    const [, line] = REPORTS.find(([min]) => averageStress >= min);
    return { say: line, question: '', title: titleFor(averageStress), followup: false };
  }

  #nextQuestion() {
    // Start at the chosen spice level, and escalate once it runs out.
    const order = ['mild', 'spicy', 'savage'];
    for (const level of order.slice(order.indexOf(this.#spice))) {
      const fresh = QUESTIONS[level].filter(q => !this.#asked.has(q));
      if (fresh.length) {
        const q = pickOne(fresh);
        this.#asked.add(q);
        return q;
      }
    }
    return pickOne(QUESTIONS.savage);
  }
}

function titleFor(stress) {
  const [, titles] = TITLES.find(([min]) => stress >= min);
  return pickOne(titles);
}
