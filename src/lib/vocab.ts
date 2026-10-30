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
}

export const CORE: CoreWord[] = [
  { word: "I", cls: "pronoun" },
  { word: "you", cls: "pronoun" },
  { word: "like", cls: "verb" },
  { word: "love", cls: "verb" },
  { word: "want", cls: "verb" },
  { word: "go", cls: "verb" },
  { word: "watch", cls: "verb" },
  { word: "play", cls: "verb" },
  { word: "more", cls: "describe" },
  { word: "funny", cls: "describe" },
  { word: "not", cls: "negate" },
  { word: "what", cls: "question" },
  { word: "yes", cls: "social" },
  { word: "no", cls: "negate" },
  { word: "with", cls: "little" },
  { word: "favorite", cls: "describe" },
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
  places: { title: "Places", tint: "#F4B98A" },
  food: { title: "Food", tint: "#F4B98A" },
  bridge: { title: "Talk with", tint: "#F5B9CF" },
};
