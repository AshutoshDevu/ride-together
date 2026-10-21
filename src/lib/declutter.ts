/**
 * Riders bunched together (a group at a signal, riding in formation) would draw on top of each
 * other. Like Apple's Find My, fan overlapping markers out in a small circle around their real
 * centre at the current zoom; zooming in separates them naturally and they return to true positions.
 */

type Point = { id: string; lat: number; lng: number };

/** Marker discs closer than this (screen pixels) count as overlapping */
const OVERLAP_PX = 64;

/**
 * @param pxPerDegLng screen pixels per degree of longitude at the current zoom (map width / longitudeDelta)
 * @returns display position per id — only for riders that had to be moved
 */
export function declutter(points: Point[], pxPerDegLng: number): Map<string, { lat: number; lng: number }> {
  const moved = new Map<string, { lat: number; lng: number }>();
  if (points.length < 2 || !isFinite(pxPerDegLng) || pxPerDegLng <= 0) return moved;

  // Work in screen pixels (Mercator: a degree of latitude ≈ a degree of longitude / cos(lat) on screen)
  const lat0 = points[0].lat;
  const kx = pxPerDegLng;
  const ky = pxPerDegLng / Math.cos((lat0 * Math.PI) / 180);
  const px = points.map((p) => ({ ...p, x: p.lng * kx, y: -p.lat * ky }));

  // Greedy clustering around a running centre
  const clusters: { members: typeof px; cx: number; cy: number }[] = [];
  for (const p of px) {
    const c = clusters.find((c) => Math.hypot(c.cx - p.x, c.cy - p.y) < OVERLAP_PX);
    if (c) {
      c.members.push(p);
      c.cx = c.members.reduce((s, m) => s + m.x, 0) / c.members.length;
      c.cy = c.members.reduce((s, m) => s + m.y, 0) / c.members.length;
    } else {
      clusters.push({ members: [p], cx: p.x, cy: p.y });
    }
  }

  for (const c of clusters) {
    const n = c.members.length;
    if (n < 2) continue;
    // Big enough circle that neighbouring discs + name pills don't touch
    const r = Math.max(46, (n * 62) / (2 * Math.PI));
    // Stable order so markers don't swap places on every update
    const sorted = [...c.members].sort((a, b) => a.id.localeCompare(b.id));
    sorted.forEach((m, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      const x = c.cx + r * Math.cos(a);
      const y = c.cy + r * Math.sin(a);
      moved.set(m.id, { lat: -y / ky, lng: x / kx });
    });
  }
  return moved;
}
