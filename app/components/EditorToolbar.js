"use client";

import Link from "next/link";

const TOOLS = [
  { id: "select", icon: "🔲", label: "Select" },
  { id: "comment", icon: "💬", label: "Comment" },
  { id: "highlight", icon: "🔴", label: "Highlight" },
  { id: "approve", icon: "✅", label: "Approve" },
  { id: "suggestion", icon: "✏️", label: "Suggest" },
];

export default function EditorToolbar({
  projectId,
  projectName,
  activeTool,
  onToolChange,
  zoom,
  onZoomChange,
  onShare,
  isGuest = false,
  viewMode = "desktop",
  onViewModeChange,
}) {
  const zoomLevels = [50, 75, 100, 125, 150];

  const zoomIn = () => {
    const idx = zoomLevels.indexOf(zoom);
    if (idx < zoomLevels.length - 1) onZoomChange(zoomLevels[idx + 1]);
  };

  const zoomOut = () => {
    const idx = zoomLevels.indexOf(zoom);
    if (idx > 0) onZoomChange(zoomLevels[idx - 1]);
  };

  return (
    <div className="editor-toolbar">
      <div className="editor-toolbar-left">
        {!isGuest ? (
          <Link href={`/project/${projectId}`} className="editor-back" title="Back to project">
            ←
          </Link>
        ) : (
          <div className="editor-back" style={{ cursor: "default", opacity: 0.4 }}>
            👁
          </div>
        )}
        <span className="editor-project-name">{projectName}</span>

        <div className="device-toggle">
          <button
            className={`device-toggle-btn${viewMode === "desktop" ? " active" : ""}`}
            onClick={() => onViewModeChange?.("desktop")}
            title="Desktop view"
            id="device-desktop"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </button>
          <button
            className={`device-toggle-btn${viewMode === "mobile" ? " active" : ""}`}
            onClick={() => onViewModeChange?.("mobile")}
            title="Mobile view"
            id="device-mobile"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="2" width="14" height="20" rx="2" />
              <line x1="12" y1="18" x2="12" y2="18" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="editor-toolbar-center">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            className={`tool-btn${activeTool === tool.id ? " active" : ""}`}
            onClick={() => onToolChange(tool.id)}
            title={tool.label}
          >
            <span className="tool-btn-icon">{tool.icon}</span>
            <span>{tool.label}</span>
          </button>
        ))}
      </div>

      <div className="editor-toolbar-right">
        <div className="zoom-controls">
          <button className="zoom-btn" onClick={zoomOut} title="Zoom out">
            −
          </button>
          <span className="zoom-level">{zoom}%</span>
          <button className="zoom-btn" onClick={zoomIn} title="Zoom in">
            +
          </button>
        </div>

        <button className="btn btn--small btn--secondary" onClick={onShare}>
          🔗 Share
        </button>

        {isGuest && (
          <div className="guest-banner">👤 Guest reviewer</div>
        )}

        <span style={{ fontSize: "9px", color: "#999", marginLeft: "8px", userSelect: "none" }}>v7</span>
      </div>
    </div>
  );
}
