import React, { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";
import CityGraph    from "./CityGraph";
import ControlPanel from "./ControlPanel";
import { generateCityGraph } from "./GraphGenerator";
import { runPathfinding, apiReset } from "./api";

function App() {
  // ── Graph state ────────────────────────────────────────
  const [graph,       setGraph]       = useState(null);
  const [start,       setStart]       = useState(null);   // node id
  const [goal,        setGoal]        = useState(null);   // node id
  const [pathNodeIds, setPathNodeIds] = useState([]);

  // ── Controls ───────────────────────────────────────────
  const [mode,    setMode]    = useState("time");
  const [traffic, setTraffic] = useState(1);
  const [godMode, setGodMode] = useState(false);

  // ── UI state ───────────────────────────────────────────
  const [calculating, setCalculating] = useState(false);
  const [stats,       setStats]       = useState({ ready: false });

  // Keep a ref to the graph so async callbacks always see the latest version
  const graphRef = useRef(null);
  graphRef.current = graph;

  // ── Generate city on first load ───────────────────────
  useEffect(() => { spawnNewCity(); }, []);  // eslint-disable-line

  const spawnNewCity = useCallback(() => {
    const g = generateCityGraph();
    setGraph(g);
    setStart(null);
    setGoal(null);
    setPathNodeIds([]);
    setStats({ ready: false });
    setGodMode(false);
    apiReset().catch(() => {});
  }, []);

  // ── Core pathfinding trigger ───────────────────────────
  const runPath = useCallback(async (
    overrideGraph   = null,
    overrideStart   = null,
    overrideGoal    = null,
    overrideMode    = null,
    overrideTraffic = null,
  ) => {
    const g  = overrideGraph   ?? graphRef.current;
    const s  = overrideStart   ?? start;
    const gl = overrideGoal    ?? goal;
    const m  = overrideMode    ?? mode;
    const t  = overrideTraffic ?? traffic;
    if (!g || s === null || gl === null) return;

    setCalculating(true);
    try {
      const result = await runPathfinding({
        nodes:       g.nodes,
        edges:       g.edges,
        startId:     s,
        goalId:      gl,
        mode:        m,
        trafficMult: t,
      });

      setPathNodeIds(result.path);

      // Compute accumulated toll cost along the returned path
      let tollCost = 0;
      if (result.success && result.path.length > 1) {
        const edgeMap = {};
        g.edges.forEach(e => {
          edgeMap[`${Math.min(e.from, e.to)}-${Math.max(e.from, e.to)}`] = e;
        });
        for (let i = 0; i < result.path.length - 1; i++) {
          const k = `${Math.min(result.path[i], result.path[i+1])}-${Math.max(result.path[i], result.path[i+1])}`;
          if (edgeMap[k]) tollCost += edgeMap[k].tollCost;
        }
      }

      setStats({
        ready:        true,
        success:      result.success,
        stops:        result.path.length,
        travelTime:   result.totalCost ?? 0,
        tollCost,
        nodesChecked: result.nodesExplored ?? 0,
      });
    } catch (err) {
      console.error(err);
      setStats({ ready: true, success: false, stops: 0, travelTime: 0, tollCost: 0, nodesChecked: 0 });
    } finally {
      setCalculating(false);
    }
  }, [start, goal, mode, traffic]);

  // ── Node click ────────────────────────────────────────
  const handleNodeClick = useCallback(async (nodeId) => {
    // In God Mode only edges can be interacted with — ignore node clicks
    if (godMode) return;

    // Reset selection if clicking an already-selected node
    if (nodeId === start) {
      setStart(null);
      setPathNodeIds([]);
      setStats({ ready: false });
      return;
    }
    if (nodeId === goal) {
      setGoal(null);
      setPathNodeIds([]);
      setStats({ ready: false });
      return;
    }
    if (start === null) {
      setStart(nodeId);
      return;
    }
    if (goal === null) {
      setGoal(nodeId);
      await runPath(null, start, nodeId, null, null);
      return;
    }
    // Both set — reassign start
    setStart(nodeId);
    setGoal(null);
    setPathNodeIds([]);
    setStats({ ready: false });
  }, [godMode, start, goal, runPath]);

  // ── Edge click (God Mode) ──────────────────────────────
  const handleEdgeClick = useCallback(async (edgeId) => {
    if (!godMode || !graph) return;
    const newEdges = graph.edges.map(e =>
      e.id === edgeId ? { ...e, blocked: !e.blocked } : e
    );
    const newGraph = { ...graph, edges: newEdges };
    setGraph(newGraph);
    if (start !== null && goal !== null) {
      await runPath(newGraph, start, goal, null, null);
    }
  }, [godMode, graph, start, goal, runPath]);

  // ── Mode change ───────────────────────────────────────
  const handleModeChange = useCallback(async (newMode) => {
    setMode(newMode);
    await runPath(null, null, null, newMode, null);
  }, [runPath]);

  // ── Traffic slider commit ─────────────────────────────
  const handleTrafficCommit = useCallback(async () => {
    await runPath(null, null, null, null, traffic);
  }, [runPath, traffic]);

  // ── Derive hint text ─────────────────────────────────
  const hint =
    !start   ? "Click any intersection to set your Start point (S)" :
    !goal    ? "Click another intersection to set your Goal (G)" :
    godMode  ? "⛔ God Mode — click any road to block / unblock it" :
               "Route computed — adjust controls or click nodes to re-route";

  return (
    <div className="app">
      {/* HEADER */}
      <header className="header">
        <div className="header-left">
          <h1>AI Route Optimizer</h1>
          <p>City Network Pathfinding — A* with Dynamic Constraints</p>
        </div>
        <div className="header-badges">
          <span className="badge">{graph ? graph.nodes.length : 65} Intersections</span>
          <span className="badge cyan">SVG Graph Mode</span>
          <span className={`badge ${mode === "time" ? "green" : "yellow"}`}>
            {mode === "time" ? "🚀 Fastest" : "💸 Cheapest"}
          </span>
        </div>
      </header>

      <main className="main">
        <ControlPanel
          mode={mode}             onModeChange={handleModeChange}
          traffic={traffic}       onTrafficChange={setTraffic}  onTrafficCommit={handleTrafficCommit}
          godMode={godMode}       onGodModeToggle={setGodMode}
          onNewCity={spawnNewCity}
          calculating={calculating}
          stats={stats}
        />

        <section className="graph-panel">
          <div className="graph-hint">
            {hint}
          </div>
          <CityGraph
            graph={graph}
            start={start}
            goal={goal}
            pathNodeIds={pathNodeIds}
            traffic={traffic}
            godMode={godMode}
            calculating={calculating}
            onNodeClick={handleNodeClick}
            onEdgeClick={handleEdgeClick}
          />
        </section>
      </main>
    </div>
  );
}

export default App;
