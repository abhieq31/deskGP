// Ten two-car sponsor teams. Names are set in plain lettering (no logo artwork); colours evoke each brand.
// body: main paint; accent: stripes and wings; ink: sponsor lettering on the body; second: secondary sponsors.
export const TEAMS = [
  { id: "nvidia", name: "NVIDIA", body: "#101214", accent: "#76b900", ink: "#76b900", second: ["SHOPIFY", "JIO"] },
  { id: "jio", name: "RELIANCE JIO", short: "JIO", body: "#0f3cc9", accent: "#d4a017", ink: "#ffffff", second: ["JIOMART", "AJIO"] },
  { id: "google", name: "GOOGLE", body: "#f4f6f8", accent: "#4285f4", ink: "#4285f4", second: ["SHOPIFY", "AMAZON"] },
  { id: "tata", name: "TATA", body: "#1b3f8f", accent: "#9fc3ff", ink: "#ffffff", second: ["TATA MOTORS", "JIO"] },
  { id: "mahindra", name: "MAHINDRA", body: "#c8102e", accent: "#1d1d1f", ink: "#ffffff", second: ["RELIANCE DIGITAL", "SHOPIFY"] },
  { id: "tesla", name: "TESLA", body: "#e82127", accent: "#f2f2f2", ink: "#ffffff", second: ["SPACEX", "NVIDIA"] },
  { id: "amazon", name: "AMAZON", body: "#131a22", accent: "#ff9900", ink: "#ff9900", second: ["SHOPIFY", "JIOMART"] },
  { id: "apple", name: "APPLE", body: "#d9dce1", accent: "#2b2b2f", ink: "#1d1d1f", second: ["SHOPIFY", "META"] },
  { id: "meta", name: "META", body: "#0866ff", accent: "#ffffff", ink: "#ffffff", second: ["RELIANCE RETAIL", "GOOGLE"] },
  { id: "spacex", name: "SPACEX", body: "#0b0d10", accent: "#e6e8eb", ink: "#ffffff", second: ["TESLA", "NVIDIA"] },
];
export const teamOf = (id) => TEAMS.find((t) => t.id === id) || TEAMS[0];
// every sponsor name used on the boards and bridges round the circuit
export const BOARD_SPONSORS = ["NVIDIA", "GOOGLE", "AMAZON", "APPLE", "META", "TESLA", "SPACEX", "SHOPIFY", "RELIANCE", "JIO", "JIOMART", "AJIO", "RELIANCE DIGITAL", "TATA", "MAHINDRA", "TATA MOTORS"];
// colour for timing bars and labels: near-black liveries use their accent so they stay visible on dark UI
export const uiColor = (t) => { const h = t.body.replace("#", ""), r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return 0.3 * r + 0.59 * g + 0.11 * b < 60 ? t.accent : t.body; };
