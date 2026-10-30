// Scores faces for each challenge from MediaPipe's 52 face blendshapes (0..1 each).
// A recipe is [blendshape, weight] pairs; names without Left/Right that don't exist
// as-is (e.g. 'browDown') average the Left and Right versions.
// `full` is the weighted raw value that counts as 100 points — lower it if
// scores feel stingy, raise it if everyone gets 100.

export const CHALLENGES = {
  monster: {
    title: 'Scariest monster',
    emoji: '👹',
    prompt: 'Show your teeth! Scrunch your nose! ROAR!',
    full: 0.55,
    recipe: [['jawOpen', 0.25], ['browDown', 0.2], ['noseSneer', 0.2], ['mouthUpperUp', 0.15], ['mouthStretch', 0.1], ['eyeWide', 0.1]],
  },
  scared: {
    title: 'Most scared',
    emoji: '😱',
    prompt: 'You just saw a ghost behind the couch!',
    full: 0.55,
    recipe: [['eyeWide', 0.3], ['browInnerUp', 0.25], ['mouthStretch', 0.2], ['jawOpen', 0.15], ['browOuterUp', 0.1]],
  },
  surprised: {
    title: 'Most surprised',
    emoji: '😲',
    prompt: 'You just won a lifetime supply of ice cream!',
    full: 0.6,
    recipe: [['jawOpen', 0.3], ['eyeWide', 0.3], ['browInnerUp', 0.2], ['browOuterUp', 0.2]],
  },
  happy: {
    title: 'Biggest smile',
    emoji: '😁',
    prompt: 'Biggest, cheesiest smile you have!',
    full: 0.7,
    recipe: [['mouthSmile', 0.6], ['cheekSquint', 0.25], ['eyeSquint', 0.15]],
  },
  angry: {
    title: 'Angriest',
    emoji: '😠',
    prompt: 'Someone ate your last slice of pizza.',
    full: 0.5,
    recipe: [['browDown', 0.4], ['noseSneer', 0.2], ['mouthPress', 0.2], ['eyeSquint', 0.2]],
  },
  sad: {
    title: 'Saddest',
    emoji: '😢',
    prompt: 'The Wi-Fi is down. Forever.',
    full: 0.45,
    recipe: [['mouthFrown', 0.45], ['browInnerUp', 0.35], ['mouthShrugLower', 0.2]],
  },
};

// MediaPipe Classifications -> { blendshapeName: score }
export function toScores(classifications) {
  const out = {};
  for (const c of classifications?.categories ?? []) out[c.categoryName] = c.score;
  return out;
}

export function scoreFace(challenge, shapes) {
  const raw = challenge.recipe.reduce((sum, [name, w]) => sum + w * feature(shapes, name), 0);
  return Math.round(100 * Math.min(1, raw / challenge.full));
}

function feature(shapes, name) {
  if (name in shapes) return shapes[name];
  return ((shapes[`${name}Left`] ?? 0) + (shapes[`${name}Right`] ?? 0)) / 2;
}

// Placeholder host lines until the AI host is wired in.
const JOKES = {
  monster: {
    low: ['That\'s not a monster, that\'s a mildly annoyed librarian.', 'Even the goldfish isn\'t scared.'],
    mid: ['Solid monster! The cat has left the room.', 'Scary enough to haunt a small closet.'],
    high: ['AAAH! Somebody check under the beds — we found the monster!', 'That face just cancelled Halloween. Nothing will top it.'],
  },
  scared: {
    low: ['You look like you saw a slightly spooky sock.', 'Is that fear, or did you just remember homework?'],
    mid: ['Nice! You definitely heard something in the attic.', 'That\'s a "who turned off the lights?" face.'],
    high: ['TOTAL PANIC! Oscar committee, take notes.', 'You saw the ghost AND the ghost\'s mum.'],
  },
  surprised: {
    low: ['Mildly surprised. Like finding a fry at the bottom of the bag.', 'Your eyebrows are still on holiday.'],
    mid: ['Good gasp! Somebody just said "free dessert".', 'Your face said "WAIT, WHAT?"'],
    high: ['Your eyebrows just left the building!', 'Jaw on the floor! Someone help pick it up.'],
  },
  happy: {
    low: ['Is that a smile or are you thinking about taxes?', 'Smile loading… 12%…'],
    mid: ['Lovely smile! Toothpaste ad pending.', 'That smile could charge a phone.'],
    high: ['MAXIMUM CHEESE! We need sunglasses over here.', 'That smile is visible from space.'],
  },
  angry: {
    low: ['That\'s the anger of someone who got slightly cold toast.', 'Scary like a sleepy kitten.'],
    mid: ['Grumpy! The pizza thief should run.', 'That\'s a proper "who touched my stuff" face.'],
    high: ['VOLCANO MODE! Everybody stay calm.', 'Steam is coming out of the ears!'],
  },
  sad: {
    low: ['Mild sadness. Like the ice cream fell, but it was a flavour you didn\'t like.', 'Not sad. Just slightly disappointed in all of us.'],
    mid: ['Aww, somebody give this person a hug.', 'That\'s a "my balloon flew away" face.'],
    high: ['Heartbreaking! The Wi-Fi gods have heard you.', 'Sad puppy level: MAXIMUM. Give them a cookie.'],
  },
};

export function jokeFor(key, score) {
  const band = score >= 70 ? 'high' : score >= 40 ? 'mid' : 'low';
  const lines = JOKES[key][band];
  return lines[Math.floor(Math.random() * lines.length)];
}
