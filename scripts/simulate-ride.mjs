#!/usr/bin/env node
/**
 * Demo helper: fills a ride on the local Firebase emulators with fake riders that move
 * along a route, so you can watch the live map without a group of real phones.
 *
 *   node scripts/simulate-ride.mjs              → creates a new ride and prints its code
 *   node scripts/simulate-ride.mjs K7QM2X       → joins an existing ride (e.g. one you created in the app)
 *
 * Each fake rider signs in anonymously like a real phone would, so the database rules apply.
 * Script events: Meera asks for a stop after ~40 s (for 2 min), Kabir's signal drops after ~60 s,
 * and Sam sends an SOS after ~90 s.
 */
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { connectDatabaseEmulator, get, getDatabase, ref, serverTimestamp, set, update } from 'firebase/database';

const PROJECT = 'demo-ridetogether';
const HOST = process.env.EMULATOR_HOST ?? '127.0.0.1';
const TICK_MS = 2000;

const RIDERS = [
  { name: 'Arjun (lead)', speedKmh: 46 },
  { name: 'Meera', speedKmh: 44 },
  { name: 'Kabir', speedKmh: 41 },
  { name: 'Sam', speedKmh: 43 },
  { name: 'Priya', speedKmh: 39 },
  { name: 'Rohan', speedKmh: 37 },
];

// Bangalore (Hebbal) → Nandi Hills, a classic Sunday-morning ride
const ROUTE = [
  [13.0358, 77.5970], [13.0587, 77.5958], [13.0810, 77.5955], [13.1007, 77.5963],
  [13.1222, 77.6040], [13.1460, 77.6120], [13.1700, 77.6260], [13.1985, 77.6383],
  [13.2260, 77.6550], [13.2560, 77.6740], [13.2860, 77.6930], [13.3170, 77.7050],
  [13.3480, 77.7150], [13.3702, 77.6835],
];

const COLORS = [
  '#FF6B00', '#00C2FF', '#7CFF4F', '#FF3D7F', '#FFD400', '#B46BFF',
  '#00E0B0', '#FF8A65', '#4F8BFF', '#E040FB', '#C6FF00', '#FF5252',
];
const colorForUid = (uid) => {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
};

const toRad = (d) => (d * Math.PI) / 180;
function dist([aLat, aLng], [bLat, bLng]) {
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
const SEGMENTS = ROUTE.slice(1).map((p, i) => dist(ROUTE[i], p));
const ROUTE_LEN = SEGMENTS.reduce((a, b) => a + b, 0);

/** Position + heading at `m` metres along the route (loops at the end). */
function along(m) {
  m = ((m % ROUTE_LEN) + ROUTE_LEN) % ROUTE_LEN;
  let i = 0;
  while (m > SEGMENTS[i]) m -= SEGMENTS[i++];
  const [aLat, aLng] = ROUTE[i], [bLat, bLng] = ROUTE[i + 1];
  const t = m / SEGMENTS[i];
  const heading = (Math.atan2(bLng - aLng, bLat - aLat) * 180) / Math.PI;
  return { lat: aLat + (bLat - aLat) * t, lng: aLng + (bLng - aLng) * t, heading: (heading + 360) % 360 };
}

function randomCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}

async function connect(name) {
  const app = initializeApp(
    { apiKey: 'demo-key', projectId: PROJECT, databaseURL: `http://${HOST}:9000?ns=${PROJECT}-default-rtdb` },
    name,
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${HOST}:9099`, { disableWarnings: true });
  const db = getDatabase(app);
  connectDatabaseEmulator(db, HOST, 9000);
  const { user } = await signInAnonymously(auth);
  return { app, db, uid: user.uid };
}

async function main() {
  let code = (process.argv[2] ?? '').toUpperCase();
  const riders = [];
  for (const [i, r] of RIDERS.entries()) {
    riders.push({ ...r, ...(await connect(`rider-${i}`)), metres: 4000 - i * 650, battery: 92 - i * 9 });
  }

  if (code) {
    const meta = await get(ref(riders[0].db, `groups/${code}/meta`));
    if (!meta.exists()) throw new Error(`No ride with code ${code} on the emulator.`);
    console.log(`Joining ride ${code} — "${meta.val().name}"`);
  } else {
    code = randomCode();
    const lead = riders[0];
    await set(ref(lead.db, `groups/${code}/meta`), {
      name: 'Sunday ride → Nandi Hills', createdBy: lead.uid, createdAt: serverTimestamp(),
    });
    console.log(`Created ride ${code} — "Sunday ride → Nandi Hills"`);
  }

  for (const r of riders) {
    await set(ref(r.db, `groups/${code}/members/${r.uid}`), {
      name: r.name, color: colorForUid(r.uid), joinedAt: serverTimestamp(),
    });
  }
  console.log(`${riders.length} riders on the road. Join in the app with code ${code}`);
  console.log(`  or open http://localhost:8081/join/${code}\nCtrl+C to stop.\n`);

  const startedAt = Date.now();
  const timer = setInterval(async () => {
    const t = (Date.now() - startedAt) / 1000;
    for (const [i, r] of riders.entries()) {
      // Kabir loses signal after a minute → turns grey on the map after 2 min
      if (r.name === 'Kabir' && t > 60) continue;
      const stopped = r.name === 'Meera' && t > 40 && t < 160;
      if (!stopped) r.metres += ((r.speedKmh + (Math.random() * 6 - 3)) / 3.6) * (TICK_MS / 1000);
      const p = along(r.metres);
      const status = r.name === 'Sam' && t > 90 ? 'sos' : stopped ? 'stop' : 'ok';
      await update(ref(r.db, `groups/${code}/locations/${r.uid}`), {
        lat: p.lat, lng: p.lng, heading: p.heading,
        speed: stopped ? 0 : r.speedKmh / 3.6,
        accuracy: 8, battery: Math.max(5, r.battery - Math.floor(t / 120)),
        status, ts: serverTimestamp(),
      }).catch((e) => console.warn(`[${r.name}]`, e.message));
      if (i === 0 && Math.round(t) % 10 < 2) process.stdout.write(`\r${Math.round(t)}s  lead at ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}   `);
    }
  }, TICK_MS);

  process.on('SIGINT', async () => {
    clearInterval(timer);
    console.log('\nStopping simulation.');
    await Promise.all(riders.map((r) => deleteApp(r.app)));
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
