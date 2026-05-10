import type { HandDebugInfo, HandState } from "../game/PunchDetector";

const STATE_COLOR: Record<HandState, string> = {
  idle:     "#555",
  cocking:  "#fbbf24",
  punching: "#22c55e",
  cooldown: "#ef4444",
};

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, (Math.abs(value) / max) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
      <div style={{ width: 26, fontSize: 9, color: "#666", textAlign: "right" }}>
        {value >= 0 ? "+" : ""}{value.toFixed(2)}
      </div>
      <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.08)", borderRadius: 3 }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: color,
            borderRadius: 3,
            opacity: 0.85,
            float: value >= 0 ? "left" : "right",
          }}
        />
      </div>
    </div>
  );
}

function HandPanel({ label, info }: { label: string; info: HandDebugInfo }) {
  const sc = STATE_COLOR[info.state];
  const gestureLabel = info.blocking ? "BLOCK" : info.lastGesture.toUpperCase();
  const gestureColor = info.blocking ? "#fbbf24" : info.lastGesture === "charge" ? "#ff4a17" : "#4a90ff";

  return (
    <div
      style={{
        marginBottom: 10,
        paddingBottom: 10,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: 2, textTransform: "uppercase" }}>
          {label}
        </span>
        {/* State badge */}
        <span
          style={{
            fontSize: 9,
            fontWeight: "bold",
            padding: "1px 5px",
            borderRadius: 3,
            border: `1px solid ${sc}`,
            color: sc,
            background: sc + "18",
            letterSpacing: 1,
          }}
        >
          {info.state.toUpperCase()}
        </span>
        {/* Gesture + confidence */}
        {info.confidence > 0.3 && (
          <span style={{ fontSize: 9, color: gestureColor, fontWeight: "bold", marginLeft: "auto" }}>
            {gestureLabel} {Math.round(info.confidence * 100)}%
          </span>
        )}
      </div>

      {/* Speed bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
        <div style={{ fontSize: 9, color: "#888", width: 38 }}>spd</div>
        <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.08)", borderRadius: 3 }}>
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, (info.speed / 2) * 100)}%`,
              background: info.speed > 0.28 ? "#22c55e" : info.speed > 0.08 ? "#fbbf24" : "#444",
              borderRadius: 3,
              transition: "width 0.05s",
            }}
          />
        </div>
        <div style={{ fontSize: 9, color: "#666", width: 28 }}>{info.speed.toFixed(2)}</div>
      </div>

      {/* Velocity breakdown */}
      <div style={{ fontSize: 9, color: "#555", marginBottom: 2 }}>velocity (u/s)</div>
      <Bar value={info.vel.x} max={2} color="#4a90ff" />
      <Bar value={info.vel.y} max={2} color="#22c55e" />
      <Bar value={info.vel.z} max={2} color="#a78bfa" />
      <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
        {(["x","y","z"] as const).map((ax) => (
          <span key={ax} style={{ fontSize: 8, color: "#444" }}>
            {ax}:{info.vel[ax].toFixed(2)}
          </span>
        ))}
      </div>
    </div>
  );
}

interface DebugOverlayProps {
  left: HandDebugInfo;
  right: HandDebugInfo;
  onClose: () => void;
}

export function DebugOverlay({ left, right, onClose }: DebugOverlayProps) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 148,
        right: 16,
        background: "rgba(4,4,12,0.93)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8,
        padding: "10px 12px",
        zIndex: 22,
        width: 230,
        fontFamily: "monospace",
        userSelect: "none",
      }}
    >
      {/* Title */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 9, color: "#ff4a17", fontWeight: "bold", letterSpacing: 2 }}>
          ◈ GESTURE DEBUG
        </div>
        <button
          onClick={onClose}
          style={{
            fontSize: 10,
            color: "#555",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {(Object.entries(STATE_COLOR) as [HandState, string][]).map(([s, c]) => (
          <span key={s} style={{ fontSize: 8, color: c, border: `1px solid ${c}44`, padding: "1px 4px", borderRadius: 2 }}>
            {s}
          </span>
        ))}
      </div>

      <HandPanel label="LEFT  HAND" info={left} />
      <HandPanel label="RIGHT HAND" info={right} />

      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.15)", marginTop: 2 }}>
        Press D to hide · thresholds: punch≥0.28 charge≥0.32
      </div>
    </div>
  );
}
