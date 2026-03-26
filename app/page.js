"use client";
import { useEffect, useRef, useState, useCallback } from "react";

// ─── Node label generator: A-Z then AA,AB,... ───────────────────────────────
function nodeLabel(i) {
  if (i < 26) return String.fromCharCode(65 + i);
  const first = String.fromCharCode(65 + Math.floor((i - 26) / 26));
  const second = String.fromCharCode(65 + ((i - 26) % 26));
  return first + second;
}

// ─── Procedural Organic City Generator (Gabriel Graph + MST) ────────────────
function generateCityNetwork() {
  const nodes = [];
  const edges = [];
  
  // Exact distribution: 50% green (1-3), 30% yellow (4-5), 20% red (6-9)
  const edgeDist = [
    ...new Array(50).fill(0).map((_, i) => (i % 3) + 1),
    ...new Array(30).fill(0).map((_, i) => (i % 2) + 4),
    ...new Array(20).fill(0).map((_, i) => (i % 4) + 6),
  ];
  
  // Deterministic PRNG to prevent hydration mismatch
  let seed = 142; // Magic seed for perfect layout
  const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const getCost = () => edgeDist[Math.floor(random() * edgeDist.length)];

  const paddingX = 0.06, paddingY = 0.08;
  const usableW = 1 - paddingX * 2, usableH = 1 - paddingY * 2;

  // 1. Hub definitions: 3 Big, 2 Medium (Node density reduced to avoid visual clutter)
  const hubs = [
    { x: 0.18, y: 0.25, type: "big", count: 20, r: 0.16 }, 
    { x: 0.82, y: 0.75, type: "big", count: 20, r: 0.16 }, 
    { x: 0.50, y: 0.50, type: "big", count: 28, r: 0.20 }, 
    { x: 0.80, y: 0.20, type: "medium", count: 10, r: 0.09 }, 
    { x: 0.20, y: 0.80, type: "medium", count: 10, r: 0.09 }, 
  ];

  function isValid(nx, ny, minDist) {
    if (nx < paddingX || nx > 1 - paddingX || ny < paddingY || ny > 1 - paddingY) return false;
    for (const n of nodes) {
      const dx = n.nx - nx, dy = n.ny - ny;
      if (Math.sqrt(dx*dx + dy*dy) < minDist) return false;
    }
    return true;
  }

  const hubCenters = [];

  // Populate hubs
  for (const hub of hubs) {
    let placed = 0, attempts = 0;
    if (isValid(hub.x, hub.y, 0.04)) { 
       hubCenters.push(nodes.length);
       nodes.push({ nx: hub.x, ny: hub.y, isLandmark: true }); 
       placed++; 
    } else {
       hubCenters.push(-1);
    }
    
    while (placed < hub.count && attempts < 600) {
      attempts++;
      const angle = random() * Math.PI * 2;
      const dist = random() * hub.r;
      const nx = hub.x + Math.cos(angle) * dist;
      const ny = hub.y + Math.sin(angle) * dist * 1.5; // Scale Y for screen aspect ratio
      
      if (isValid(nx, ny, 0.035)) {
        nodes.push({ nx, ny, isLandmark: random() > 0.65 }); // 35% chance to generate as a Landmark Node
        placed++;
      }
    }
  }

  // Generate Arterial Highways bridging the hubs
  const links = [[0,2], [1,2], [3,2], [4,2], [0,4], [3,1]];
  for (const [h1, h2] of links) {
    const p1 = hubs[h1], p2 = hubs[h2];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const steps = Math.floor(dist / 0.07);
    for (let i = 1; i < steps; i++) {
       const nx = p1.x + (dx * i) / steps + (random() - 0.5) * 0.02;
       const ny = p1.y + (dy * i) / steps + (random() - 0.5) * 0.02;
       if (isValid(nx, ny, 0.025)) nodes.push({ nx, ny, isLandmark: random() > 0.75 }); // 25% chance
    }
  }

  // 2. Compute Gabriel Graph
  const tempEdges = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const n1 = nodes[i], n2 = nodes[j];
      const cx = (n1.nx + n2.nx) / 2, cy = (n1.ny + n2.ny) / 2;
      const radiusSq = (Math.pow(n1.nx - n2.nx, 2) + Math.pow(n1.ny - n2.ny, 2)) / 4;
      
      let gabriel = true;
      for (let k = 0; k < nodes.length; k++) {
        if (k === i || k === j) continue;
        const nk = nodes[k];
        const distSq = Math.pow(nk.nx - cx, 2) + Math.pow(nk.ny - cy, 2);
        if (distSq < radiusSq) { gabriel = false; break; }
      }
      if (gabriel) tempEdges.push([i, j]);
    }
  }

  // 3. Spanning Tree + Loop Restoration (100% Reachability + Dead Ends)
  class UnionFind {
    constructor(n) { this.parent = Array.from({length:n}, (_,i)=>i); }
    find(i) { if (this.parent[i] == i) return i; return this.parent[i] = this.find(this.parent[i]); }
    union(i, j) { 
      const rI = this.find(i), rJ = this.find(j);
      if (rI != rJ) { this.parent[rI] = rJ; return true; }
      return false;
    }
  }

  const uf = new UnionFind(nodes.length);
  tempEdges.sort((a,b) => {
    const d1 = Math.pow(nodes[a[0]].nx - nodes[a[1]].nx, 2) + Math.pow(nodes[a[0]].ny - nodes[a[1]].ny, 2);
    const d2 = Math.pow(nodes[b[0]].nx - nodes[b[1]].nx, 2) + Math.pow(nodes[b[0]].ny - nodes[b[1]].ny, 2);
    return d1 - d2;
  });

  const unusedEdges = [];
  for (const [u, v] of tempEdges) {
    if (uf.union(u, v)) edges.push([u, v, getCost()]);
    else unusedEdges.push([u, v]);
  }

  // Add back a small fraction (20%) of loop edges to drastically thin out the road clatter
  for (const [u, v] of unusedEdges) {
     if (random() > 0.80) edges.push([u, v, getCost()]); // 20% retention
  }

  return { nodes, edges };
}

// Generate the organic nodal city (~150 nodes)
const network = generateCityNetwork();
const RAW_NODES = network.nodes;
const RAW_EDGES = network.edges;

// ─── A* algorithm ─────────────────────────────────────────────────────────────
function heuristic(a, b, mode) {
  const dx = a.nx - b.nx, dy = a.ny - b.ny;
  // Minimum traffic multiplier is 1, length scalar is 1000
  return Math.sqrt(dx * dx + dy * dy) * 1000;
}

function aStar(startIdx, goalIdx, nodes, adj, mode) {
  const open = new Map();
  const gScore = new Array(nodes.length).fill(Infinity);
  const cameFrom = new Array(nodes.length).fill(-1);
  gScore[startIdx] = 0;
  open.set(startIdx, heuristic(nodes[startIdx], nodes[goalIdx], mode));

  while (open.size > 0) {
    let current = -1, best = Infinity;
    for (const [node, f] of open) {
      if (f < best) { best = f; current = node; }
    }
    if (current === goalIdx) {
      const path = [];
      let c = current;
      while (c !== -1) { path.unshift(c); c = cameFrom[c]; }
      return path;
    }
    open.delete(current);
    for (const [neighbor, costTime, costDist] of (adj[current] || [])) {
      const edgeCost = mode === "time" ? costTime : costDist;
      const tentG = gScore[current] + edgeCost;
      if (tentG < gScore[neighbor]) {
        gScore[neighbor] = tentG;
        cameFrom[neighbor] = current;
        open.set(neighbor, tentG + heuristic(nodes[neighbor], nodes[goalIdx], mode));
      }
    }
  }
  return [];
}

function buildAdj(edges, nodes) {
  const adj = Array.from({ length: nodes.length }, () => []);
  for (const [a, b, traffic] of edges) {
    const dx = nodes[a].nx - nodes[b].nx;
    const dy = nodes[a].ny - nodes[b].ny;
    const length = Math.floor(Math.sqrt(dx*dx + dy*dy) * 1000);
    const cost = length * traffic; // Travel time is length * traffic
    adj[a].push([b, cost, length, traffic]);
    adj[b].push([a, cost, length, traffic]);
  }
  return adj;
}

function pathCost(path, adj) {
  let c = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const edge = adj[path[i]]?.find(([n]) => n === path[i + 1]);
    if (edge) c += edge[1];
  }
  return c;
}

function greedyMultiTarget(start, targets, nodes, adj, mode) {
  let fullPath = [start];
  let remaining = [...targets];
  let current = start;
  while (remaining.length > 0) {
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const t = remaining[i];
      const dx = nodes[current].nx - nodes[t].nx;
      const dy = nodes[current].ny - nodes[t].ny;
      const d = Math.sqrt(dx*dx + dy*dy);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const nextTarget = remaining.splice(bestIdx, 1)[0];
    const seg = aStar(current, nextTarget, nodes, adj, mode);
    if (seg.length > 1) fullPath = [...fullPath, ...seg.slice(1)];
    current = nextTarget;
  }
  return fullPath;
}

// ─── Traffic color helper ─────────────────────────────────────────────────────
function trafficColor(cost) {
  if (cost <= 3) return "#22c55e";
  if (cost <= 5) return "#eab308";
  return "#ef4444";
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AStarRouter() {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const [mode, setMode] = useState("idle"); // idle | setStart | addTarget
  const [startNode, setStartNode] = useState(null);
  const [targets, setTargets] = useState([]);
  const [pathTime, setPathTime] = useState([]);
  const [pathDist, setPathDist] = useState([]);
  const [animStep, setAnimStep] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const [showMetrics, setShowMetrics] = useState(true);
  const [metrics, setMetrics] = useState({ nodes: 0, costTime: 0, costDist: 0 });
  
  const [cam, setCam] = useState({ x: 0, y: 0, scale: 1 });
  const isDragging = useRef(false);
  const hasDragged = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const animRef = useRef(null);

  // Responsive resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        setDims({ w: Math.max(width, 300), h: Math.max(height, 300) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mapWidth = 2000;
  const mapHeight = 1200;

  // Scaled node positions
  const nodes = RAW_NODES.map((n, i) => ({
    ...n,
    x: n.nx * mapWidth,
    y: n.ny * mapHeight,
    label: nodeLabel(i),
    idx: i,
  }));

  const adj = buildAdj(RAW_EDGES, nodes);

  // ─── Draw ──────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    
    // Clear screen
    ctx.clearRect(0, 0, dims.w, dims.h);

    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.scale, cam.scale);

    // Background grid
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    const step = Math.min(mapWidth, mapHeight) / 20;
    const gridBounds = Math.max(mapWidth, mapHeight) * 4; 
    
    for (let x = -gridBounds; x < gridBounds; x += step) {
      ctx.beginPath(); ctx.moveTo(x, -gridBounds); ctx.lineTo(x, gridBounds); ctx.stroke();
    }
    for (let y = -gridBounds; y < gridBounds; y += step) {
      ctx.beginPath(); ctx.moveTo(-gridBounds, y); ctx.lineTo(gridBounds, y); ctx.stroke();
    }

    // Build path edge sets progressively
    const timeEdges = new Set();
    const limitT = animStep >= 0 ? Math.min(animStep, pathTime.length - 1) : -1;
    for (let i = 0; i < limitT; i++) {
      timeEdges.add(`${pathTime[i]}-${pathTime[i+1]}`);
    }
    const distEdges = new Set();
    const limitD = animStep >= 0 ? Math.min(animStep, pathDist.length - 1) : -1;
    for (let i = 0; i < limitD; i++) {
      distEdges.add(`${pathDist[i]}-${pathDist[i+1]}`);
    }

    // Draw edges
    for (const [a, b, cost] of RAW_EDGES) {
      const na = nodes[a], nb = nodes[b];
      const codeAB = `${a}-${b}`, codeBA = `${b}-${a}`;
      const onTime = timeEdges.has(codeAB) || timeEdges.has(codeBA);
      const onDist = distEdges.has(codeAB) || distEdges.has(codeBA);
      
      const dx = nb.x - na.x, dy = nb.y - na.y;
      const len = Math.sqrt(dx*dx + dy*dy) || 1;
      const ux = dx/len, uy = dy/len;
      const sx = na.x, sy = na.y;
      const ex = nb.x, ey = nb.y;

      const tCol = trafficColor(cost);
      const isActivePath = onTime || onDist;

      // 1. Core Traffic Highway: Always geometrically centered
      // Pulled up to maximum opacity and glowing if it's currently holding an active AI Route
      ctx.save();
      ctx.strokeStyle = tCol; 
      ctx.lineWidth = 3.5; 
      ctx.globalAlpha = isActivePath ? 1.0 : 0.25; 
      if (isActivePath) { ctx.shadowColor = tCol; ctx.shadowBlur = 3; }
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.restore();

      // 2. Tracking Algorithms: Calculate parallel offset parameters so neon paths slide next to the traffic line
      const offset = 4.0;
      const ox = -uy * offset, oy = ux * offset;

      if (onTime) {
         ctx.save();
         ctx.shadowColor = "#22d3ee"; ctx.shadowBlur = 5;
         ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 3.0; ctx.globalAlpha = 1;
         // Draw Cyan explicitly shifted entirely to the right parallel side
         ctx.beginPath(); ctx.moveTo(sx + ox, sy + oy); ctx.lineTo(ex + ox, ey + oy); ctx.stroke();
         ctx.restore();
      }

      if (onDist) {
         ctx.save();
         ctx.shadowColor = "#d946ef"; ctx.shadowBlur = 5;
         ctx.strokeStyle = "#d946ef"; ctx.lineWidth = 3.0; ctx.globalAlpha = 1;
         // Draw Fuchsia explicitly shifted entirely to the left parallel side
         ctx.beginPath(); ctx.moveTo(sx - ox, sy - oy); ctx.lineTo(ex - ox, ey - oy); ctx.stroke();
         ctx.restore();
      }

      // Always show pills
      if (showMetrics) {
         const edgeData = adj[a].find(([n]) => n === b);
         const length = edgeData ? edgeData[2] : 0;
         const mx = (na.x + nb.x) / 2;
         const my = (na.y + nb.y) / 2;
         const pCol = (onTime && onDist) ? "#f8fafc" : onTime ? "#22d3ee" : onDist ? "#d946ef" : trafficColor(cost);
         drawCostPill(ctx, mx, my, length, cost, pCol);
      }
    }

    // Animated path glow
    if (animStep >= 1) {
      ctx.save();
      
      const offset = 2.5;
      
      // Draw time dot path
      ctx.shadowColor = "#22d3ee"; ctx.shadowBlur = 10;
      ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 3; ctx.setLineDash([6, 3]);
      for (let i = 0; i < Math.min(animStep, pathTime.length - 1); i++) {
        const na = nodes[pathTime[i]], nb = nodes[pathTime[i+1]];
        const isOverlap = pathDist.includes(pathTime[i]) && pathDist.includes(pathTime[i+1]);
        const dx = nb.x - na.x, dy = nb.y - na.y;
        const len = Math.sqrt(dx*dx + dy*dy) || 1;
        const ux = dx/len, uy = dy/len;
        const ox = isOverlap ? -uy * offset : 0, oy = isOverlap ? ux * offset : 0;
        ctx.beginPath(); ctx.moveTo(na.x + ox, na.y + oy); ctx.lineTo(nb.x + ox, nb.y + oy); ctx.stroke();
      }
      
      // Draw dist dot path
      ctx.shadowColor = "#d946ef"; ctx.shadowBlur = 10;
      ctx.strokeStyle = "#d946ef"; ctx.lineWidth = 3; ctx.setLineDash([6, 3]);
      for (let i = 0; i < Math.min(animStep, pathDist.length - 1); i++) {
        const na = nodes[pathDist[i]], nb = nodes[pathDist[i+1]];
        const isOverlap = pathTime.includes(pathDist[i]) && pathTime.includes(pathDist[i+1]);
        const dx = nb.x - na.x, dy = nb.y - na.y;
        const len = Math.sqrt(dx*dx + dy*dy) || 1;
        const ux = dx/len, uy = dy/len;
        const ox = isOverlap ? -uy * -offset : 0, oy = isOverlap ? ux * -offset : 0;
        ctx.beginPath(); ctx.moveTo(na.x + ox, na.y + oy); ctx.lineTo(nb.x + ox, nb.y + oy); ctx.stroke();
      }
      
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Draw nodes
    const nodeR = Math.max(12, Math.min(mapWidth, mapHeight) * 0.022);
    for (const n of nodes) {
      const isStart = n.idx === startNode;
      const tIdx = targets.indexOf(n.idx);
      const isTarget = tIdx !== -1;
      const isOnPath = pathTime.includes(n.idx) || pathDist.includes(n.idx);
      const isVisited = (animStep >= 0 && pathTime.slice(0, animStep + 1).includes(n.idx)) || 
                        (animStep >= 0 && pathDist.slice(0, animStep + 1).includes(n.idx));
                        
      // Visibility threshold: Only true geographic landmarks ever spawn full outer rings and floating text variables.
      const isVisible = n.isLandmark;

      if (!isVisible) {
         // Draw structural connection dot (25% size) joining intersections cleanly
         ctx.beginPath();
         ctx.arc(n.x, n.y, nodeR * 0.25, 0, Math.PI * 2);
         ctx.fillStyle = isVisited ? "#164e63" : "#1e293b"; // Dark cyan if visited
         ctx.fill();
         ctx.strokeStyle = isOnPath ? "#22d3ee" : "rgba(255, 255, 255, 0.25)"; // Glowing cyan perimeter if targeted
         ctx.lineWidth = isOnPath ? 1.5 : 1;
         ctx.stroke();
         continue; // Stop rendering massive rings and text labels for this iteration
      }

      // Outer ring
      if (isStart) {
        ctx.save();
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.arc(n.x, n.y, nodeR + 5, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
      if (isTarget) {
        ctx.save();
        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.arc(n.x, n.y, nodeR + 5, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Node fill
      let fillColor = "#1e293b";
      if (isStart) fillColor = "#1d4ed8";
      else if (isTarget) fillColor = "#15803d";
      else if (isVisited) fillColor = "#164e63";

      ctx.beginPath();
      ctx.arc(n.x, n.y, nodeR, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = isStart ? "#60a5fa" : isTarget ? "#4ade80" : isOnPath ? "#22d3ee" : "rgba(255,255,255,0.15)";
      ctx.lineWidth = isStart || isTarget || isOnPath ? 2 : 1;
      ctx.stroke();

      // Label
      const labelSize = n.label.length > 1 ? Math.max(7, nodeR * 0.55) : Math.max(9, nodeR * 0.7);
      ctx.font = `900 ${labelSize}px 'Courier New', monospace`; // 900 weight for maximum crispness
      ctx.fillStyle = "#ffffff"; // Pure white for highest contrast
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      
      // Extreme contrast drop-shadow ensuring the letter boundaries remain sharp when down-sampled
      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 1)";
      ctx.shadowBlur = 2;
      ctx.shadowOffsetX = 0.5;
      ctx.shadowOffsetY = 0.5;
      ctx.fillText(n.label, n.x, n.y);
      ctx.restore();

      // Target number badge
      if (isTarget) {
        ctx.fillStyle = "#22c55e";
        ctx.beginPath();
        ctx.arc(n.x + nodeR - 2, n.y - nodeR + 2, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = "bold 7px monospace";
        ctx.fillStyle = "#000";
        ctx.fillText(`${tIdx+1}`, n.x + nodeR - 2, n.y - nodeR + 2);
      }
    }

    // Animated dot
    if (animStep >= 0) {
      if (pathTime.length > 0) {
        const tStep = animStep % pathTime.length;
        const nt = nodes[pathTime[tStep]];
        ctx.save(); ctx.shadowColor = "#22d3ee"; ctx.shadowBlur = 16;
        ctx.fillStyle = "#22d3ee"; ctx.beginPath(); ctx.arc(nt.x, nt.y, nodeR * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      if (pathDist.length > 0) {
        const dStep = animStep % pathDist.length;
        const nd = nodes[pathDist[dStep]];
        ctx.save(); ctx.shadowColor = "#d946ef"; ctx.shadowBlur = 16;
        ctx.fillStyle = "#d946ef"; ctx.beginPath(); ctx.arc(nd.x, nd.y, nodeR * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    }
    
    ctx.restore();
  }, [dims, nodes, startNode, targets, pathTime, pathDist, animStep, cam, mapWidth, mapHeight, adj, showMetrics]);

  useEffect(() => { draw(); }, [draw]);


  function drawCostPill(ctx, x, y, len, traffic, borderCol) {
    ctx.save();
    ctx.font = "bold 7.5px 'Courier New', monospace";
    const text = `L:${len} | T:${traffic}`;
    const tw = ctx.measureText(text).width;
    const w = tw + 10, h = 13;
    
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = "#0f172a";
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 1;
    roundRect(ctx, x - w/2, y - h/2, w, h, 3);
    ctx.fill(); ctx.stroke();
    
    ctx.fillStyle = borderCol;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 1;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ─── Canvas Interaction ────────────────────────────────────────────────────
  const handlePointerDown = (e) => {
    isDragging.current = true;
    hasDragged.current = false;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    e.target.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setCam(c => ({ ...c, x: c.x + dx, y: c.y + dy }));
  };

  const handlePointerUp = (e) => {
    isDragging.current = false;
    e.target.releasePointerCapture(e.pointerId);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const handleWheel = (e) => {
      e.preventDefault();
      const zoomSensitivity = 0.001;
      const delta = -e.deltaY * zoomSensitivity;
      
      setCam(c => {
        const newScale = Math.max(0.1, Math.min(c.scale * (1 + delta), 8));
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const worldX = (mx - c.x) / c.scale;
        const worldY = (my - c.y) / c.scale;
        return {
          scale: newScale,
          x: mx - worldX * newScale,
          y: my - worldY * newScale
        };
      });
    };
    
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  const handleCanvasClick = useCallback((e) => {
    if (isRunning) return;
    if (hasDragged.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    
    const worldX = (mx - cam.x) / cam.scale;
    const worldY = (my - cam.y) / cam.scale;

    const nodeR = Math.max(12, Math.min(mapWidth, mapHeight) * 0.022);
    for (const n of nodes) {
      if (!n.isLandmark) continue; // Only true Nodes (Landmarks) are selectable targets
      
      const dx = worldX - n.x, dy = worldY - n.y;
      if (Math.sqrt(dx*dx + dy*dy) < nodeR + 6) {
        if (mode === "setStart") {
          setStartNode(n.idx);
          setMode("idle");
        } else if (mode === "addTarget") {
          if (n.idx !== startNode && !targets.includes(n.idx)) {
            setTargets(prev => [...prev, n.idx]);
          }
        }
        return;
      }
    }
  }, [mode, startNode, targets, nodes, isRunning, cam, mapWidth, mapHeight]);

  // ─── Run A* ───────────────────────────────────────────────────────────────
  const runAStar = useCallback(() => {
    if (startNode === null || targets.length === 0) return;
    const fullTime = greedyMultiTarget(startNode, targets, RAW_NODES, adj, "time");
    const fullDist = greedyMultiTarget(startNode, targets, RAW_NODES, adj, "distance");
    setPathTime(fullTime);
    setPathDist(fullDist);
    setAnimStep(0);
    setMetrics({ nodesTime: 1, costTime: 0, costDist: 0 });
    setIsRunning(true);

    let step = 0;
    let runTimeCost = 0;
    let runDistCost = 0;
    if (animRef.current) clearInterval(animRef.current);
    animRef.current = setInterval(() => {
      step++;
      const maxLen = Math.max(fullTime.length, fullDist.length);
      
      if (step < maxLen) {
        if (step < fullTime.length) {
          const edgeT = adj[fullTime[step-1]]?.find(([n]) => n === fullTime[step]);
          if (edgeT) runTimeCost += edgeT[1]; // costTime
        }
        if (step < fullDist.length) {
          const edgeD = adj[fullDist[step-1]]?.find(([n]) => n === fullDist[step]);
          if (edgeD) runDistCost += edgeD[2]; // costDist
        }
        setMetrics({ nodesTime: Math.min(step + 1, fullTime.length), costTime: runTimeCost, costDist: runDistCost });
      } else if (step === maxLen) {
        setIsRunning(false); // Unlock UI buttons
      }
      
      // Loop animStep forever to keep dots cycling
      setAnimStep(step);
    }, 280);
  }, [startNode, targets, adj]);

  const reset = () => {
    if (animRef.current) clearInterval(animRef.current);
    setStartNode(null);
    setTargets([]);
    setPathTime([]);
    setPathDist([]);
    setAnimStep(-1);
    setIsRunning(false);
    setMetrics({ nodesTime: 0, costTime: 0, costDist: 0 });
    setMode("idle");
  };

  // ─── UI ────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex", flexDirection: "column", width: "100vw", height: "100vh",
      background: "#020617", color: "#e2e8f0", fontFamily: "'Courier New', monospace",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "10px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(15,23,42,0.95)", flexShrink: 0,
      }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: "bold", color: "#22d3ee", letterSpacing: 2 }}>
            ▲ TEST MULTI-DIRECT V2 ROUTER
          </span>
          <span style={{ fontSize: 10, color: "#64748b", marginLeft: 14 }}>
            {nodes.filter(n => n.isLandmark).length} Nodes · {nodes.filter(n => !n.isLandmark).length} Points · {RAW_EDGES.length} Edges
          </span>
        </div>
        {/* Legend */}
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          {[["#22c55e","Low ≤3"],["#ef4444","High >5"],["#22d3ee","Fastest Route"],["#d946ef","Shortest Route"]].map(([c,l]) => (
            <span key={l} style={{ display:"flex", alignItems:"center", gap:5, fontSize:10, color:"#94a3b8" }}>
              <span style={{ width:18, height:3, background:c, display:"inline-block", borderRadius:2 }}/>
              {l}
            </span>
          ))}
        </div>
      </div>

      {/* Controls + Metrics */}
      <div style={{
        padding: "8px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex", alignItems: "center", gap: 10, background: "rgba(15,23,42,0.7)",
        flexShrink: 0, flexWrap: "wrap",
      }}>
        {/* Mode buttons */}
        {[
          { label: "◎ Set Start", m: "setStart", active: mode === "setStart", color: "#3b82f6" },
          { label: "◉ Add Target", m: "addTarget", active: mode === "addTarget", color: "#22c55e" },
        ].map(btn => (
          <button key={btn.m}
            onClick={() => !isRunning && setMode(mode === btn.m ? "idle" : btn.m)}
            style={{
              padding: "5px 12px", fontSize: 11, fontFamily: "inherit",
              background: btn.active ? btn.color + "22" : "transparent",
              border: `1px solid ${btn.active ? btn.color : "rgba(255,255,255,0.15)"}`,
              color: btn.active ? btn.color : "#94a3b8",
              borderRadius: 4, cursor: isRunning ? "not-allowed" : "pointer",
              transition: "all 0.15s",
            }}>
            {btn.label}
          </button>
        ))}

        <button onClick={runAStar} disabled={startNode === null || targets.length === 0 || isRunning}
          style={{
            padding: "5px 14px", fontSize: 11, fontFamily: "inherit",
            background: "#22d3ee18", border: "1px solid #22d3ee",
            color: "#22d3ee", borderRadius: 4,
            cursor: (startNode === null || targets.length === 0 || isRunning) ? "not-allowed" : "pointer",
            opacity: (startNode === null || targets.length === 0 || isRunning) ? 0.4 : 1,
          }}>
          ▶ Run A*
        </button>

        <button onClick={reset} style={{
          padding: "5px 12px", fontSize: 11, fontFamily: "inherit",
          background: "transparent", border: "1px solid rgba(255,255,255,0.15)",
          color: "#64748b", borderRadius: 4, cursor: "pointer",
        }}>
          ↺ Reset
        </button>

        <button onClick={() => setShowMetrics(m => !m)} style={{
          padding: "5px 12px", fontSize: 11, fontFamily: "inherit",
          background: showMetrics ? "rgba(255,255,255,0.1)" : "transparent", 
          border: "1px solid rgba(255,255,255,0.15)",
          color: showMetrics ? "#e2e8f0" : "#64748b", borderRadius: 4, cursor: "pointer",
        }}>
          {showMetrics ? "Hide Edge Stats" : "Show Edge Stats"}
        </button>

        {/* Status pills */}
        <span style={{
          padding: "3px 10px", fontSize: 10, borderRadius: 20,
          background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)",
          color: startNode !== null ? "#60a5fa" : "#475569",
        }}>
          START: {startNode !== null ? nodes[startNode]?.label : "—"}
        </span>
        <span style={{
          padding: "3px 10px", fontSize: 10, borderRadius: 20,
          background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)",
          color: targets.length > 0 ? "#4ade80" : "#475569",
        }}>
          TARGETS: {targets.length > 0 ? targets.map(t => nodes[t]?.label).join(" → ") : "—"}
        </span>
        {/* ─── Metrics Box ─── */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {[
            { label: "TIME SCORE", val: metrics.costTime, color: "#22d3ee" },
            { label: "DIST SCORE", val: metrics.costDist, color: "#d946ef" },
          ].map(m => (
            <div key={m.label} style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              padding: "4px 14px", minWidth: 60,
              background: "rgba(0,0,0,0.2)",
              border: `1px solid ${m.color}40`,
              borderRadius: 6,
            }}>
              <span style={{ fontSize: 8, color: m.color, letterSpacing: 1.5 }}>{m.label}</span>
              <span style={{
                fontSize: 18, fontWeight: "bold", color: "#e0f2fe",
                lineHeight: 1.2, fontVariantNumeric: "tabular-nums",
              }}>{m.val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden", touchAction: "none" }}>
        <canvas
          ref={canvasRef}
          width={dims.w}
          height={dims.h}
          onClick={handleCanvasClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            display: "block", width: "100%", height: "100%",
            cursor: mode !== "idle" ? "crosshair" : "grab",
          }}
        />
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
      `}</style>
    </div>
  );
}