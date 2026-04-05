import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { SVG_W, SVG_H } from "./GraphGenerator";

// ─── Road visual styles ───────────────────────────────────────────────────────
const ROAD_BASE = {
  highway: { stroke: "#ffcc00", strokeWidth: 4.5, dashArray: "12,7" },
  main:    { stroke: "#777777", strokeWidth: 2.5,  dashArray: null   },
  local:   { stroke: "#383838", strokeWidth: 1.5,  dashArray: null   },
};

// Per-congestion-level overrides (applied regardless of road type)
const CONGESTION_STYLES = {
  //         stroke     width  glow-filter
  clear:  { stroke: null,       widthAdd: 0, glow: null              },
  medium: { stroke: "#ff8800",  widthAdd: 1.2, glow: "url(#glow-orange)" },
  heavy:  { stroke: "#ff2200",  widthAdd: 2.5, glow: "url(#glow-red)"   },
};

/**
 * Classify an edge's congestion state given the slider value (1–5).
 * slider → thresholds for what fraction of edges are affected:
 *   1x → ~0% heavy,  0% medium
 *   3x → ~15% heavy, 30% medium
 *   5x → ~35% heavy, 55% medium
 */
function congestionState(trafficLevel, slider) {
  const t = (slider - 1) / 4;           // 0 → 1
  const heavyCutoff  = 1 - t * 0.35;   // at 5x: edges with level > 0.65 → heavy
  const mediumCutoff = 1 - t * 0.55;   // at 5x: edges with level > 0.45 → medium
  if (trafficLevel >= heavyCutoff)  return "heavy";
  if (trafficLevel >= mediumCutoff) return "medium";
  return "clear";
}

/** Final visual style for an edge given its road type + congestion state */
function edgeStyle(roadType, state) {
  const base  = ROAD_BASE[roadType] || ROAD_BASE.main;
  const cong  = CONGESTION_STYLES[state];
  return {
    stroke:      cong.stroke ?? base.stroke,
    strokeWidth: base.strokeWidth + cong.widthAdd,
    dashArray:   base.dashArray,
    glow:        cong.glow ?? (roadType === "highway" ? "url(#glow-yellow)" : undefined),
  };
}

// ─── SVG filter defs ────────────────────────────────────────────────────────
const SvgDefs = () => (
  <defs>
    {/* Glow filters */}
    <filter id="glow-green" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glow-cyan" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glow-red" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glow-yellow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glow-orange" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    {/* Path travel gradient */}
    <linearGradient id="path-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stopColor="#00cfff" stopOpacity="0.2"/>
      <stop offset="50%"  stopColor="#00cfff" stopOpacity="1"/>
      <stop offset="100%" stopColor="#00cfff" stopOpacity="0.2"/>
    </linearGradient>
  </defs>
);

// ─── Background grid (subtle) ───────────────────────────────────────────────
const BgGrid = () => (
  <g opacity={0.06}>
    {Array.from({ length: 12 }, (_, i) => (
      <line key={`h${i}`} x1={0} y1={(SVG_H/12)*i} x2={SVG_W} y2={(SVG_H/12)*i}
        stroke="#00cfff" strokeWidth={0.5}/>
    ))}
    {Array.from({ length: 16 }, (_, i) => (
      <line key={`v${i}`} x1={(SVG_W/16)*i} y1={0} x2={(SVG_W/16)*i} y2={SVG_H}
        stroke="#00cfff" strokeWidth={0.5}/>
    ))}
  </g>
);

/**
 * CityGraph — SVG canvas rendering the city road network.
 *
 * Props:
 *   graph        : { nodes, edges, adj }
 *   start        : node id | null
 *   goal         : node id | null
 *   pathNodeIds  : array of node ids on the found path
 *   godMode      : bool (can click roads to block)
 *   calculating  : bool
 *   onNodeClick  : (nodeId) => void
 *   onEdgeClick  : (edgeId) => void
 */
function CityGraph({ graph, start, goal, pathNodeIds, traffic, godMode, calculating, onNodeClick, onEdgeClick }) {
  const [tooltip,    setTooltip]    = useState(null);  // { svgX, svgY, text }
  const [animOffset, setAnimOffset] = useState(0);      // marching ants offset
  const [pathProgress, setPathProgress] = useState(0); // 0→1 travel animation
  const svgRef = useRef(null);
  const rafRef = useRef(null);

  // ── Path edge / node sets ──────────────────────────────────────────────
  const pathEdgeIds = useMemo(() => {
    if (!pathNodeIds?.length || pathNodeIds.length < 2 || !graph) return new Set();
    const set = new Set();
    for (let i = 0; i < pathNodeIds.length - 1; i++) {
      const a = Math.min(pathNodeIds[i], pathNodeIds[i+1]);
      const b = Math.max(pathNodeIds[i], pathNodeIds[i+1]);
      set.add(`${a}-${b}`);
    }
    return set;
  }, [pathNodeIds, graph]);

  const pathNodeSet = useMemo(() => new Set(pathNodeIds ?? []), [pathNodeIds]);

  // ── Marching ants offset for path ────────────────────────────────────
  useEffect(() => {
    if (!pathEdgeIds.size) { setAnimOffset(0); return; }
    let frame;
    const tick = () => {
      setAnimOffset(o => (o - 1.2) % 40);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [pathEdgeIds]);

  // ── Path travel animation (0→1 over ~1.2s) ──────────────────────────
  useEffect(() => {
    if (!pathEdgeIds.size) { setPathProgress(0); return; }
    setPathProgress(0);
    const start = performance.now();
    const dur   = 1200; // ms
    const tick  = (now) => {
      const t = Math.min(1, (now - start) / dur);
      setPathProgress(t);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [pathEdgeIds]);

  // ── SVG mouse → SVG coordinate conversion ───────────────────────────
  const getSvgCoords = useCallback((clientX, clientY) => {
    if (!svgRef.current) return { x: clientX, y: clientY };
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = SVG_W / rect.width;
    const scaleY = SVG_H / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top)  * scaleY,
    };
  }, []);

  const handleEdgeMouseMove = useCallback((ev, text) => {
    const { x, y } = getSvgCoords(ev.clientX, ev.clientY);
    setTooltip({ svgX: x, svgY: y, text });
  }, [getSvgCoords]);

  const handleEdgeClick = useCallback((ev, edgeId) => {
    if (!godMode) return;
    ev.stopPropagation();
    onEdgeClick(edgeId);
  }, [godMode, onEdgeClick]);

  // ── Build ordered path polyline points ──────────────────────────────
  const pathPoints = useMemo(() => {
    if (!graph || !pathNodeIds?.length) return [];
    const nb = Object.fromEntries(graph.nodes.map(n => [n.id, n]));
    return pathNodeIds.map(id => nb[id]).filter(Boolean);
  }, [graph, pathNodeIds]);

  const totalPathLen = useMemo(() => {
    let len = 0;
    for (let i = 0; i < pathPoints.length - 1; i++) {
      const a = pathPoints[i], b = pathPoints[i+1];
      len += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return len;
  }, [pathPoints]);

  // ── Compute partial path according to pathProgress ──────────────────
  const partialPathD = useMemo(() => {
    if (!pathPoints.length || pathProgress === 0) return "";
    const target = totalPathLen * pathProgress;
    let traveled = 0;
    const pts = [];
    for (let i = 0; i < pathPoints.length - 1; i++) {
      const a    = pathPoints[i];
      const b    = pathPoints[i+1];
      const segL = Math.hypot(b.x - a.x, b.y - a.y);
      if (traveled === 0) pts.push([a.x, a.y]);
      if (traveled + segL <= target) {
        pts.push([b.x, b.y]);
        traveled += segL;
      } else {
        const t  = (target - traveled) / segL;
        pts.push([a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t]);
        break;
      }
    }
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  }, [pathPoints, pathProgress, totalPathLen]);

  if (!graph) return <div className="graph-empty">Generate a city to begin.</div>;

  const { nodes, edges } = graph;
  const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]));

  return (
    <div className="svg-wrapper">
      {calculating && (
        <div className="calculating-overlay">
          <div className="calc-spinner"/>
          <span className="calc-text">Calculating Route…</span>
        </div>
      )}

      <svg
        ref={svgRef}
        width={SVG_W}
        height={SVG_H}
        className="city-svg"
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: '100%', height: '100%' }}
      >
        <SvgDefs/>
        <BgGrid/>

        {/* ── EDGES ─────────────────────────────────────────── */}
        <g id="edges-layer">
          {edges.map(e => {
            const na      = nodeById[e.from];
            const nb      = nodeById[e.to];
            if (!na || !nb) return null;
            const isPath  = pathEdgeIds.has(e.id);
            const blocked = e.blocked;
            const mx      = (na.x + nb.x) / 2;
            const my      = (na.y + nb.y) / 2;

            return (
              <g key={e.id}>
                {/* Wide transparent hit area */}
                <line
                  x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                  stroke="transparent" strokeWidth={18}
                  style={{ cursor: godMode ? 'pointer' : 'default' }}
                  onClick={ev => handleEdgeClick(ev, e.id)}
                  onMouseMove={ev => handleEdgeMouseMove(ev, `⏱ ${(e.timeCost*100).toFixed(1)}s  💸 $${e.tollCost.toFixed(2)}`)}
                  onMouseLeave={() => setTooltip(null)}
                />

                {/* Visual road */}
                {blocked ? (
                  <line
                    x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                    stroke="#ff2200" strokeWidth={2.5}
                    strokeDasharray="5,5" opacity={0.7}
                  />
                ) : isPath ? (
                  /* Under-glow of path */
                  <line
                    x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                    stroke="#00cfff" strokeWidth={8}
                    filter="url(#glow-cyan)" opacity={0.18}
                  />
                ) : (
                  // ── Normal road: per-edge congestion state from slider
                  (() => {
                    const state = congestionState(e.trafficLevel ?? 0, traffic ?? 1);
                    const es    = edgeStyle(e.roadType, state);
                    return (
                      <line
                        x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                        stroke={es.stroke}
                        strokeWidth={es.strokeWidth}
                        strokeDasharray={es.dashArray ?? undefined}
                        filter={es.glow}
                        opacity={state === "clear" ? 0.8 : 1}
                      />
                    );
                  })()
                )}

                {/* Marching-ant path overlay */}
                {isPath && !blocked && (
                  <line
                    x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                    stroke="#00cfff" strokeWidth={4}
                    strokeDasharray="18,10"
                    strokeDashoffset={animOffset}
                    opacity={0.65}
                  />
                )}

                {/* Blocked X marker */}
                {blocked && (
                  <text x={mx} y={my+4} textAnchor="middle"
                    fill="#ff2200" fontSize={16} fontWeight="bold"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >✕</text>
                )}

                {/* God mode highlight ring on hover */}
                {godMode && !blocked && (
                  <line
                    x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                    stroke="#ff4444" strokeWidth={1}
                    strokeDasharray="4,8"
                    opacity={0.0}
                    className="god-hover-indicator"
                  />
                )}
              </g>
            );
          })}
        </g>

        {/* ── ANIMATED PATH TRAVEL LINE ────────────────────── */}
        {partialPathD && pathProgress > 0 && (
          <path
            d={partialPathD}
            fill="none"
            stroke="#00cfff"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#glow-cyan)"
            opacity={0.95}
          />
        )}

        {/* Tooltip in SVG space */}
        {tooltip && (
          <g style={{ pointerEvents: 'none' }}>
            <rect
              x={tooltip.svgX + 10} y={tooltip.svgY - 26}
              width={tooltip.text.length * 7.4 + 14}
              height={26}
              rx={5} fill="#111"
              stroke="#00cfff" strokeWidth={0.8}
              opacity={0.95}
            />
            <text
              x={tooltip.svgX + 17} y={tooltip.svgY - 8}
              fill="#e0e0e0" fontSize={13}
              fontFamily="Rajdhani, sans-serif" fontWeight={600}
            >{tooltip.text}</text>
          </g>
        )}

        {/* ── NODES ─────────────────────────────────────────── */}
        <g id="nodes-layer">
          {nodes.map(n => {
            const isStart = n.id === start;
            const isGoal  = n.id === goal;
            const isOnPath = pathNodeSet.has(n.id) && !isStart && !isGoal;

            let fill   = "#1a1a1a";
            let stroke = "#00cfff";
            let glow   = null;
            let label  = n.label;
            let r      = 10;
            let strokeW = 1.5;

            if (isStart) {
              fill    = "#00ff88";
              stroke  = "#00ff88";
              glow    = "url(#glow-green)";
              label   = "S";
              r       = 15;
              strokeW = 2.5;
            } else if (isGoal) {
              fill    = "#ff4444";
              stroke  = "#ff4444";
              glow    = "url(#glow-red)";
              label   = "G";
              r       = 15;
              strokeW = 2.5;
            } else if (isOnPath) {
              fill    = "#002233";
              stroke  = "#00cfff";
              glow    = "url(#glow-cyan)";
              strokeW = 2;
            }

            return (
              <g
                key={n.id}
                className="city-node"
                onClick={() => onNodeClick(n.id)}
                style={{ cursor: godMode ? 'default' : 'pointer' }}
              >
                {/* Outer pulse ring for path/start/goal nodes */}
                {(isOnPath || isStart || isGoal) && (
                  <circle cx={n.x} cy={n.y} r={r + 7}
                    fill="none"
                    stroke={isStart ? "#00ff88" : isGoal ? "#ff4444" : "#00cfff"}
                    strokeWidth={1}
                    opacity={0.25}
                    className="pulse-ring"
                  />
                )}

                {/* Node circle */}
                <circle
                  cx={n.x} cy={n.y} r={r}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={strokeW}
                  filter={glow}
                />

                {/* Label */}
                <text
                  x={n.x} y={n.y + 4.5}
                  textAnchor="middle"
                  fontSize={isStart || isGoal ? 11 : 7.5}
                  fill={isStart ? "#000" : isGoal ? "#fff" : "#aaaaaa"}
                  fontWeight="700"
                  fontFamily="Rajdhani, sans-serif"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >{label}</text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

export default CityGraph;
