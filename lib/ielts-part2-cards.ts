// Real IELTS Speaking Part 2 cue cards, normalized to the standard shape
// (one topic line + exactly four "You should say" bullets). Sourced from the
// publicly published IELTS Liz Part 2 topic bank and reworded into standard
// cue-card phrasing. Static + offline: no network or LLM call to obtain a card.

export interface Part2Card {
  id: string;
  topic: string;
  bullets: [string, string, string, string];
  category: "person" | "place" | "object" | "event" | "activity";
}

export const PART2_CARDS: Part2Card[] = [
  {
    id: "describe-a-book",
    topic: "Describe a book you enjoyed reading",
    bullets: [
      "what kind of book it is",
      "what it is about",
      "what sort of people would enjoy it",
      "and explain why you liked it",
    ],
    category: "object",
  },
  {
    id: "describe-a-person-who-influenced-you",
    topic: "Describe a person who has influenced you",
    bullets: [
      "who this person is",
      "how you know this person",
      "what this person is like",
      "and explain why they have influenced you",
    ],
    category: "person",
  },
  {
    id: "describe-a-journey",
    topic: "Describe a journey that did not go as planned",
    bullets: [
      "where you were going",
      "how you were travelling",
      "what went wrong",
      "and explain what you would do differently",
    ],
    category: "event",
  },
  {
    id: "describe-a-peaceful-place",
    topic: "Describe a peaceful place you like to go to",
    bullets: [
      "where it is",
      "when you first went there",
      "what you do there",
      "and explain why you find it peaceful",
    ],
    category: "place",
  },
  {
    id: "describe-a-hobby",
    topic: "Describe a hobby you enjoy",
    bullets: [
      "what it is",
      "how you got started with it",
      "how often you do it",
      "and explain why you find it interesting",
    ],
    category: "activity",
  },
  {
    id: "describe-a-gift",
    topic: "Describe a gift you gave someone",
    bullets: [
      "who you gave it to",
      "what the gift was",
      "what occasion it was for",
      "and explain why you chose that gift",
    ],
    category: "object",
  },
  {
    id: "describe-a-piece-of-music",
    topic: "Describe a song or piece of music you like",
    bullets: [
      "what kind of song it is",
      "what the song is about",
      "when you first heard it",
      "and explain why you like it",
    ],
    category: "object",
  },
  {
    id: "describe-a-kind-person",
    topic: "Describe a person you know who is kind",
    bullets: [
      "who this person is",
      "how you know this person",
      "what kind things they do",
      "and explain why you think they are kind",
    ],
    category: "person",
  },
  {
    id: "describe-a-favourite-shop",
    topic: "Describe your favourite shop",
    bullets: [
      "where it is",
      "how often you go there",
      "what it sells",
      "and explain why you think it is a good shop",
    ],
    category: "place",
  },
  {
    id: "describe-a-piece-of-good-news",
    topic: "Describe a piece of good news you received",
    bullets: [
      "what the news was",
      "how you received the news",
      "who gave it to you",
      "and explain why it was good news",
    ],
    category: "event",
  },
  {
    id: "describe-an-exercise",
    topic: "Describe a type of exercise you think is good",
    bullets: [
      "what it is",
      "how it is done",
      "when you first tried it",
      "and explain why you think it is a good exercise",
    ],
    category: "activity",
  },
  {
    id: "describe-a-photograph",
    topic: "Describe a photograph you like",
    bullets: [
      "what can be seen in the photo",
      "when it was taken",
      "who took it",
      "and explain why you like it",
    ],
    category: "object",
  },
  {
    id: "describe-a-family-member",
    topic: "Describe a member of your family you get on well with",
    bullets: [
      "who it is",
      "what that person is like",
      "what you do together",
      "and explain why you get on so well",
    ],
    category: "person",
  },
  {
    id: "describe-a-place-near-water",
    topic: "Describe a place near water you like to visit",
    bullets: [
      "where it is",
      "how you get there",
      "what you do there",
      "and explain why you like it",
    ],
    category: "place",
  },
  {
    id: "describe-an-embarrassing-moment",
    topic: "Describe an embarrassing thing that happened to you",
    bullets: [
      "when it was",
      "who you were with",
      "what happened",
      "and explain how you coped afterwards",
    ],
    category: "event",
  },
  {
    id: "describe-a-language",
    topic: "Describe a language you would like to learn",
    bullets: [
      "what it is",
      "how you would learn it",
      "what might be difficult about it",
      "and explain why you want to learn that language",
    ],
    category: "object",
  },
  {
    id: "describe-a-sport",
    topic: "Describe a sport you would like to learn",
    bullets: [
      "what it is",
      "what equipment is needed for it",
      "how you would learn it",
      "and explain why you would like to learn it",
    ],
    category: "activity",
  },
  {
    id: "describe-a-person-you-respect",
    topic: "Describe a person you respect",
    bullets: [
      "who the person is",
      "how you know about this person",
      "what this person does",
      "and explain why you respect this person",
    ],
    category: "person",
  },
  {
    id: "describe-a-way-to-relax",
    topic: "Describe something you do to relax",
    bullets: [
      "what it is",
      "where you do it",
      "when you first did it",
      "and explain why you find it relaxing",
    ],
    category: "activity",
  },
  {
    id: "describe-an-interesting-place",
    topic: "Describe an interesting place you have visited",
    bullets: [
      "where you went",
      "who you went with",
      "how you got there",
      "and explain why you enjoyed it",
    ],
    category: "place",
  },
];

// Random pick that avoids immediately repeating the previous card. Callers pass
// the last-seen id; if excluding it would empty the pool (bank of 1), the guard
// is ignored. Uses Math.random — fine for shuffle, not security-sensitive.
export const pickRandomCard = (excludeId?: string): Part2Card => {
  const pool =
    excludeId && PART2_CARDS.length > 1
      ? PART2_CARDS.filter((c) => c.id !== excludeId)
      : PART2_CARDS;
  return pool[Math.floor(Math.random() * pool.length)];
};
