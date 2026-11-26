// Unit/integration checks for src/net.js: out-of-order go/lob before hi, silent WebRTC drop fallback, and relay rate.
import assert from "node:assert/strict";
import { createNet } from "../src/net.js";

class MockBC {
  static channels = new Map();
  constructor(name) {
    this.name = name;
    this.onmessage = null;
    if (!MockBC.channels.has(name)) MockBC.channels.set(name, new Set());
    MockBC.channels.get(name).add(this);
  }
  postMessage(data) {
    const clone = structuredClone(data);
    for (const ch of MockBC.channels.get(this.name) || []) {
      if (ch !== this && ch.onmessage) queueMicrotask(() => ch.onmessage({ data: clone }));
    }
  }
  close() { MockBC.channels.get(this.name)?.delete(this); }
}
globalThis.BroadcastChannel = MockBC;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Out-of-order message arriving before `hi` must be buffered and delivered once `hi` arrives.
{
  const gotB = [];
  const netB = createNet("ABC234", { id: "peerB", name: "B", team: "ferrari", color: "#f00", num: 16, joined: 200 }, {
    onMsg: (from, m) => gotB.push([from, m]),
  }, { relays: false, rtc: false });
  await wait(40);
  // Inject a `go` message from unknown peerA before peerA's `hi` has arrived
  const bcSpy = new MockBC("deskgp:ABC234");
  bcSpy.postMessage({ f: "peerA", n: "peerA:99", to: "peerB", m: { t: "go", n: 1 } });
  await wait(30);
  assert.equal(gotB.length, 0, "message held until peer is introduced");
  bcSpy.postMessage({ f: "peerA", n: "peerA:1", hi: { name: "Host", color: "#fff", team: "mclaren", num: 4, joined: 1 } });
  await wait(40);
  assert.equal(gotB.length, 1, "buffered go message flushed as soon as hi arrives");
  assert.equal(gotB[0][0], "peerA");
  assert.equal(gotB[0][1].t, "go");
  bcSpy.close();
  netB.close();
}

// 2. Reliable and unreliable fallback when WebRTC data channel closes or stalls.
{
  const gotB = [];
  const netA = createNet("XYZ789", { id: "aaa", name: "A", team: "mclaren", color: "#f80", num: 4, joined: 1 }, {}, { relays: false, rtc: false });
  const netB = createNet("XYZ789", { id: "zzz", name: "B", team: "ferrari", color: "#f00", num: 16, joined: 200 }, {
    onMsg: (from, m) => gotB.push([from, m]),
  }, { relays: false, rtc: false });
  await wait(60);
  const peerB = netA.peers.get("zzz");
  assert.ok(peerB, "peers discovered over BroadcastChannel");
  // Simulate a WebRTC connection whose reliable channel silently closed
  peerB.rtc = true;
  peerB.rtcLast = performance.now() - 5000;
  peerB.u = { readyState: "open", bufferedAmount: 0, send() { throw new Error("dead"); } };
  peerB.r = { readyState: "closed", bufferedAmount: 0, send() {} };

  netA.send({ t: "go", n: 2 }, { reliable: true });
  await wait(40);
  assert.ok(gotB.some(([, m]) => m.t === "go" && m.n === 2), "reliable message falls back to bus when RTC channel is not open");

  // Unreliable relay throttle allows ~8-9 Hz (<= 115ms spacing) instead of 4 Hz (240ms)
  gotB.length = 0;
  for (let i = 0; i < 6; i++) { netA.send({ t: "s", i }); await wait(120); }
  await wait(40);
  const stateCount = gotB.filter(([, m]) => m.t === "s").length;
  assert.ok(stateCount >= 5, `expected >= 5 relayed state packets in 720ms, got ${stateCount}`);

  netA.close();
  netB.close();
}

console.log("net tests passed");
