"use client";
import { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// 1. NODE LABEL GENERATOR  (A–Z then AA, AB, AC …)
// ─────────────────────────────────────────────────────────────────────────────
function nodeLabel(i) {
  if (i < 26) return String.fromCharCode(65 + i);
  const hi = Math.floor((i - 26) / 26);
  const lo = (i - 26) % 26;
  return String.fromCharCode(65 + hi) + String.fromCharCode(65 + lo);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. MANUAL EDGE COST TABLE  ← EDIT THIS TO CHANGE TRAFFIC WEIGHTS
//
//    Key format : "smallerIndex-largerIndex"
//                  always put the SMALLER node index first
//    Value      : cost integer  (1 = fastest/green … 9 = slowest/red)
//
//    HOW NODES ARE NUMBERED (grid lays out left→right, top→bottom):
//      cols auto-fits to screen width.  On a typical laptop:
//        Row 0:  A=0   B=1   C=2   D=3   E=4   F=5   G=6   H=7   I=8
//        Row 1:  J=9   K=10  L=11  M=12  N=13  O=14  P=15  Q=16  R=17
//        Row 2:  S=18  T=19  U=20  V=21  W=22  X=23  Y=24  Z=25  AA=26
//        Row 3:  AB=27 AC=28 AD=29 …
//
//    Horizontal edge example: A–B  → key "0-1"
//    Vertical   edge example: A–J  → key "0-9"   (one full row apart)
//
//    Any edge NOT listed here receives DEFAULT_COST (defined below).
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_COST = 4;

const EDGE_COSTS = {
  // ── Row 0 horizontals ─────────────────────────────────────────
  "0-1": 2, "1-2": 7, "2-3": 3, "3-4": 5,
  "4-5": 8, "5-6": 2, "6-7": 6, "7-8": 4,
  // ── Row 1 horizontals ─────────────────────────────────────────
  "9-10": 3, "10-11": 6, "11-12": 2, "12-13": 7,
  "13-14": 4, "14-15": 5, "15-16": 8, "16-17": 3,
  // ── Row 2 horizontals ─────────────────────────────────────────
  "18-19": 5, "19-20": 2, "20-21": 7, "21-22": 3,
  "22-23": 6, "23-24": 4, "24-25": 2, "25-26": 8,
  // ── Row 3 horizontals ─────────────────────────────────────────
  "27-28": 4, "28-29": 7, "29-30": 2, "30-31": 5,
  "31-32": 3, "32-33": 6, "33-34": 9, "34-35": 2,
  // ── Col 0 verticals ───────────────────────────────────────────
  "0-9": 6, "9-18": 3, "18-27": 7,
  // ── Col 1 verticals ───────────────────────────────────────────
  "1-10": 4, "10-19": 8, "19-28": 2,
  // ── Col 2 verticals ───────────────────────────────────────────
  "2-11": 5, "11-20": 3, "20-29": 6,
  // ── Col 3 verticals ───────────────────────────────────────────
  "3-12": 7, "12-21": 2, "21-30": 4,
  // ── Col 4 verticals ───────────────────────────────────────────
  "4-13": 3, "13-22": 6, "22-31": 8,
  // ── Col 5 verticals ───────────────────────────────────────────
  "5-14": 2, "14-23": 5, "23-32": 3,
  // ── Col 6 verticals ───────────────────────────────────────────
  "6-15": 7, "15-24": 4, "24-33": 6,
  // ── Col 7 verticals ───────────────────────────────────────────
  "7-16": 5, "16-25": 2, "25-34": 9,
  // ── Col 8 verticals ───────────────────────────────────────────
  "8-17": 4, "17-26": 7, "26-35": 3,
};

// Always look up with smaller index first
function edgeCost(a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return EDGE_COSTS[`${lo}-${hi}`] ?? DEFAULT_COST;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. GRAPH BUILDER  — positions derived from real pixel canvas size
// ────────────────────── ───────────────────────────────────────────────────────
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function buildGraph(w, h) {
  const margin = 20;
  const targetGap = 25;
  const usableW = Math.max(200, w - margin * 2);
  const usableH = Math.max(200, h - margin * 2);
  const cols = clamp(Math.round(usableW / targetGap) + 1, 4, 100);
  const rows = clamp(Math.round(usableH / targetGap) + 1, 3, 100);
  const gapX = cols > 1 ? usableW / (cols - 1) : 0;
  const gapY = rows > 1 ? usableH / (rows - 1) : 0;

  const nodes = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      nodes.push({
        idx, r, c,
        x: margin + c * gapX,
        y: margin + r * gapY,
        label: nodeLabel(idx),
      });
    }
  }

  // One undirected entry per pair: [a, b, cost]
  const undirected = [];
  const id = (r, c) => r * cols + c;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = id(r, c);
      if (c + 1 < cols) { const b = id(r, c + 1); undirected.push([a, b, edgeCost(a, b)]); }
      if (r + 1 < rows) { const b = id(r + 1, c); undirected.push([a, b, edgeCost(a, b)]); }
    }
  }

  // Bidirectional adjacency for A*
  const adj = Array.from({ length: nodes.length }, () => []);
  for (const [a, b, w] of undirected) {
    adj[a].push([b, w]);
    adj[b].push([a, w]);
  }

  return { nodes, undirected, adj, rows, cols };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. A*  +  GREEDY MULTI-TARGET
// ─────────────────────────────────────────────────────────────────────────────
function aStar(start, goal, nodes, adj) {
  const g = new Array(nodes.length).fill(Infinity);
  const from = new Array(nodes.length).fill(-1);
  g[start] = 0;
  const open = new Map([[start, Math.hypot(nodes[start].x - nodes[goal].x, nodes[start].y - nodes[goal].y) * 0.12]]);

  while (open.size) {
    let cur = -1, best = Infinity;
    for (const [n, f] of open) { if (f < best) { best = f; cur = n; } }
    if (cur === goal) {
      const path = []; let c = cur;
      while (c !== -1) { path.unshift(c); c = from[c]; }
      return path;
    }
    open.delete(cur);
    for (const [nb, w] of (adj[cur] || [])) {
      const ng = g[cur] + w;
      if (ng < g[nb]) {
        g[nb] = ng; from[nb] = cur;
        open.set(nb, ng + Math.hypot(nodes[nb].x - nodes[goal].x, nodes[nb].y - nodes[goal].y) * 0.12);
      }
    }
  }
  return [];
}

function greedyMultiTarget(start, targets, nodes, adj) {
  let path = [start], rem = [...targets], cur = start;
  while (rem.length) {
    let bi = 0, bd = Infinity;
    rem.forEach((t, i) => {
      const d = Math.hypot(nodes[cur].x - nodes[t].x, nodes[cur].y - nodes[t].y);
      if (d < bd) { bd = d; bi = i; }
    });
    const next = rem.splice(bi, 1)[0];
    const seg = aStar(cur, next, nodes, adj);
    if (seg.length > 1) path = [...path, ...seg.slice(1)];
    cur = next;
  }
  return path;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. TRAFFIC COLOR
// ─────────────────────────────────────────────────────────────────────────────
function trafficColor(cost) {
  if (cost <= 3) return "#10b981";
  if (cost <= 6) return "#f59e0b";
  return "#f43f5e";
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
const NR = 8; // node circle radius

export default function AStarRouter() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const graphRef = useRef(null);   // always holds latest graph for click handler

  const [size, setSize] = useState({ w: 900, h: 600 });
  const [mode, setMode] = useState("idle");
  const [startNode, setStartNode] = useState(null);
  const [targets, setTargets] = useState([]);
  const [path, setPath] = useState([]);
  const [animStep, setAnimStep] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const [metrics, setMetrics] = useState({ nodes: 0, cost: 0 });

  // ── TRUE RESPONSIVE: ResizeObserver → set pixel buffer immediately ──────────
  // useLayoutEffect runs synchronously after DOM mutation, before paint.
  // We write canvas.width / canvas.height directly (no React state round-trip)
  // so the buffer is always the right size before the next draw call.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const sync = () => {
      const { width, height } = wrap.getBoundingClientRect();
      const w = Math.max(Math.floor(width), 300);
      const h = Math.max(Math.floor(height), 260);
      const canvas = canvasRef.current;
      if (canvas && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;   // ← sets the pixel buffer directly, no state delay
        canvas.height = h;
      }
      setSize({ w, h }); // triggers redraw
    };

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // ── Rebuild graph whenever canvas size changes ──────────────────────────────
  const graph = buildGraph(size.w, size.h);
  graphRef.current = graph;
  const { nodes, undirected, adj } = graph;

  // Reset stale selections when grid reshapes
  useEffect(() => {
    const n = nodes.length;
    if (startNode !== null && startNode >= n) setStartNode(null);
    setTargets(ts => ts.filter(t => t < n));
    setPath([]);
    setAnimStep(-1);
    setIsRunning(false);
    if (animRef.current) clearTimeout(animRef.current);
  }, [nodes.length]); // eslint-disable-line

  // ── DRAW ────────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const { w, h } = size;
    ctx.clearRect(0, 0, w, h);

    // Dot-grid background
    ctx.fillStyle = "rgba(148,163,184,0.055)";
    for (let x = 30; x < w; x += 30)
      for (let y = 30; y < h; y += 30) {
        ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
      }

    // Directed edges revealed so far by animation
    const pathSet = new Set();
    const upto = clamp(animStep, -1, path.length - 1);
    for (let i = 0; i < Math.max(0, upto); i++) pathSet.add(`${path[i]}-${path[i + 1]}`);

    // ── Draw edges ────────────────────────────────────────────────────────
    for (const [a, b, cost] of undirected) {
      const na = nodes[a], nb = nodes[b];
      if (!na || !nb) continue;

      const fwd = pathSet.has(`${a}-${b}`);
      const bwd = pathSet.has(`${b}-${a}`);
      const onPath = fwd || bwd;

      const col = onPath ? "#22d3ee" : trafficColor(cost);
      const lw = onPath ? 2.6 : 1.2;

      const dx = nb.x - na.x, dy = nb.y - na.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const sx = na.x + ux * (NR + 2), sy = na.y + uy * (NR + 2);
      const ex = nb.x - ux * (NR + 2), ey = nb.y - uy * (NR + 2);

      ctx.save();
      ctx.globalAlpha = onPath ? 1 : 0.35;
      if (onPath) { ctx.shadowColor = "#22d3ee"; ctx.shadowBlur = 8; }
      ctx.strokeStyle = col; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();

      // Arrowhead on active path
      if (onPath) {
        const [fromN, toN] = fwd ? [na, nb] : [nb, na];
        const angle = Math.atan2(toN.y - fromN.y, toN.x - fromN.x);
        const tip = { x: toN.x - ux * (NR + 3), y: toN.y - uy * (NR + 3) };
        ctx.fillStyle = "#22d3ee"; ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x - 9 * Math.cos(angle - 0.4), tip.y - 9 * Math.sin(angle - 0.4));
        ctx.lineTo(tip.x - 9 * Math.cos(angle + 0.4), tip.y - 9 * Math.sin(angle + 0.4));
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();

      // Cost label — only if edge is long enough to fit it cleanly
      if (len > NR * 3.5) {
        const perpX = -uy * 12, perpY = ux * 12;
        const mx = (na.x + nb.x) / 2 + perpX;
        const my = (na.y + nb.y) / 2 + perpY;
        const tc = trafficColor(cost);

        ctx.save();
        ctx.globalAlpha = onPath ? 1 : 0.65;
        ctx.font = "bold 8px 'Courier New', monospace";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const tw = ctx.measureText(String(cost)).width + 6;

        // Dark pill behind number
        ctx.fillStyle = "rgba(2,6,12,0.82)";
        ctx.beginPath();
        ctx.roundRect(mx - tw / 2, my - 6.5, tw, 13, 3);
        ctx.fill();

        ctx.fillStyle = tc;
        ctx.fillText(String(cost), mx, my);
        ctx.restore();
      }
    }

    // ── Draw nodes ────────────────────────────────────────────────────────
    for (const n of nodes) {
      const isStart = n.idx === startNode;
      const tIdx = targets.indexOf(n.idx);
      const isTarget = tIdx !== -1;
      const isOnPath = path.includes(n.idx);
      const isVisited = animStep >= 0 && path.slice(0, animStep + 1).includes(n.idx);

      // Dashed ring
      if (isStart || isTarget) {
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = isStart ? "#3b82f6" : "#22c55e";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(n.x, n.y, NR + 6, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }

      ctx.beginPath(); ctx.arc(n.x, n.y, NR, 0, Math.PI * 2);
      ctx.fillStyle = isStart ? "#1d4ed8" : isTarget ? "#15803d" : isVisited ? "#0e4a5c" : "#1e293b";
      ctx.fill();
      ctx.strokeStyle = isStart ? "#60a5fa"
        : isTarget ? "#4ade80"
          : isOnPath ? "#22d3ee"
            : "rgba(255,255,255,0.10)";
      ctx.lineWidth = isStart || isTarget || isOnPath ? 1.8 : 1;
      ctx.stroke();

      ctx.font = `bold ${n.label.length > 1 ? 5.5 : 7}px 'Courier New', monospace`;
      ctx.fillStyle = "#f1f5f9";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(n.label, n.x, n.y);

      // Target order badge
      if (isTarget) {
        ctx.fillStyle = "#22c55e";
        ctx.beginPath(); ctx.arc(n.x + NR - 1, n.y - NR + 1, 6, 0, Math.PI * 2); ctx.fill();
        ctx.font = "bold 6px monospace";
        ctx.fillStyle = "#000";
        ctx.fillText(tIdx + 1, n.x + NR - 1, n.y - NR + 1);
      }
    }

    // Animated agent
    if (animStep >= 0 && animStep < path.length) {
      const n = nodes[path[animStep]];
      if (n) {
        ctx.save();
        ctx.shadowColor = "#e879f9"; ctx.shadowBlur = 20;
        ctx.fillStyle = "#e879f9";
        ctx.beginPath(); ctx.arc(n.x, n.y, 7, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
  }, [size, nodes, undirected, startNode, targets, path, animStep]);

  useEffect(() => { draw(); }, [draw]);

  // ── CLICK ───────────────────────────────────────────────────────────────────
  const handleClick = useCallback((e) => {
    if (isRunning) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    // Scale mouse → pixel buffer (handles CSS scaling)
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);

    for (const n of graphRef.current.nodes) {
      if (Math.hypot(mx - n.x, my - n.y) < NR + 8) {
        if (mode === "setStart") { setStartNode(n.idx); setMode("idle"); }
        else if (mode === "addTarget") {
          if (n.idx !== startNode && !targets.includes(n.idx))
            setTargets(p => [...p, n.idx]);
        }
        return;
      }
    }
  }, [mode, startNode, targets, isRunning]);

  // ── RUN ─────────────────────────────────────────────────────────────────────
  const run = useCallback(() => {
    if (startNode === null || targets.length === 0 || isRunning) return;
    const { nodes, adj } = graphRef.current;
    const p = greedyMultiTarget(startNode, targets, nodes, adj);
    setPath(p); setAnimStep(0); setMetrics({ nodes: 1, cost: 0 }); setIsRunning(true);

    let step = 0, cost = 0;
    if (animRef.current) clearTimeout(animRef.current);
    const tick = () => {
      step++;
      if (step < p.length) {
        const edge = adj[p[step - 1]]?.find(([n]) => n === p[step]);
        const w = edge ? edge[1] : DEFAULT_COST;
        cost += w;
        setAnimStep(step);
        setMetrics({ nodes: step + 1, cost });
        animRef.current = setTimeout(tick, 120 + w * 50);
      } else {
        setIsRunning(false);
      }
    };
    animRef.current = setTimeout(tick, 200);
  }, [startNode, targets, isRunning]);

  // ── RESET ───────────────────────────────────────────────────────────────────
  const reset = () => {
    if (animRef.current) clearTimeout(animRef.current);
    setStartNode(null); setTargets([]); setPath([]);
    setAnimStep(-1); setIsRunning(false);
    setMetrics({ nodes: 0, cost: 0 }); setMode("idle");
  };

  const Btn = ({ label, onClick, active, activeColor, disabled }) => (
    <button onClick={onClick} disabled={disabled} style={{
      padding: "5px 13px", fontSize: 11,
      fontFamily: "'Courier New', monospace", borderRadius: 4,
      cursor: disabled ? "not-allowed" : "pointer",
      border: `1px solid ${active ? activeColor : "rgba(255,255,255,0.12)"}`,
      background: active ? `${activeColor}22` : "transparent",
      color: active ? activeColor : "#64748b",
      opacity: disabled ? 0.3 : 1, transition: "all 0.15s",
    }}>{label}</button>
  );

  const canRun = startNode !== null && targets.length > 0 && !isRunning;

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      width: "100vw", height: "100vh",
      background: "#03080f", color: "#e2e8f0",
      fontFamily: "'Courier New', monospace", overflow: "hidden",
    }}>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div style={{
        padding: "6px 14px", flexShrink: 0,
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(8,15,26,0.97)",
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 12, fontWeight: "bold", color: "#22d3ee", letterSpacing: 2 }}>
          ▲ A* ROUTER
        </span>
        <span style={{ fontSize: 9, color: "#1e3a5f", marginRight: 4 }}>
          {graph.rows}×{graph.cols} · {nodes.length} nodes · {undirected.length} edges
        </span>

        <Btn label="◎ Set Start" onClick={() => !isRunning && setMode(m => m === "setStart" ? "idle" : "setStart")} active={mode === "setStart"} activeColor="#3b82f6" />
        <Btn label="◉ Add Target" onClick={() => !isRunning && setMode(m => m === "addTarget" ? "idle" : "addTarget")} active={mode === "addTarget"} activeColor="#22c55e" />
        <Btn label="▶ Run A*" onClick={run} active={false} activeColor="#22d3ee" disabled={!canRun} />
        <Btn label="↺ Reset" onClick={reset} active={false} activeColor="#94a3b8" disabled={false} />

        <span style={{
          fontSize: 10, padding: "2px 9px", borderRadius: 20,
          background: "#111827", border: "1px solid rgba(255,255,255,0.07)",
          color: startNode !== null ? "#60a5fa" : "#1e3a5f",
        }}>
          START: {startNode !== null ? nodes[startNode]?.label ?? "—" : "—"}
        </span>

        {targets.length > 0 && (
          <span style={{
            fontSize: 10, padding: "2px 9px", borderRadius: 20,
            background: "#111827", border: "1px solid rgba(255,255,255,0.07)",
            color: "#4ade80",
          }}>
            {targets.map(t => nodes[t]?.label).join(" → ")}
          </span>
        )}

        {mode !== "idle" && (
          <span style={{
            fontSize: 10, padding: "2px 9px", borderRadius: 20,
            background: "#1c0a00", border: "1px solid #92400e", color: "#fb923c",
          }}>
            {mode === "setStart" ? "↗ click a node to set start" : "↗ click nodes to add targets"}
          </span>
        )}

        {/* Legend + Metrics */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {[["#10b981", "≤3"], ["#f59e0b", "≤6"], ["#f43f5e", "≥7"], ["#22d3ee", "path"]].map(([c, l]) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: "#334155" }}>
              <span style={{ width: 14, height: 2.5, background: c, display: "inline-block", borderRadius: 2 }} />
              {l}
            </span>
          ))}
          <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.07)", margin: "0 4px" }} />
          {[["NODES", metrics.nodes, "#38bdf8"], ["COST", metrics.cost, "#c084fc"]].map(([l, v, c]) => (
            <div key={l} style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              padding: "2px 12px", borderRadius: 5, minWidth: 52,
              background: "rgba(14,165,233,0.06)", border: `1px solid ${c}33`,
            }}>
              <span style={{ fontSize: 7, color: c, letterSpacing: 1.5 }}>{l}</span>
              <span style={{ fontSize: 16, fontWeight: "bold", color: "#e0f2fe", lineHeight: 1.3 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Canvas wrapper — fills remaining space exactly ───────────────────── */}
      <div ref={wrapRef} style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <canvas
          ref={canvasRef}
          onClick={handleClick}
          style={{
            display: "block",
            width: "100%",   // CSS fills the wrapper
            height: "100%",   // pixel buffer is already the same size (no blur)
            cursor: mode !== "idle" ? "crosshair" : "default",
          }}
        />
      </div>
    </div>
  );
}
