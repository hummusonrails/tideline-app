/**
 * Track geometry for the kart duel.
 *
 * A track is authored as a small closed loop of control points plus a road
 * half-width — nothing else. Everything the game needs (smooth centerline,
 * arc lengths, checkpoints, item box positions, start grid) is derived at
 * build time. Authoring stays a ten-line data literal, which is the whole
 * point: adding a fourth track is writing one more {@link TrackDef}, not
 * drawing collision meshes.
 *
 * Collision is implicit: the drivable road is "every point within halfWidth
 * of the centerline", so walls need no geometry of their own and can never
 * disagree with the visuals — both are derived from the same polyline.
 *
 * All names and themes here are invented and sea-generic on purpose. This
 * repo is public; nothing in it may hint at real places or the trip itself.
 *
 * Pure math throughout — no DOM, no randomness — so every function in this
 * file is unit-testable and gives identical answers on both phones.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface TrackDef {
  id: string;
  name: string;
  /** One-line flavour text for the picker. */
  vibe: string;
  /** Cosmetic theme consumed by the renderer only. */
  theme: 'sand' | 'plank' | 'swirl';
  /** Closed loop of control points; smoothed into the centerline at build. */
  loop: readonly Vec2[];
  /** Half the road width, in world units. Kart radius is 16 — keep ≥ 60. */
  halfWidth: number;
  /** Item boxes, as fractions of the lap (0..1). Derived to x/y at build. */
  boxAt: readonly number[];
}

/** A built, ready-to-race track. Treat as immutable. */
export interface Track {
  def: TrackDef;
  /** Densified closed centerline; segment i runs points[i] → points[(i+1)%n]. */
  points: Vec2[];
  /** Per-segment length, same indexing as {@link points}. */
  segLen: number[];
  /** Arc length at the *start* of segment i. */
  cumLen: number[];
  totalLen: number;
  /** Ordered lap-progress fractions; checkpoints[0] === 0 is the start line. */
  checkpoints: number[];
  /** Item boxes with resolved world positions. */
  boxes: { x: number; y: number; progress: number }[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Checkpoints per lap. Eight is enough that skipping any meaningful chunk of
 * track misses at least one (they're ~an eighth of a lap apart, far wider
 * than the road), while staying cheap to check every tick.
 */
export const CHECKPOINT_COUNT = 8;

/** Samples per control-point segment when smoothing. Fixed for determinism. */
const SAMPLES_PER_SEGMENT = 12;

// ---------- the catalog ----------

/**
 * Three tracks, easy → hard. Layouts are hand-tuned so that no two sections
 * of road pass within ~2.5× halfWidth of each other: centerline projection
 * (and therefore collision) assumes the nearest segment is the *right*
 * segment, which stops being true if the road pinches against itself.
 */
export const TRACKS: readonly TrackDef[] = [
  {
    id: 'lagoon',
    name: 'Lagoon Loop',
    vibe: 'Wide and friendly. Learn to drift here.',
    theme: 'sand',
    halfWidth: 92,
    loop: [
      { x: 420, y: 320 }, { x: 1000, y: 230 }, { x: 1560, y: 330 },
      { x: 1780, y: 640 }, { x: 1640, y: 950 }, { x: 1760, y: 1230 },
      { x: 1400, y: 1440 }, { x: 900, y: 1360 }, { x: 430, y: 1420 },
      { x: 230, y: 1050 }, { x: 340, y: 680 }, { x: 240, y: 470 },
    ],
    boxAt: [0.22, 0.47, 0.72, 0.93],
  },
  {
    id: 'boardwalk',
    name: 'Boardwalk Dash',
    vibe: 'Tight corners over the planks. Brake or bounce.',
    theme: 'plank',
    halfWidth: 78,
    loop: [
      { x: 350, y: 320 }, { x: 1050, y: 260 }, { x: 1650, y: 340 },
      { x: 1700, y: 800 }, { x: 1300, y: 900 }, { x: 1260, y: 1250 },
      { x: 1620, y: 1460 }, { x: 900, y: 1560 }, { x: 380, y: 1440 },
      { x: 300, y: 950 }, { x: 560, y: 700 }, { x: 320, y: 520 },
    ],
    boxAt: [0.18, 0.42, 0.66, 0.9],
  },
  {
    id: 'maelstrom',
    name: 'Maelstrom Spiral',
    vibe: 'Narrow, twisty, unforgiving. For showing off.',
    theme: 'swirl',
    halfWidth: 66,
    loop: [
      { x: 520, y: 260 }, { x: 1250, y: 210 }, { x: 1720, y: 420 },
      { x: 1620, y: 760 }, { x: 1300, y: 820 }, { x: 1500, y: 1090 },
      { x: 1680, y: 1380 }, { x: 1180, y: 1540 }, { x: 640, y: 1480 },
      { x: 300, y: 1220 }, { x: 460, y: 940 }, { x: 780, y: 800 },
      { x: 600, y: 620 }, { x: 300, y: 460 },
    ],
    boxAt: [0.15, 0.38, 0.6, 0.85],
  },
];

export function trackById(id: string): TrackDef | null {
  return TRACKS.find((t) => t.id === id) ?? null;
}

// ---------- building ----------

/**
 * Catmull-Rom point for one closed-loop segment at parameter t ∈ [0,1).
 * Uniform parameterisation is fine here: control points are hand-authored at
 * roughly even spacing, so the pathologies centripetal CR guards against
 * (cusps from wildly uneven knots) don't arise.
 */
function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

export function buildTrack(def: TrackDef): Track {
  const ctrl = def.loop;
  const n = ctrl.length;
  const points: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n];
    const p1 = ctrl[i];
    const p2 = ctrl[(i + 1) % n];
    const p3 = ctrl[(i + 2) % n];
    for (let s = 0; s < SAMPLES_PER_SEGMENT; s++) {
      points.push(catmullRom(p0, p1, p2, p3, s / SAMPLES_PER_SEGMENT));
    }
  }

  const segLen: number[] = [];
  const cumLen: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    cumLen.push(total);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segLen.push(len);
    total += len;
  }

  const checkpoints: number[] = [];
  for (let i = 0; i < CHECKPOINT_COUNT; i++) checkpoints.push(i / CHECKPOINT_COUNT);

  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of points) {
    bounds.minX = Math.min(bounds.minX, p.x);
    bounds.minY = Math.min(bounds.minY, p.y);
    bounds.maxX = Math.max(bounds.maxX, p.x);
    bounds.maxY = Math.max(bounds.maxY, p.y);
  }
  // The road extends halfWidth either side of the centerline.
  bounds.minX -= def.halfWidth; bounds.minY -= def.halfWidth;
  bounds.maxX += def.halfWidth; bounds.maxY += def.halfWidth;

  const track: Track = {
    def, points, segLen, cumLen, totalLen: total, checkpoints, boxes: [], bounds,
  };
  track.boxes = def.boxAt.map((f, i) => {
    const p = pointAt(track, f);
    // Alternate boxes left/right of center so a single racing line can't
    // vacuum up every box lap after lap.
    const nrm = normalAt(track, f);
    const side = i % 2 === 0 ? -0.45 : 0.45;
    return {
      x: p.x + nrm.x * def.halfWidth * side,
      y: p.y + nrm.y * def.halfWidth * side,
      progress: f,
    };
  });
  return track;
}

// ---------- sampling ----------

/** Wrap any real into [0, 1). */
export function wrap01(v: number): number {
  return v - Math.floor(v);
}

/**
 * Signed shortest lap distance from `a` to `b`, in (-0.5, 0.5]. Positive
 * means "b is ahead of a going the right way around".
 */
export function forwardDelta(a: number, b: number): number {
  let d = wrap01(b) - wrap01(a);
  if (d > 0.5) d -= 1;
  if (d <= -0.5) d += 1;
  return d;
}

/** Segment index + local t for a lap-progress fraction. */
function locate(track: Track, progress: number): { seg: number; t: number } {
  const target = wrap01(progress) * track.totalLen;
  // Binary search over cumLen — called every frame for boxes/waves/rendering.
  let lo = 0;
  let hi = track.cumLen.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track.cumLen[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  const len = track.segLen[lo] || 1;
  return { seg: lo, t: Math.min(1, (target - track.cumLen[lo]) / len) };
}

export function pointAt(track: Track, progress: number): Vec2 {
  const { seg, t } = locate(track, progress);
  const a = track.points[seg];
  const b = track.points[(seg + 1) % track.points.length];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Unit tangent (direction of travel) at a lap-progress fraction. */
export function tangentAt(track: Track, progress: number): Vec2 {
  const { seg } = locate(track, progress);
  const a = track.points[seg];
  const b = track.points[(seg + 1) % track.points.length];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

/** Unit normal (left of travel) at a lap-progress fraction. */
export function normalAt(track: Track, progress: number): Vec2 {
  const t = tangentAt(track, progress);
  return { x: -t.y, y: t.x };
}

export interface Projection {
  /** Lap-progress fraction of the nearest centerline point. */
  progress: number;
  /** Distance from the centerline (always ≥ 0). */
  dist: number;
  /** Unit vector from the centerline point toward the queried point. */
  nx: number;
  ny: number;
  /** Segment index — feed back in as `nearSeg` next frame. */
  seg: number;
}

/**
 * Nearest point on the centerline.
 *
 * With a `nearSeg` hint, only a window around the previous answer is
 * searched. That's not (just) an optimisation: where two parts of a track
 * pass near each other, a full scan could snap a kart to the *other* pass of
 * the road for a frame and teleport its lap progress. The window makes the
 * projection continuous — a kart can only walk segment by segment.
 */
export function project(track: Track, p: Vec2, nearSeg?: number): Projection {
  const n = track.points.length;
  let from = 0;
  let to = n;
  const WINDOW = 30; // segments each way ≈ a quarter lap on the smallest track
  if (nearSeg !== undefined) {
    from = nearSeg - WINDOW;
    to = nearSeg + WINDOW;
  }
  let best = Infinity;
  let bestSeg = 0;
  let bestT = 0;
  for (let i = from; i < to; i++) {
    const seg = ((i % n) + n) % n;
    const a = track.points[seg];
    const b = track.points[(seg + 1) % n];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    let t = lenSq > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const cx = a.x + abx * t;
    const cy = a.y + aby * t;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = dx * dx + dy * dy;
    if (d < best) {
      best = d;
      bestSeg = seg;
      bestT = t;
    }
  }
  const a = track.points[bestSeg];
  const b = track.points[(bestSeg + 1) % n];
  const cx = a.x + (b.x - a.x) * bestT;
  const cy = a.y + (b.y - a.y) * bestT;
  const dist = Math.sqrt(best);
  const s = track.cumLen[bestSeg] + track.segLen[bestSeg] * bestT;
  return {
    progress: wrap01(s / track.totalLen),
    dist,
    nx: dist > 1e-6 ? (p.x - cx) / dist : 0,
    ny: dist > 1e-6 ? (p.y - cy) / dist : 0,
    seg: bestSeg,
  };
}

/**
 * Did moving from progress `prev` to `cur` cross checkpoint `cp` going
 * forward? Backwards movement never crosses, and a jump of more than a
 * quarter lap in one tick is treated as nonsense rather than a crossing —
 * that's the anti-cutting property the lap counter builds on.
 */
export function crossedCheckpoint(prev: number, cur: number, cp: number): boolean {
  const d = forwardDelta(prev, cur);
  if (d <= 0 || d > 0.25) return false;
  const toCp = forwardDelta(prev, cp);
  return toCp > 0 && toCp <= d;
}

/**
 * Grid slot for a kart. Both karts start just *past* the start line, side by
 * side — starting behind it would make the first line-crossing count as a
 * completed lap (see the lap counter in engine.ts), so we start beyond it
 * with `nextCp = 1` and the numbers stay honest with zero special cases.
 */
export function startPose(track: Track, slot: 0 | 1): { x: number; y: number; heading: number } {
  const progress = 0.008 + slot * 0.012;
  const p = pointAt(track, progress);
  const t = tangentAt(track, progress);
  const nrm = normalAt(track, progress);
  const side = slot === 0 ? -0.4 : 0.4;
  return {
    x: p.x + nrm.x * track.def.halfWidth * side,
    y: p.y + nrm.y * track.def.halfWidth * side,
    heading: Math.atan2(t.y, t.x),
  };
}
