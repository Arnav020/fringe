import { describe, expect, it } from "vitest";
import { obzFiles } from "@/lib/obf";
import { CORE } from "@/lib/vocab";
import type { Board } from "@/lib/types";

const board: Board = {
  person: { name: "Test", age: 8, city: "Austin, TX", stage: "child" },
  folders: [
    {
      key: "shows",
      title: "Shows",
      quick: ["Have you seen it?"],
      cells: [{ id: "a", label: "Bluey", say: "Can we watch Bluey?", image: "https://images.qloo.com/x.jpg", kind: "seed", why: "", status: "approved" }],
    },
    { key: "bridge", title: "Talk with Joe", partner: "Grandpa Joe", quick: [], cells: [{ id: "b", label: "The Waltons", say: "Do you like it?", kind: "bridge", why: "", status: "suggested" }] },
  ],
  stats: { qlooCalls: 0, candidates: 0, kept: 0, ms: 0 },
};

type Obf = { id: string; format: string; buttons: { id: string; label: string; vocalization?: string; load_board?: { path: string } }[]; grid: { rows: number; columns: number; order: (string | null)[][] } };

describe("Open Board Format export", () => {
  const files = obzFiles(board);
  const root = files["boards/root.obf"] as Obf;
  const manifest = files["manifest.json"] as { root: string; paths: { boards: Record<string, string> } };

  it("writes a manifest that points at every board", () => {
    expect(manifest.root).toBe("boards/root.obf");
    for (const path of Object.values(manifest.paths.boards)) expect(files[path]).toBeDefined();
  });

  it("puts every core word first, in a fixed order, then one link per folder", () => {
    expect(root.buttons.slice(0, CORE.length).map((b) => b.label)).toEqual(CORE.map((w) => w.word));
    const links = root.buttons.filter((b) => b.load_board);
    expect(links.map((b) => b.label)).toEqual(["Shows", "Talk with Joe"]);
  });

  it("lays out a grid that contains every button exactly once", () => {
    for (const obf of Object.entries(files).filter(([p]) => p.endsWith(".obf")).map(([, f]) => f as Obf)) {
      expect(obf.format).toMatch(/^open-board-/);
      const ids = obf.grid.order.flat().filter(Boolean);
      expect(ids.sort()).toEqual(obf.buttons.map((b) => b.id).sort());
      expect(obf.grid.order.length).toBe(obf.grid.rows);
    }
  });

  it("speaks each picture's phrase and links back home", () => {
    const shows = files["boards/folder-shows.obf"] as Obf;
    expect(shows.buttons.find((b) => b.id === "a")?.vocalization).toBe("Can we watch Bluey?");
    expect(shows.buttons.some((b) => b.load_board?.path === "boards/root.obf")).toBe(true);
  });
});
