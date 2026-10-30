/**
 * Core vocabulary: the high-frequency words that make up most of what anyone
 * says. AAC best practice keeps these in FIXED positions so motor plans stay
 * stable; personal "fringe" vocabulary lives in folders. Colours follow the
 * Modified Fitzgerald Key used across AAC systems.
 */

export type WordClass = "pronoun" | "verb" | "describe" | "social" | "question" | "negate" | "little";

export interface CoreWord {
  word: string;
  cls: WordClass;
  /** The word in other home languages, keyed by primary language tag. */
  t?: Record<string, string>;
}

export const CORE: CoreWord[] = [
  { word: "I", cls: "pronoun", t: { hi: "मैं", es: "yo" } },
  { word: "you", cls: "pronoun", t: { hi: "तुम", es: "tú" } },
  { word: "like", cls: "verb", t: { hi: "पसंद", es: "gusta" } },
  { word: "love", cls: "verb", t: { hi: "प्यार", es: "me encanta" } },
  { word: "want", cls: "verb", t: { hi: "चाहिए", es: "quiero" } },
  { word: "go", cls: "verb", t: { hi: "जाना", es: "ir" } },
  { word: "watch", cls: "verb", t: { hi: "देखना", es: "ver" } },
  { word: "play", cls: "verb", t: { hi: "खेलना", es: "jugar" } },
  { word: "more", cls: "describe", t: { hi: "और", es: "más" } },
  { word: "funny", cls: "describe", t: { hi: "मज़ेदार", es: "chistoso" } },
  { word: "not", cls: "negate", t: { hi: "नहीं", es: "no" } },
  { word: "what", cls: "question", t: { hi: "क्या", es: "qué" } },
  { word: "yes", cls: "social", t: { hi: "हाँ", es: "sí" } },
  { word: "no", cls: "negate", t: { hi: "ना", es: "no" } },
  { word: "with", cls: "little", t: { hi: "साथ", es: "con" } },
  { word: "favorite", cls: "describe", t: { hi: "पसंदीदा", es: "favorito" } },
  { word: "help", cls: "verb", t: { hi: "मदद", es: "ayuda" } },
  { word: "stop", cls: "verb", t: { hi: "रुको", es: "para" } },
  { word: "all done", cls: "social", t: { hi: "हो गया", es: "terminé" } },
  { word: "again", cls: "describe", t: { hi: "फिर से", es: "otra vez" } },
  { word: "my", cls: "pronoun", t: { hi: "मेरा", es: "mi" } },
  { word: "it", cls: "pronoun", t: { hi: "यह", es: "eso" } },
  { word: "where", cls: "question", t: { hi: "कहाँ", es: "dónde" } },
  { word: "feel", cls: "verb", t: { hi: "लगता", es: "siento" } },
];

export const FITZGERALD: Record<WordClass, { bg: string; ink: string; name: string }> = {
  pronoun: { bg: "#F7DE7E", ink: "#4A3B00", name: "People" },
  verb: { bg: "#A9D6A0", ink: "#173B12", name: "Actions" },
  describe: { bg: "#A9C9EE", ink: "#0E2F55", name: "Describing" },
  social: { bg: "#F5B9CF", ink: "#5A1530", name: "Social" },
  question: { bg: "#CDBDF0", ink: "#2E1A63", name: "Questions" },
  negate: { bg: "#F2A6A0", ink: "#5C1410", name: "Negation" },
  little: { bg: "#E4E1DA", ink: "#2B2A27", name: "Little words" },
};

/** Fringe (topic) folders: nouns in Fitzgerald orange, social pages in pink. */
export const FOLDER_META: Record<string, { title: string; tint: string }> = {
  shows: { title: "Shows", tint: "#F4B98A" },
  movies: { title: "Movies", tint: "#F4B98A" },
  music: { title: "Music", tint: "#F4B98A" },
  games: { title: "Games", tint: "#F4B98A" },
  books: { title: "Books", tint: "#F4B98A" },
  people: { title: "People", tint: "#F4B98A" },
  places: { title: "Places", tint: "#F4B98A" },
  food: { title: "Food", tint: "#F4B98A" },
  bridge: { title: "Talk with", tint: "#F5B9CF" },
};
