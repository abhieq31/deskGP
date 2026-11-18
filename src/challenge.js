// Challenge links: a personal-best lap packed into a URL (~2 KB). Positions every 0.3 s at 0.5 m precision,
// delta + zigzag varint encoded, base64url. Opening the link races that lap's ghost.
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const zz = (n) => (n << 1) ^ (n >> 31), unzz = (n) => (n >>> 1) ^ -(n & 1);

export function encodeChallenge({ track, cls, name, t, rec }) {
  const out = [], push = (n) => { n = zz(n) >>> 0; while (n >= 128) { out.push((n & 127) | 128); n >>>= 7; } out.push(n); };
  let px = 0, pz = 0;
  for (let i = 0; i < rec.length; i += 9) { const x = Math.round(rec[i] * 2), z = Math.round(rec[i + 1] * 2); push(x - px); push(z - pz); px = x; pz = z; }
  const head = b64u(new TextEncoder().encode(JSON.stringify({ v: 1, t: track, c: cls, n: String(name).slice(0, 18), ms: Math.round(t * 1000) })));
  return `${head}.${b64u(Uint8Array.from(out))}`;
}

export function decodeChallenge(str) {
  try {
    const [h, d] = str.split("."); const meta = JSON.parse(new TextDecoder().decode(unb64u(h)));
    if (meta.v !== 1 || !d) return null;
    const bytes = unb64u(d), pts = []; let i = 0, x = 0, z = 0;
    const pull = () => { let n = 0, sh = 0, b; do { b = bytes[i++]; n |= (b & 127) << sh; sh += 7; } while (b & 128 && i < bytes.length); return unzz(n >>> 0); };
    while (i < bytes.length) { x += pull(); z += pull(); pts.push([x / 2, z / 2]); }
    // back to 10 Hz [x, z, heading] for ghost playback
    const rec = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1], h = Math.atan2(bz - az, bx - ax);
      for (let s = 0; s < 3; s++) { const u = s / 3; rec.push(ax + (bx - ax) * u, az + (bz - az) * u, h); }
    }
    return { track: meta.t, cls: meta.c, name: meta.n, t: meta.ms / 1000, rec };
  } catch { return null; }
}
