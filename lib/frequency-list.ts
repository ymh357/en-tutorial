export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

const CEFR_ORDER: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

// Compact representation: each level maps to a comma-separated string of lemmas.
// At runtime we split on demand. This keeps the source file manageable.
// In production, this would be loaded from a JSON asset; for v1 we inline a
// representative set per level and expand later.
const WORDS_BY_LEVEL: Record<CefrLevel, string[]> = {
  A1: [
    "be", "have", "do", "say", "go", "get", "make", "know", "think", "take",
    "see", "come", "want", "use", "find", "give", "tell", "work", "call", "try",
    "ask", "need", "feel", "become", "leave", "put", "mean", "keep", "let", "begin",
    "show", "hear", "play", "run", "move", "live", "believe", "bring", "happen", "write",
    "sit", "stand", "lose", "pay", "meet", "include", "continue", "set", "learn", "change",
    "lead", "understand", "watch", "follow", "stop", "create", "speak", "read", "spend", "grow",
    "open", "walk", "win", "teach", "offer", "remember", "love", "consider", "appear", "buy",
    "wait", "serve", "die", "send", "build", "stay", "fall", "cut", "reach", "kill",
    "remain", "suggest", "raise", "pass", "sell", "require", "report", "decide", "pull", "eat",
    // Common nouns
    "time", "year", "people", "way", "day", "man", "woman", "child", "world", "life",
    "hand", "part", "place", "case", "week", "company", "system", "program", "question", "work",
    "number", "night", "point", "home", "water", "room", "mother", "area", "money", "story",
    "fact", "month", "lot", "right", "study", "book", "eye", "job", "word", "business",
    "issue", "side", "kind", "head", "house", "friend", "father", "power", "hour", "game",
    "line", "end", "member", "city", "community", "name", "president", "team", "minute", "idea",
    "body", "back", "parent", "face", "other", "level", "office", "door", "health", "person",
    "art", "war", "history", "party", "result", "car", "morning", "food", "school", "family",
    // Common adjectives
    "good", "new", "first", "last", "long", "great", "little", "own", "old", "right",
    "big", "high", "different", "small", "large", "next", "early", "young", "important", "few",
    "public", "bad", "same", "able", "free", "sure", "true", "full", "special", "easy",
    // Common adverbs, prepositions, etc.
    "not", "also", "very", "often", "however", "too", "usually", "really", "already", "always",
    "well", "just", "more", "still", "never", "now", "here", "then", "today", "there",
  ],
  A2: [
    "accept", "achieve", "add", "admit", "affect", "afford", "agree", "allow", "announce", "apply",
    "argue", "arrange", "arrive", "attack", "avoid", "base", "beat", "belong", "break", "burn",
    "cause", "check", "choose", "claim", "close", "collect", "compare", "compete", "complain", "complete",
    "connect", "contain", "control", "cook", "copy", "correct", "cost", "count", "cover", "cross",
    "cry", "damage", "deal", "deliver", "demand", "depend", "describe", "design", "destroy", "develop",
    "disappear", "discover", "discuss", "divide", "draw", "drive", "drop", "encourage", "enjoy", "enter",
    "examine", "exist", "expect", "experience", "explain", "express", "extend", "fail", "feed", "fight",
    "fill", "finish", "fit", "fix", "fly", "fold", "force", "forget", "forgive", "form",
    // A2 nouns
    "accident", "advantage", "advertisement", "advice", "age", "amount", "argument", "arrangement",
    "article", "attention", "bank", "bath", "beach", "behaviour", "birth", "blood", "board", "boat",
    "bone", "bottom", "brain", "breath", "bridge", "brother", "bus", "cake", "camera", "camp",
    "capital", "career", "ceiling", "centre", "century", "chance", "character", "choice", "circle",
    "class", "climate", "clothes", "club", "coast", "coffee", "cold", "colour", "competition",
    // A2 adjectives
    "afraid", "angry", "available", "basic", "beautiful", "boring", "brave", "bright", "busy", "calm",
    "careful", "central", "cheap", "clean", "clear", "clever", "cold", "comfortable", "common", "complete",
    "confident", "cool", "correct", "crazy", "creative", "cruel", "dangerous", "dark", "dead", "deep",
    "difficult", "dirty", "dry", "empty", "enormous", "entire", "equal", "excellent", "excited", "expensive",
  ],
  B1: [
    "absorb", "abuse", "access", "accommodate", "accompany", "account", "accumulate", "accuse", "acquire",
    "adapt", "adjust", "admire", "adopt", "advance", "advertise", "advocate", "aid", "aim", "allocate",
    "alter", "amaze", "amend", "analyze", "anticipate", "apologize", "appeal", "appoint", "appreciate",
    "approach", "approve", "arise", "assess", "assign", "assist", "associate", "assume", "assure", "attach",
    "attempt", "attend", "attract", "authorize", "ban", "bargain", "bear", "bend", "benefit", "bet",
    "bite", "blame", "bless", "block", "blow", "boast", "bother", "bounce", "bound", "broadcast",
    // B1 nouns
    "absence", "abundance", "academy", "accommodation", "accomplishment", "accuracy", "acquisition",
    "administration", "adolescent", "agenda", "agriculture", "alliance", "alternative", "ambition",
    "amendment", "analysis", "ancestor", "anxiety", "appliance", "application", "appreciation",
    "architect", "architecture", "aspect", "assembly", "assessment", "asset", "assignment",
    "assumption", "atmosphere", "authority", "awareness", "background", "balance", "barrier",
    // B1 adjectives
    "abstract", "academic", "acceptable", "accessible", "accurate", "active", "actual", "adequate",
    "administrative", "advanced", "aggressive", "alternative", "annual", "apparent", "appropriate",
    "ashamed", "attractive", "automatic", "awful", "awkward", "balanced", "bare", "bitter",
    "blind", "brief", "brilliant", "broad", "capable", "casual", "cautious", "characteristic",
  ],
  B2: [
    "abandon", "abolish", "abstain", "accelerate", "accomplish", "acknowledge", "activate", "adhere",
    "administer", "affirm", "aggravate", "align", "allege", "alleviate", "amid", "amplify",
    "annotate", "anticipate", "apparatus", "articulate", "ascertain", "aspire", "assemble",
    "assert", "attribute", "audit", "authenticate", "automate", "benchmark", "breach",
    "calibrate", "capitalize", "catalog", "cater", "cease", "certify", "champion", "characterize",
    "circulate", "clarify", "classify", "cluster", "coincide", "collaborate", "commemorate",
    // B2 nouns
    "abolition", "acceleration", "accountability", "accumulation", "acknowledgment", "adaptation",
    "adequacy", "adhesion", "administration", "admiration", "adversary", "advocate", "affiliation",
    "aftermath", "allegation", "allocation", "ambiguity", "analogy", "apparatus", "apprehension",
    "arbitrary", "array", "aspiration", "assertion", "audit", "autonomy", "benchmark",
    // B2 adjectives
    "abrupt", "absurd", "abundant", "acute", "adverse", "aesthetic", "affirmative", "aggregate",
    "agile", "alarming", "alleged", "ambitious", "ambiguous", "ample", "analogous", "anonymous",
    "applicable", "arbitrary", "authentic", "autonomous", "binding", "blunt", "bureaucratic",
  ],
  C1: [
    "abridge", "absolve", "accentuate", "accredit", "adjudicate", "admonish", "amalgamate",
    "ameliorate", "annex", "annihilate", "appease", "apportion", "arbitrate", "assimilate",
    "attenuate", "bequeath", "bewilder", "bolster", "buttress", "circumscribe", "circumvent",
    "coalesce", "coerce", "commiserate", "compel", "compensate", "concede", "conciliate",
    "condone", "confiscate", "congregate", "conjecture", "connote", "consecrate", "consolidate",
    "construe", "consummate", "contemplate", "contravene", "converge", "convoke", "corroborate",
    // C1 nouns
    "aberration", "abstinence", "accolade", "acumen", "adjunct", "admonition", "adversity",
    "affidavit", "affluence", "allegiance", "allusion", "altruism", "amalgamation", "amnesty",
    "anarchy", "anomaly", "antithesis", "apathy", "apprehension", "arbiter", "archetype",
    "ascendancy", "austerity", "axiom", "benefactor", "benevolence", "brevity", "bureaucracy",
  ],
  C2: [
    "abnegate", "abrogate", "abstemious", "abstruse", "accede", "acrimonious", "adjure",
    "adulterate", "aggrandize", "alacrity", "ambivalence", "anachronism", "anathema", "antediluvian",
    "apotheosis", "approbation", "arrogate", "ascetic", "aspersion", "assiduous", "atavistic",
    "attenuate", "avarice", "avuncular", "bellicose", "blandishment", "bloviate", "bombastic",
    "brusque", "bucolic", "cabal", "cacophony", "calumny", "capitulate", "capricious",
    "castigate", "caustic", "chicanery", "circumlocution", "clandestine", "cognoscente",
  ],
};

export const getKnownWordsForLevel = (level: CefrLevel): string[] => {
  const targetIndex = CEFR_ORDER.indexOf(level);
  const seen = new Set<string>();
  for (let i = 0; i <= targetIndex; i++) {
    for (const word of WORDS_BY_LEVEL[CEFR_ORDER[i]]) {
      seen.add(word);
    }
  }
  return Array.from(seen);
};

const WORD_TO_LEVEL = new Map<string, CefrLevel>();

for (const level of CEFR_ORDER) {
  for (const word of WORDS_BY_LEVEL[level]) {
    if (!WORD_TO_LEVEL.has(word)) {
      WORD_TO_LEVEL.set(word, level);
    }
  }
}

export const getWordLevel = (lemma: string): CefrLevel | null => {
  return WORD_TO_LEVEL.get(lemma.toLowerCase()) ?? null;
};
