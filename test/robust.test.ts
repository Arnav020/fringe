import { describe, expect, it } from "vitest";
import { nameMatch, screenOk, suitable } from "@/lib/agent";
import { rulePlan } from "@/lib/refine";
import type { Board } from "@/lib/types";
import type { QlooEntity } from "@/lib/qloo";

describe("name matching (Qloo search is not typo-tolerant)", () => {
  it("rejects a different title that merely starts the same way", () => {
    expect(nameMatch("Bluee", "Blue Eye Samurai")).toBeLessThan(0.55);
    expect(nameMatch("Frozn", "Frozen Planet")).toBeLessThan(0.55);
  });
  it("accepts small typos, accents and longer official titles", () => {
    expect(nameMatch("Tayler Swift", "Taylor Swift")).toBeGreaterThanOrEqual(0.55);
    expect(nameMatch("Pokemon", "Pokémon")).toBe(1);
    expect(nameMatch("Spider-Verse", "Spider-Man: Across the Spider-Verse")).toBe(1);
    expect(nameMatch("The Great British Bake Off", "The Great British Baking Show")).toBeGreaterThanOrEqual(0.55);
  });
});

describe("film and TV ratings", () => {
  const show = (name: string, rating: string, type = "tv_show"): QlooEntity => ({ id: name, name, type, rating });
  it("keeps a child's board at PG / TV-PG and below", () => {
    expect(screenOk(8, show("Bluey", "TV-Y"))).toBe(true);
    expect(screenOk(8, show("Squid Game", "TV-MA"))).toBe(false);
    expect(screenOk(8, show("Deadpool", "R", "movie"))).toBe(false);
    expect(screenOk(15, show("Spider-Verse", "PG-13", "movie"))).toBe(true);
    expect(screenOk(15, show("Deadpool", "R", "movie"))).toBe(false);
    expect(screenOk(30, show("Deadpool", "R", "movie"))).toBe(true);
  });
  it("blocks explicit artists for children only", () => {
    expect(suitable(10, { id: "c", name: "Cardi B", type: "artist" })).toBe(false);
    expect(suitable(25, { id: "c", name: "Cardi B", type: "artist" })).toBe(true);
  });
});

describe("rule planner (used when the model is unavailable)", () => {
  const board = {
    person: { name: "Maya", age: 8, city: "Austin, TX", stage: "child" },
    folders: [{ key: "games", title: "Games", quick: [], cells: [{ id: "h", label: "Hello Neighbor", say: "", kind: "expanded", why: "", status: "suggested" }] }],
    stats: { qlooCalls: 0, candidates: 0, kept: 0, ms: 0 },
  } as Board;

  it("turns a three-part request into three tool calls", () => {
    const plan = rulePlan("She's obsessed with dinosaurs now. Find somewhere she can swim. Remove Hello Neighbor, it scares her", board);
    expect(plan.map((p) => p.name)).toEqual(["add_interest", "find_places", "remove_buttons"]);
    expect(plan[0].args.name).toBe("dinosaurs");
    expect(String(plan[1].args.what)).toContain("swim");
    expect(plan[2].args.labels).toEqual(["Hello Neighbor"]);
  });
  it("adds quoted phrases to a named folder", () => {
    const plan = rulePlan('Add "Six!" and "Out!" to people', board);
    expect(plan).toEqual([{ name: "add_phrases", args: { folder: "people", phrases: ["Six!", "Out!"] } }]);
  });
  it("splits several named interests and ignores pronouns", () => {
    const plan = rulePlan("She loves Call of Duty and Grand Theft Auto now, add them", board);
    expect(plan.map((p) => p.args.name)).toEqual(["Call of Duty", "Grand Theft Auto"]);
  });
  it("passes a different city on to find_places", () => {
    const plan = rulePlan("Find an aquarium in Chicago for our trip", board);
    expect(plan).toEqual([{ name: "find_places", args: { what: "aquarium", city: "Chicago" } }]);
  });
  it("does nothing for an unrelated question", () => {
    expect(rulePlan("What's the weather in Austin tomorrow? Please tell me the forecast for the whole week ahead", board)).toEqual([]);
  });
});
