import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { SVG_W, SVG_H } from "./GraphGenerator";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 6;
const ZOOM_STEP = 1.25;

// ─── Road visual styles ───────────────────────────────────────────────────────
const ROAD_BASE = {
  highway: { stroke: "#ffcc00", strokeWidth: 5.5, dashArray: "12,7" },
  main:    { stroke: "#777777", strokeWidth: 4.0,  dashArray: null   },
  local:   { stroke: "#5a5a5a", strokeWidth: 1.0,  dashArray: null   },
};

// Per-congestion-level overrides (applied regardless of road type)
const CONGESTION_STYLES = {
  //         stroke     width  glow-filter
  clear:  { stroke: null,       widthAdd: 0,   glow: null               },
  medium: { stroke: "#ff8800",  widthAdd: 1.2, glow: "url(#glow-orange)" },
  heavy:  { stroke: "#ff3333",  widthAdd: 2.5, glow: "url(#glow-red)"   },
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
    <filter id="glow-blue" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="9" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glow-red" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glow-yellow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glow-orange" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    {/* Path travel gradient */}
    <linearGradient id="path-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stopColor="#00b4ff" stopOpacity="0.2"/>
      <stop offset="50%"  stopColor="#00b4ff" stopOpacity="1"/>
      <stop offset="100%" stopColor="#00b4ff" stopOpacity="0.2"/>
    </linearGradient>
  </defs>
);

// ─── Background grid (subtle) ───────────────────────────────────────────────
const BgGrid = () => (
  <g opacity={0.06}>
    {Array.from({ length: 12 }, (_, i) => (
      <line key={`h${i}`} x1={0} y1={(SVG_H/12)*i} x2={SVG_W} y2={(SVG_H/12)*i}
        stroke="#00b4ff" strokeWidth={0.5}/>
    ))}
    {Array.from({ length: 16 }, (_, i) => (
      <line key={`v${i}`} x1={(SVG_W/16)*i} y1={0} x2={(SVG_W/16)*i} y2={SVG_H}
        stroke="#00b4ff" strokeWidth={0.5}/>
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

  // ── Pan / Zoom state ──────────────────────────────────────────────────
  const [zoom,   setZoom]   = useState(1);
  const [pan,    setPan]    = useState({ x: 0, y: 0 });
  const isDragging  = useRef(false);
  const dragStart   = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  const svgRef    = useRef(null);
  const wrapRef   = useRef(null);
  const rafRef    = useRef(null);

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

  // ── Wheel → zoom centred on cursor ───────────────────────────────────
  // We attach via useEffect with passive:false so we can preventDefault
  // (React synthetic onWheel is passive in React 17+ and can't prevent page scroll)
  const zoomStateRef = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  zoomStateRef.current = { zoom, pan };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const cx   = e.clientX - rect.left; // cursor relative to wrapper
      const cy   = e.clientY - rect.top;
      const { zoom: prevZoom, pan: prevPan } = zoomStateRef.current;
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const next   = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prevZoom * factor));
      const newPan = {
        x: cx - (cx - prevPan.x) * (next / prevZoom),
        y: cy - (cy - prevPan.y) * (next / prevZoom),
      };
      setZoom(next);
      setPan(newPan);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mouse drag → pan ─────────────────────────────────────────────────
  const handleMouseDown = useCallback((e) => {
    // only pan with left-button, and only when not clicking a node
    if (e.button !== 0) return;
    isDragging.current = true;
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
    e.currentTarget.style.cursor = 'grabbing';
  }, [pan]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.mx;
    const dy = e.clientY - dragStart.current.my;
    setPan({ x: dragStart.current.px + dx, y: dragStart.current.py + dy });
  }, []);

  const handleMouseUp = useCallback((e) => {
    isDragging.current = false;
    if (e.currentTarget) e.currentTarget.style.cursor = 'grab';
  }, []);

  // ── Zoom button helpers ───────────────────────────────────────────────
  const zoomIn = useCallback(() => {
    setZoom(z => {
      const next = Math.min(MAX_ZOOM, z * ZOOM_STEP);
      // zoom toward centre of wrapper
      if (wrapRef.current) {
        const { width, height } = wrapRef.current.getBoundingClientRect();
        const cx = width / 2, cy = height / 2;
        setPan(p => ({
          x: cx - (cx - p.x) * (next / z),
          y: cy - (cy - p.y) * (next / z),
        }));
      }
      return next;
    });
  }, []);

  const zoomOut = useCallback(() => {
    setZoom(z => {
      const next = Math.max(MIN_ZOOM, z / ZOOM_STEP);
      if (wrapRef.current) {
        const { width, height } = wrapRef.current.getBoundingClientRect();
        const cx = width / 2, cy = height / 2;
        setPan(p => ({
          x: cx - (cx - p.x) * (next / z),
          y: cy - (cy - p.y) * (next / z),
        }));
      }
      return next;
    });
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

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
    // Store raw client coords so the DOM tooltip stays sharp at any zoom
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setTooltip({
      x: ev.clientX - rect.left,
      y: ev.clientY - rect.top,
      text,
    });
  }, []);

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

  // Always render the wrapper so wrapRef is set on first mount → wheel listener attaches correctly.
  const { nodes, edges } = graph ?? { nodes: [], edges: [] };
  const nodeById = graph ? Object.fromEntries(nodes.map(n => [n.id, n])) : {};

  return (
    <div
      className="svg-wrapper"
      ref={wrapRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: graph ? 'grab' : 'default' }}
    >
      {/* Empty state (shown while graph is null) */}
      {!graph && (
        <div className="graph-empty">Generate a city to begin.</div>
      )}
      {calculating && (
        <div className="calculating-overlay">
          <div className="calc-spinner"/>
          <span className="calc-text">Calculating Route…</span>
        </div>
      )}

      {/* ── Zoom controls (always static, like Google Maps) ── */}
      <div className="zoom-controls" onMouseDown={e => e.stopPropagation()}>
        <button className="zoom-btn" onClick={zoomIn}  title="Zoom in">＋</button>
        <div className="zoom-divider"/>
        <button className="zoom-btn" onClick={zoomOut} title="Zoom out">－</button>
        <div className="zoom-divider"/>
        <button className="zoom-btn reset" onClick={resetView} title="Reset view">⌂</button>
      </div>

      {/* Zoom-level indicator */}
      <div className="zoom-level-badge">{Math.round(zoom * 100)}%</div>

      {/* ── DOM Tooltip (pixel-sharp, scales with zoom) ── */}
      {tooltip && (() => {
        const s = Math.min(zoom, 4); // scale factor, capped at 4×
        return (
          <div
            className="map-tooltip"
            style={{
              left:     tooltip.x + 14 * s,
              top:      tooltip.y - 34 * s,
              fontSize: `${0.82 * s}rem`,
              padding:  `${5 * s}px ${11 * s}px`,
            }}
          >
            {tooltip.text}
          </div>
        );
      })()}

      <svg
        ref={svgRef}
        width={SVG_W}
        height={SVG_H}
        className="city-svg"
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          transition: 'none',
          willChange: 'transform',
        }}
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
                  onMouseMove={ev => {
                    // Same congestion-mult as api.js so displayed time matches A* cost
                    const tNorm    = (traffic - 1) / 4;
                    const heavyCut = 1 - tNorm * 0.35;
                    const medCut   = 1 - tNorm * 0.55;
                    const lvl      = e.trafficLevel ?? 0;
                    const mult     = lvl >= heavyCut ? 4.0 : lvl >= medCut ? 2.0 : 1.0;
                    const effTime  = (e.timeCost * mult * 100).toFixed(1);
                    const tag      = mult === 4 ? ' 🔴 heavy' : mult === 2 ? ' 🟠 med' : '';
                    handleEdgeMouseMove(ev, `⏱ ${effTime}s${tag}  💸 $${e.tollCost.toFixed(2)}`);
                  }}
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
                    stroke="#00b4ff" strokeWidth={9}
                    filter="url(#glow-blue)" opacity={0.28}
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
                    stroke="#00b4ff" strokeWidth={4.5}
                    strokeDasharray="18,10"
                    strokeDashoffset={animOffset}
                    opacity={0.8}
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
            stroke="#00b4ff"
            strokeWidth={6}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#glow-blue)"
            opacity={0.98}
          />
        )}

        {/* ── NODES ─────────────────────────────────────────── */}
        <g id="nodes-layer">
          {nodes.map(n => {
            const isStart = n.id === start;
            const isGoal  = n.id === goal;
            const isOnPath = pathNodeSet.has(n.id) && !isStart && !isGoal;

            let fill   = "#1a1a1a";
            let stroke = "#00b4ff";
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
              fill    = "#001830";
              stroke  = "#00b4ff";
              glow    = "url(#glow-blue)";
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
                    stroke={isStart ? "#00ff88" : isGoal ? "#ff4444" : "#00b4ff"}
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

              </g>
            );
          })}
        </g>
      </svg>

      {/* ── DOM Node Labels (pixel-sharp at any zoom) ── */}
      {graph && (() => {
        const wrap = wrapRef.current;
        if (!wrap) return null;
        const { width: wW, height: wH } = wrap.getBoundingClientRect();
        // Map SVG coord → screen coord inside the wrapper
        const toScreen = (svgX, svgY) => ({
          x: pan.x + (svgX / SVG_W) * wW * zoom,
          y: pan.y + (svgY / SVG_H) * wH * zoom,
        });
        return nodes.map(n => {
          const isStart  = n.id === start;
          const isGoal   = n.id === goal;
          const isOnPath = pathNodeSet.has(n.id) && !isStart && !isGoal;
          const label    = isStart ? 'S' : isGoal ? 'G' : n.label;
          const { x, y } = toScreen(n.x, n.y);
          // Don't render if outside the visible wrapper
          if (x < -40 || x > wW + 40 || y < -40 || y > wH + 40) return null;
          const baseSize = isStart || isGoal ? 11 : 7.5;
          return (
            <div
              key={`lbl-${n.id}`}
              style={{
                position:  'absolute',
                left:      x,
                top:       y,
                transform: 'translate(-50%, -50%)',
                fontSize:  `${baseSize * Math.min(zoom, 3)}px`,
                fontFamily: 'Orbitron, sans-serif',
                fontWeight: 700,
                color:      isStart ? '#003' : isGoal ? '#fff' : '#b0b0b0',
                pointerEvents: 'none',
                userSelect: 'none',
                lineHeight: 1,
                whiteSpace: 'nowrap',
                textShadow: isStart
                  ? '0 0 4px rgba(0,255,136,0.3)'
                  : isGoal
                  ? '0 0 4px rgba(255,68,68,0.5)'
                  : isOnPath
                  ? '0 0 6px rgba(0,180,255,0.8)'
                  : 'none',
              }}
            >
              {label}
            </div>
          );
        });
      })()}
    </div>
  );
}

export default CityGraph;
