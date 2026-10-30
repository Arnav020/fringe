import { describe, expect, it } from "vitest";
import { HANDLE, TEMPLATE, ageOk, gameOk, guards, shortName } from "@/lib/agent";
import { ageBucket, isHangout, outingTags, type QlooEntity } from "@/lib/qloo";
import { CORE } from "@/lib/vocab";
import { stageFor } from "@/lib/types";

const place = (name: string): QlooEntity => ({ id: name, name, type: "place" });

describe("curation handles", () => {
  it("never share a prefix, so a movie pick can't resolve to an artist", () => {
    const prefixes = Object.values(HANDLE);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const a of prefixes) for (const b of prefixes) if (a !== b) expect(`${b}1`.startsWith(a) && /\d/.test(`${b}1`.slice(a.length, a.length + 1))).toBe(false);
  });
});

describe("age guard rails", () => {
  it("filters film and TV by content rating for children and teens", () => {
    expect(guards("child", "movie").contentRating).toBe("G,PG");
    expect(guards("teen", "tv_show").contentRating).toContain("TV-14");
    expect(guards("adult", "movie")).toEqual({});
  });
  it("limits children's books to Qloo's childrens genre", () => {
    expect(guards("child", "book").filterTags).toEqual(["urn:tag:genre:media:childrens"]);
  });
  it("blocks names a parent would not expect, by age", () => {
    expect(ageOk(8, "David Dobrik")).toBe(false);
    expect(ageOk(16, "David Dobrik")).toBe(true);
    expect(ageOk(16, "The Last of Us Part II")).toBe(false);
    expect(ageOk(30, "The Last of Us Part II")).toBe(true);
    expect(ageOk(8, "Bluey")).toBe(true);
  });
  it("uses the ESRB rating Qloo stores on games (Qloo ignores the rating filter for games)", () => {
    const game = (name: string, rating?: string): QlooEntity => ({ id: name, name, type: "videogame", rating });
    expect(gameOk(8, game("Animal Crossing", "E"))).toBe(true);
    expect(gameOk(8, game("Stardew Valley", "E10+"))).toBe(true);
    expect(gameOk(8, game("Dream Daddy"))).toBe(false);
    expect(gameOk(8, game("Fortnite", "T"))).toBe(false);
    expect(gameOk(15, game("Fortnite", "T"))).toBe(true);
    expect(gameOk(15, game("Halo 3", "M"))).toBe(false);
    expect(gameOk(30, game("Halo 3", "M"))).toBe(true);
  });
  it("maps ages to stages and to Qloo age buckets", () => {
    expect(stageFor(8)).toBe("child");
    expect(stageFor(16)).toBe("teen");
    expect(stageFor(71)).toBe("older");
    expect(ageBucket(8)).toBe("24_and_younger");
    expect(ageBucket(40)).toBe("35_to_44");
    expect(ageBucket(71)).toBe("55_and_older");
  });
});

describe("places", () => {
  it("drops hotels, bars, taprooms, offices and plus codes", () => {
    for (const n of ["Hilton Austin", "Lot 46 Music Bar", "Crazy Mountain Tap Room", "Austin Convention Center", "WRMH+9M8"]) expect(isHangout(place(n))).toBe(false);
    for (const n of ["Zilker Metropolitan Park", "Deep Eddy Pool", "Amy's Ice Creams"]) expect(isHangout(place(n))).toBe(true);
  });
  it("uses outing categories for children and teens only", () => {
    expect(outingTags("child")).toContain("urn:tag:category:place:park");
    expect(outingTags("teen")).toContain("urn:tag:category:place:arcade");
    expect(outingTags("older")).toBeUndefined();
  });
});

describe("labels and phrases", () => {
  it("shortens long titles the way people say them", () => {
    expect(shortName("Spider-Man: Across the Spider-Verse")).toBe("Across the Spider-Verse");
    expect(shortName("Casablanca (1942)")).toBe("Casablanca");
  });
  it("has a phrase template for every topic folder", () => {
    for (const k of ["shows", "movies", "music", "games", "books", "people", "places", "food"]) expect(TEMPLATE[k]("X")).toContain("X");
  });
});

describe("core vocabulary", () => {
  it("keeps safety words and a Hindi and Spanish form for every core word", () => {
    const words = CORE.map((w) => w.word);
    for (const w of ["help", "stop", "all done", "yes", "no"]) expect(words).toContain(w);
    for (const w of CORE) {
      expect(w.t?.hi).toBeTruthy();
      expect(w.t?.es).toBeTruthy();
    }
  });
});
