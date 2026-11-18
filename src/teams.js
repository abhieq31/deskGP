// The 2026 Formula 1 grid (formula1.com/en/teams): eleven teams, two drivers each.
// Names are set in plain lettering in team colours; no logo artwork is used. DeskGP has no affiliation with F1 or any team.
// body: main paint; accent: stripes, wings, helmets; ink: lettering on the body; drivers: [name, code, number].
export const TEAMS = [
  { id: "mclaren", name: "McLaren", body: "#ff8000", accent: "#101215", ink: "#101215", drivers: [["Lando Norris", "NOR", 4], ["Oscar Piastri", "PIA", 81]] },
  { id: "mercedes", name: "Mercedes", body: "#c4c9cf", accent: "#00d2be", ink: "#101215", drivers: [["George Russell", "RUS", 63], ["Kimi Antonelli", "ANT", 12]] },
  { id: "redbull", name: "Red Bull Racing", short: "RED BULL", body: "#1a2a5e", accent: "#e1061b", ink: "#ffc906", drivers: [["Max Verstappen", "VER", 1], ["Isack Hadjar", "HAD", 6]] },
  { id: "ferrari", name: "Ferrari", body: "#d40000", accent: "#ffeb00", ink: "#ffffff", drivers: [["Charles Leclerc", "LEC", 16], ["Lewis Hamilton", "HAM", 44]] },
  { id: "williams", name: "Williams", body: "#0b2c6b", accent: "#00a3e0", ink: "#ffffff", drivers: [["Carlos Sainz", "SAI", 55], ["Alexander Albon", "ALB", 23]] },
  { id: "racingbulls", name: "Racing Bulls", short: "RACING BULLS", body: "#f2f4f7", accent: "#1634cb", ink: "#1634cb", drivers: [["Liam Lawson", "LAW", 30], ["Arvid Lindblad", "LIN", 41]] },
  { id: "astonmartin", name: "Aston Martin", body: "#00594f", accent: "#cedc00", ink: "#ffffff", drivers: [["Fernando Alonso", "ALO", 14], ["Lance Stroll", "STR", 18]] },
  { id: "haas", name: "Haas F1 Team", short: "HAAS", body: "#eceff2", accent: "#d0021b", ink: "#101215", drivers: [["Oliver Bearman", "BEA", 87], ["Rafael Câmara", "CAM", 35]] },
  { id: "audi", name: "Audi", body: "#2b2e33", accent: "#f50537", ink: "#ffffff", drivers: [["Nico Hulkenberg", "HUL", 27], ["Gabriel Bortoleto", "BOR", 5]] },
  { id: "alpine", name: "Alpine", body: "#0a5cc7", accent: "#ff70c8", ink: "#ffffff", drivers: [["Pierre Gasly", "GAS", 10], ["Franco Colapinto", "COL", 43]] },
  { id: "cadillac", name: "Cadillac", body: "#111214", accent: "#e8e8e8", ink: "#ffffff", drivers: [["Sergio Perez", "PER", 11], ["Valtteri Bottas", "BOT", 77]] },
];
for (const t of TEAMS) t.second = [];
export const teamOf = (id) => TEAMS.find((t) => t.id === id) || TEAMS[0];
// every driver on the grid: [name, code, number, team id]
export const GRID_DRIVERS = TEAMS.flatMap((t) => t.drivers.map(([n, c, num]) => [n, c, num, t.id]));
// trackside boards keep the tech sponsors
export const BOARD_SPONSORS = ["NVIDIA", "GOOGLE", "AMAZON", "APPLE", "META", "TESLA", "SPACEX", "SHOPIFY", "RELIANCE", "JIO", "JIOMART", "AJIO", "RELIANCE DIGITAL", "TATA", "MAHINDRA", "TATA MOTORS"];
// colour for timing bars and labels: near-black or pale liveries use the accent so they stay visible on dark UI
export const uiColor = (t) => { const h = t.body.replace("#", ""), r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return 0.3 * r + 0.59 * g + 0.11 * b < 60 ? t.accent : t.body; };
