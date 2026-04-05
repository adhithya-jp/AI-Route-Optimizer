import React from "react";

/**
 * ControlPanel — left sidebar for the City Graph visualizer.
 *
 * Props:
 *   mode            : "time" | "money"
 *   onModeChange    : (mode) => void
 *   traffic         : number 1–5
 *   onTrafficChange : (val) => void
 *   onTrafficCommit : () => void
 *   godMode         : bool
 *   onGodModeToggle : (bool) => void
 *   onNewCity       : () => void
 *   onFindPath      : () => void
 *   calculating     : bool
 *   stats           : { ready, success, stops, travelTime, tollCost, nodesChecked }
 */
function ControlPanel({
  mode, onModeChange,
  traffic, onTrafficChange, onTrafficCommit,
  godMode, onGodModeToggle,
  onNewCity,
  calculating, stats,
  nodeCount, onNodeCountChange, onNodeCountCommit,
}) {
  const fill      = ((traffic   - 1) / 4)  * 100;
  const nodeFill  = ((nodeCount - 20) / 80) * 100;

  return (
    <aside className="control-panel">

      {/* ── LOGO / TITLE ──────────────────────────── */}
      <div className="panel-logo">
        <span className="logo-icon">⬡</span>
        <div>
          <div className="logo-title">Route AI</div>
          <div className="logo-sub">A* Pathfinding Engine</div>
        </div>
      </div>

      {/* ── ROUTE MODE ────────────────────────────── */}
      <div className="panel-section">
        <span className="panel-label">Route Strategy</span>
        <div className="mode-buttons vertical">
          <button
            id="btn-fastest"
            className={`mode-btn large${mode === "time" ? " active" : ""}`}
            onClick={() => onModeChange("time")}
          >
            <span className="mode-icon">🚀</span>
            <span className="mode-title">FASTEST ROUTE</span>
            <span className="mode-sub">Minimizes travel time</span>
          </button>
          <button
            id="btn-cheapest"
            className={`mode-btn large${mode === "money" ? " active money" : ""}`}
            onClick={() => onModeChange("money")}
          >
            <span className="mode-icon">💸</span>
            <span className="mode-title">CHEAPEST ROUTE</span>
            <span className="mode-sub">Avoids toll roads</span>
          </button>
        </div>
        <p className="mode-hint">
          {mode === "time"
            ? "Highways preferred — faster but may cost more."
            : "Local streets preferred — slower but toll-free."}
        </p>
      </div>

      <div className="divider"/>

      {/* ── TRAFFIC SLIDER ────────────────────────── */}
      <div className="panel-section">
        <span className="panel-label">Road Congestion Density</span>
        <div className="slider-wrap">
          <div className="slider-meta">
            <span>Low Density</span>
            <span className="val">{traffic.toFixed(1)}×</span>
          </div>
          <input
            id="traffic-slider"
            type="range" min="1" max="5" step="0.5"
            value={traffic}
            style={{ "--fill": `${fill}%` }}
            onChange={e => onTrafficChange(parseFloat(e.target.value))}
            onMouseUp={onTrafficCommit}
            onTouchEnd={onTrafficCommit}
          />
          <div className="slider-meta">
            <span/>
            <span>High Density</span>
          </div>
        </div>
      </div>

      <div className="divider"/>

      {/* ── GOD MODE TOGGLE ───────────────────────── */}
      <div className="panel-section">
        <span className="panel-label">Road Control</span>
        <div className="toggle-row">
          <div>
            <span className="toggle-label" style={{ color: godMode ? "#ff4444" : undefined }}>
              {godMode ? "⛔ God Mode ON" : "God Mode — Block Roads"}
            </span>
            <p className="mode-hint" style={{ marginTop: 4 }}>
              {godMode ? "Click any road to block / unblock it" : "Enable to click roads"}
            </p>
          </div>
          <label className="toggle">
            <input
              id="god-mode-toggle"
              type="checkbox"
              checked={godMode}
              onChange={e => onGodModeToggle(e.target.checked)}
            />
            <span className={`toggle-track${godMode ? " red" : ""}`}/>
          </label>
        </div>
      </div>

      <div className="divider"/>

      {/* ── ACTION BUTTONS ────────────────────────── */}
      <div className="panel-section">
        <button id="btn-new-city" className="action-btn new-city" onClick={onNewCity} disabled={calculating}>
          {calculating
            ? <><span className="spinner"/> Calculating…</>
            : "🏙 New City"}
        </button>
      </div>

      <div className="divider"/>

      {/* ── STATS CARD ────────────────────────────── */}
      <div className="panel-section">
        <span className="panel-label">Route Stats</span>
        <div className={`stats-card${stats.ready && !stats.success ? " no-path" : ""}`}>
          <div className="stat-row">
            <span className="stat-key">📍 Route Stops</span>
            <span className="stat-val">{stats.ready ? stats.stops : "—"}</span>
          </div>
          <div className="stat-row">
            <span className="stat-key">⏱ Travel Time</span>
            <span className="stat-val">{stats.ready ? stats.travelTime.toFixed(3) : "—"}</span>
          </div>
          <div className="stat-row">
            <span className="stat-key">💸 Toll Cost</span>
            <span className="stat-val">{stats.ready ? `$${stats.tollCost.toFixed(2)}` : "—"}</span>
          </div>
          <div className="stat-row">
            <span className="stat-key">🔎 Nodes Checked</span>
            <span className="stat-val">{stats.ready ? stats.nodesChecked : "—"}</span>
          </div>
          <div className="stat-divider"/>
          <div className="stat-row status-row">
            <span className="stat-key">Status</span>
            <span className={`stat-val status-badge ${!stats.ready ? "" : stats.success ? "success" : "fail"}`}>
              {!stats.ready ? "Awaiting…" : stats.success ? "✅ Path Found" : "🚫 No Route"}
            </span>
          </div>
        </div>
      </div>

      <div className="divider"/>

      {/* ── LEGEND ────────────────────────────────── */}
      <div className="panel-section">
        <span className="panel-label">Road Legend</span>
        <div className="legend">
          <div className="legend-item">
            <div className="legend-line highway"/>
            <span>Highway (toll &gt; 5)</span>
          </div>
          <div className="legend-item">
            <div className="legend-line main"/>
            <span>Main Road (toll 2–5)</span>
          </div>
          <div className="legend-item">
            <div className="legend-line local"/>
            <span>Local Road (toll &lt; 2)</span>
          </div>
          <div className="legend-item">
            <div className="legend-line blocked"/>
            <span>Blocked Road</span>
          </div>
          <div className="legend-item">
            <div className="legend-line path"/>
            <span>Active Path</span>
          </div>
        </div>
      </div>

      <div className="divider"/>

      {/* ── NETWORK DENSITY SLIDER ───────────────── */}
      <div className="panel-section">
        <span className="panel-label">Network Density</span>
        <div className="slider-wrap">
          <div className="slider-meta">
            <span>Fewer Nodes</span>
            <span className="val" style={{ color: 'var(--neon-cyan)' }}>
              {nodeCount} nodes
            </span>
          </div>
          <input
            id="node-count-slider"
            type="range" min="20" max="100" step="5"
            value={nodeCount}
            style={{ "--fill": `${nodeFill}%` }}
            onChange={e => onNodeCountChange(parseInt(e.target.value, 10))}
            onMouseUp={onNodeCountCommit}
            onTouchEnd={onNodeCountCommit}
          />
          <div className="slider-meta">
            <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>
              ◀ reduce · release to apply · increase ▶
            </span>
          </div>
        </div>
      </div>

    </aside>
  );
}

export default ControlPanel;
