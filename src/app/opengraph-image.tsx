import { ImageResponse } from "next/og";

export const alt = "Fringe: the words for what they love";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const KEYS: [string, string][] = [
  ["I", "#F7DE7E"],
  ["love", "#A9D6A0"],
  ["Bluey", "#F4B98A"],
  ["!", "#F5B9CF"],
];

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "#e9edf2", color: "#1b2130" }}>
        <div style={{ display: "flex", fontSize: 30, color: "#5d6779", letterSpacing: 2 }}>FRINGE · AAC GROUNDED IN QLOO&apos;S TASTE GRAPH</div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 88, marginTop: 24, lineHeight: 1.08, letterSpacing: -2 }}>
          <span>The words for</span>
          <span style={{ color: "#d9482b" }}>what they love.</span>
        </div>
        <div style={{ display: "flex", marginTop: 44, gap: 22 }}>
          {KEYS.map(([w, c]) => (
            <div
              key={w}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: 110,
                minWidth: 150,
                padding: "0 34px",
                borderRadius: 26,
                fontSize: 46,
                fontWeight: 700,
                background: c,
                boxShadow: "10px 10px 22px #c3cad6, -10px -10px 22px #ffffff",
              }}
            >
              {w}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
