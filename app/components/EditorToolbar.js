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
      </div>
    </div>
  );
}
