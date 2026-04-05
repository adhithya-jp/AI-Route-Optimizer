// ─────────────────────────────────────────────
// api.js  —  Graph-based A* pathfinding + backend helpers
// ─────────────────────────────────────────────

const BASE = "http://localhost:8000";
const H    = { "Content-Type": "application/json" };

const post = (path, body) =>
  fetch(`${BASE}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) }).then(r => r.json());
const get  = (path) =>
  fetch(`${BASE}${path}`).then(r => r.json());

export const apiReset       = ()           => post("/reset",          {});
export const apiFindPath    = (s, g, mode) => post("/find-path",      { start: s, goal: g, mode });
export const apiSetWall     = (x, y)       => post("/set-wall",       { x, y });
export const apiClearWall   = (x, y)       => post("/clear-wall",     { x, y });
export const apiSetTraffic  = (x, y, cost) => post("/set-traffic",    { x, y, cost });
export const apiSetFlood    = (cells)      => post("/set-flood-zone",  { cells });
export const apiToggleTolls = (enabled)    => post("/toggle-tolls",   { enabled });
export const apiGridState   = ()           => get("/grid-state");

// ─────────────────────────────────────────────
// runPathfinding  —  A* on the node-edge graph
//
// Previously this mapped the visual graph onto a 20x20 grid,
// ran A* on the grid, then tried to reverse-map cell coords
// back to node ids.  That only matched cells that exactly hit
// a node's gx/gy, so the path collapsed to [start, goal]
// and was drawn as a straight "mid-air" line.
//
// Now we run A* directly on the adjacency list (nodes+edges),
// so every hop in the path is a real road edge.
//
// Returns: { path: [nodeId, …], totalCost, nodesExplored, success }
// ─────────────────────────────────────────────
export async function runPathfinding({ nodes, edges, startId, goalId, mode, trafficMult }) {
  const startNode = nodes.find(n => n.id === startId);
  const goalNode  = nodes.find(n => n.id === goalId);
  if (!startNode || !goalNode) return { success: false, path: [] };

  // Build adjacency, skipping blocked edges.
  // Each edge's cost is multiplied by its individual congestion state
  // (derived from its trafficLevel and the slider threshold).
  const t            = (trafficMult - 1) / 4;   // slider 1-5 → 0-1
  const heavyCutoff  = 1 - t * 0.35;
  const mediumCutoff = 1 - t * 0.55;

  const adj = {};
  nodes.forEach(n => { adj[n.id] = []; });
  edges.forEach(e => {
    if (e.blocked) return;
    const lvl = e.trafficLevel ?? 0;
    const congMult = lvl >= heavyCutoff  ? 4.0
                   : lvl >= mediumCutoff ? 2.0
                   : 1.0;
    const base = Math.max(0.001, e.timeCost) * congMult;
    const cost = mode === "money" ? base + e.tollCost : base;
    adj[e.from].push({ to: e.to,   cost });
    adj[e.to  ].push({ to: e.from, cost });
  });

  // Euclidean heuristic scaled to match timeCost units
  const DIAG = Math.sqrt(1600 * 1600 + 820 * 820);
  const heuristic = (nodeId) => {
    const n = nodes[nodeId];           // nodes array is index-aligned with id
    if (!n) return 0;
    return Math.hypot(n.x - goalNode.x, n.y - goalNode.y) / DIAG;
  };

  // A* search
  const open      = new MinHeap();
  const gScore    = new Array(nodes.length).fill(Infinity);
  const cameFrom  = new Array(nodes.length).fill(-1);
  let   nodesExplored = 0;

  gScore[startId] = 0;
  open.push({ id: startId, f: heuristic(startId) });

  while (!open.empty()) {
    const { id: cur } = open.pop();
    nodesExplored++;

    if (cur === goalId) {
      // Reconstruct path
      const path = [];
      let c = goalId;
      while (c !== -1) { path.unshift(c); c = cameFrom[c]; }
      return { success: true, path, totalCost: gScore[goalId], nodesExplored };
    }

    for (const { to, cost } of (adj[cur] || [])) {
      const g = gScore[cur] + cost;
      if (g < gScore[to]) {
        cameFrom[to] = cur;
        gScore[to]   = g;
        open.push({ id: to, f: g + heuristic(to) });
      }
    }
  }

  return { success: false, path: [], totalCost: 0, nodesExplored };
}

// ─────────────────────────────────────────────
// Minimal binary min-heap  (used by A* open set)
// ─────────────────────────────────────────────
class MinHeap {
  constructor() { this._d = []; }
  empty()  { return this._d.length === 0; }

  push(item) {
    this._d.push(item);
    let i = this._d.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._d[p].f <= this._d[i].f) break;
      [this._d[p], this._d[i]] = [this._d[i], this._d[p]];
      i = p;
    }
  }

  pop() {
    const top  = this._d[0];
    const last = this._d.pop();
    if (this._d.length > 0) {
      this._d[0] = last;
      let i = 0;
      while (true) {
        let s = i;
        const l = 2*i+1, r = 2*i+2;
        if (l < this._d.length && this._d[l].f < this._d[s].f) s = l;
        if (r < this._d.length && this._d[r].f < this._d[s].f) s = r;
        if (s === i) break;
        [this._d[s], this._d[i]] = [this._d[i], this._d[s]];
        i = s;
      }
    }
    return top;
  }
}
