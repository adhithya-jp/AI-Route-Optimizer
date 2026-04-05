// ─────────────────────────────────────────────
// GraphGenerator.js
// Generates a random city road-network graph.
// Uses a Relative Neighbourhood Graph approach
// to keep edges logical and non-redundant.
// ─────────────────────────────────────────────

// Wide viewBox to match a ~2:1 widescreen panel
export const SVG_W   = 1600;
export const SVG_H   = 820;
const PADDING        = 65;          // breathing room on edges
const NODE_COUNT     = 60;          // dense but not overcrowded
const GRID_SIZE      = 20;
const MIN_DIST       = 80;          // minimum pixels between nodes

// Max edge length as a fraction of canvas diagonal — no cross-map roads
const DIAG           = Math.sqrt(SVG_W ** 2 + SVG_H ** 2);
const MAX_EDGE_PX    = DIAG * 0.28; // ~485px on a 1600×820 canvas

// Labels pool  A1–F10 covers 60 nodes
const LABEL_PREFIXES = ['A','B','C','D','E','F','G','H','I','J'];

/** Euclidean distance between two nodes */
export function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** Map SVG coordinate to grid cell (0-19) */
function svgToGrid(val, svgMax) {
  const usable  = svgMax - 2 * PADDING;
  const clamped = Math.max(0, Math.min(val - PADDING, usable));
  return Math.round((clamped / usable) * (GRID_SIZE - 1));
}

/** Poisson-disk-lite: reject nodes that are too close together */
function placedNodes() {
  const all = [];
  let attempts = 0;
  while (all.length < NODE_COUNT && attempts < 8000) {
    attempts++;
    const x = PADDING + Math.random() * (SVG_W - 2 * PADDING);
    const y = PADDING + Math.random() * (SVG_H - 2 * PADDING);
    const tooClose = all.some(n => Math.hypot(n.x - x, n.y - y) < MIN_DIST);
    if (!tooClose) {
      const idx    = all.length;
      const prefix = LABEL_PREFIXES[Math.floor(idx / 10)];
      const num    = (idx % 10) + 1;
      all.push({ id: idx, x, y, label: `${prefix}${num}`, gx: 0, gy: 0 });
    }
  }
  return all;
}

/** Ensure every node has a unique grid cell, nudging duplicates */
function assignUniqueGridCells(nodes) {
  const occupied = new Map();
  nodes.forEach(n => {
    let gx = svgToGrid(n.x, SVG_W);
    let gy = svgToGrid(n.y, SVG_H);
    let found = false;
    for (let step = 0; step < GRID_SIZE * GRID_SIZE && !found; step++) {
      const key = `${gx},${gy}`;
      if (!occupied.has(key)) {
        occupied.set(key, n.id);
        n.gx = gx;
        n.gy = gy;
        found = true;
      } else {
        const candidates = [
          [gx+1,gy],[gx-1,gy],[gx,gy+1],[gx,gy-1],
          [gx+1,gy+1],[gx-1,gy-1],[gx+1,gy-1],[gx-1,gy+1],
        ];
        for (const [nx,ny] of candidates) {
          if (nx>=0 && nx<GRID_SIZE && ny>=0 && ny<GRID_SIZE) {
            if (!occupied.has(`${nx},${ny}`)) { gx=nx; gy=ny; break; }
          }
        }
      }
    }
  });
}

/**
 * Relative Neighbourhood Graph test:
 * Returns true if no third node `w` lies inside the "lune"
 * (intersection of the two circles centred on a and b with radius dist(a,b)).
 * If a node IS in the lune, the edge a-b is redundant (w is a better path).
 */
function isRNGEdge(a, b, allNodes) {
  const d = dist(a, b);
  for (const w of allNodes) {
    if (w.id === a.id || w.id === b.id) continue;
    if (dist(a, w) < d && dist(b, w) < d) return false; // w is in the lune
  }
  return true;
}

/** Generate the full city graph */
export function generateCityGraph() {
  // ── 1. Place nodes ──────────────────────────
  const nodes = placedNodes();
  assignUniqueGridCells(nodes);

  // ── 2. Build edges ──────────────────────────
  const edgeSet = new Set();
  const edges   = [];

  const addEdge = (a, b) => {
    const key = `${Math.min(a,b)}-${Math.max(a,b)}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    const na = nodes[a];
    const nb = nodes[b];
    const euclidean  = dist(na, nb);
    const normalized = euclidean / DIAG;
    const toll       = parseFloat((Math.random() * 8).toFixed(2));
    let roadType;
    if (toll > 5)      roadType = 'highway';
    else if (toll > 2) roadType = 'main';
    else               roadType = 'local';
    edges.push({
      id: key, from: a, to: b,
      timeCost: normalized, tollCost: toll,
      roadType, blocked: false,
      trafficLevel: parseFloat(Math.random().toFixed(3)), // 0=always clear, 1=always jammed
    });
  };

  // ── RNG-filtered neighbour pass ─────────────────────────────────────────
  // For each node, consider its N nearest neighbours within MAX_EDGE_PX.
  // Only add the edge if it passes the Relative Neighbourhood Graph test
  // (no other node sits "between" the two, making the edge redundant).
  // Each node is guaranteed at least 2 connections via the fallback below.
  nodes.forEach((n, i) => {
    const candidates = nodes
      .filter((_, j) => j !== i)
      .map(nb => ({ nb, d: dist(n, nb) }))
      .filter(({ d }) => d <= MAX_EDGE_PX)
      .sort((a, b) => a.d - b.d)
      .slice(0, 8); // consider only 8 nearest so RNG check is fast

    // Add up to 3 RNG-passing edges per node
    let added = 0;
    for (const { nb } of candidates) {
      if (added >= 3) break;
      if (isRNGEdge(n, nb, nodes)) {
        addEdge(i, nb.id);
        added++;
      }
    }

    // Fallback: always connect to the 2 absolute nearest (keeps graph connected)
    candidates.slice(0, 2).forEach(({ nb }) => addEdge(i, nb.id));
  });

  // ── 3. Ensure full connectivity (Union-Find) ─────────────────────────────
  const parent = nodes.map((_, i) => i);
  const find   = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union  = (a, b) => { parent[find(a)] = find(b); };
  edges.forEach(e => union(e.from, e.to));

  // Bridge any disconnected components with the single shortest inter-component edge
  let changed = true;
  while (changed) {
    changed = false;
    nodes.forEach((n, i) => {
      const ri      = find(i);
      const foreign = nodes
        .filter((_, j) => j !== i && find(j) !== ri)
        .sort((a, b) => dist(n, a) - dist(n, b))[0];
      if (foreign) { addEdge(i, foreign.id); union(i, foreign.id); changed = true; }
    });
  }

  // ── 4. Build adjacency for pathfinding ───────────────────────────────────
  const adj = {};
  nodes.forEach(n => { adj[n.id] = []; });
  edges.forEach(e => {
    adj[e.from].push({ to: e.to,   edge: e });
    adj[e.to  ].push({ to: e.from, edge: e });
  });

  return { nodes, edges, adj, svgW: SVG_W, svgH: SVG_H };
}

// ─────────────────────────────────────────────
// Bresenham line — list of [x,y] grid cells
// ─────────────────────────────────────────────
export function bresenhamLine(x0, y0, x1, y1) {
  const cells = [];
  let dx = Math.abs(x1-x0), sx = x0<x1 ? 1 : -1;
  let dy = -Math.abs(y1-y0), sy = y0<y1 ? 1 : -1;
  let err = dx + dy;
  let cx = x0, cy = y0;
  while (true) {
    cells.push([cx, cy]);
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; cx += sx; }
    if (e2 <= dx) { err += dx; cy += sy; }
  }
  return cells;
}

/** Build grid cost map for the backend */
export function buildGridCostMap(nodes, edges) {
  const cellCost  = {};
  const wallCells = new Set();

  for (let x=0; x<GRID_SIZE; x++)
    for (let y=0; y<GRID_SIZE; y++)
      cellCost[`${x},${y}`] = 50;

  edges.forEach(e => {
    const na    = nodes[e.from];
    const nb    = nodes[e.to];
    const cells = bresenhamLine(na.gx, na.gy, nb.gx, nb.gy);
    const cost  = Math.max(0.5, e.timeCost * 19);

    if (e.blocked) {
      cells.forEach(([x,y]) => wallCells.add(`${x},${y}`));
    } else {
      cells.forEach(([x,y]) => {
        const k = `${x},${y}`;
        if (!cellCost[k] || cellCost[k] > cost) cellCost[k] = cost;
      });
    }
  });

  wallCells.forEach(k => delete cellCost[k]);
  return { cellCost, wallCells };
}
