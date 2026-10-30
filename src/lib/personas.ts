import type { BuildInput } from "./types";

export interface Persona extends BuildInput {
  slug: string;
  headline: string;
  condition: string;
  access: string;
  partner: { name: string; age: number; relation: string; likes: string };
}

/** Illustrative people (not real individuals) spanning the AAC lifespan. */
export const PERSONAS: Persona[] = [
  {
    slug: "maya",
    name: "Maya",
    age: 8,
    city: "Austin, TX",
    condition: "Autistic, minimally speaking",
    access: "Touch, tablet",
    headline: "Her board says “toilet” and “juice”. It can’t say “Bluey”.",
    likes: "Bluey, Taylor Swift, Encanto, Minecraft, mac and cheese, swimming",
    about: "Loves dancing in the kitchen and anything with dogs.",
    partner: {
      name: "Grandpa Joe",
      age: 68,
      relation: "grandfather",
      likes: "Johnny Cash, True Grit, The Andy Griffith Show, BBQ brisket",
    },
  },
  {
    slug: "leo",
    name: "Leo",
    age: 16,
    city: "Chicago, IL",
    condition: "Cerebral palsy, eye-gaze user",
    access: "Eye-gaze, large targets",
    headline: "His classmates talk about the game last night. He has no button for it.",
    likes: "Spider-Man: Across the Spider-Verse, Travis Scott, NBA 2K, Rocket League, deep dish pizza",
    about: "Sarcastic, competitive, wants to be a sports commentator.",
    partner: {
      name: "Ava",
      age: 16,
      relation: "new lab partner",
      likes: "Olivia Rodrigo, Stranger Things, Minecraft, boba tea",
    },
  },
  {
    slug: "ruth",
    name: "Ruth",
    age: 71,
    city: "Boston, MA",
    condition: "Aphasia after a stroke",
    access: "Touch, pictures + words",
    headline: "Forty years of Sinatra and Christie, and a board full of “pain 1–10”.",
    likes: "Frank Sinatra, Casablanca, The Great British Bake Off, Agatha Christie, clam chowder",
    about: "Retired schoolteacher, fierce at crosswords.",
    partner: {
      name: "Priya",
      age: 19,
      relation: "granddaughter",
      likes: "Taylor Swift, Bridgerton, Gilmore Girls, matcha",
    },
  },
];

export function personaBySlug(slug: string) {
  return PERSONAS.find((p) => p.slug === slug);
}
