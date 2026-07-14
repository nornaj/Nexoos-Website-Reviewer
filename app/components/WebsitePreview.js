"use client";

import { useState, useRef, useCallback, useEffect } from "react";

function formatExactDate(timestamp) {
  const d = new Date(timestamp);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getTypeLabel(type) {
  switch (type) {
    case "comment": return "Comment";
    case "highlight": return "Highlight";
    case "approve": return "Approved";
    case "suggestion": return "Suggestion";
    default: return "Comment";
  }
}

function PinTooltip({ annotation, onResolve, onDelete, onReply, isGuest }) {
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState("");

  const handleReplySubmit = () => {
    if (!replyText.trim()) return;
    onReply(annotation.id, replyText.trim());
    setReplyText("");
    setShowReply(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleReplySubmit();
    }
    if (e.key === "Escape") {
      setShowReply(false);
      setReplyText("");
    }
  };

  return (
    <div className="pin-tooltip" onClick={(e) => e.stopPropagation()}>
      <div className="pin-tooltip-header">
        <span className="pin-tooltip-author">{annotation.author}</span>
        <span className="pin-tooltip-type">{getTypeLabel(annotation.type)}</span>
      </div>
      {annotation.text && <div className="pin-tooltip-text">{annotation.text}</div>}
      <div className="pin-tooltip-date">{formatExactDate(annotation.createdAt)}</div>

      {annotation.replies && annotation.replies.length > 0 && (
        <div className="pin-tooltip-replies-list">
          {annotation.replies.map((r) => (
            <div key={r.id} className="pin-tooltip-reply">
              <strong>{r.author}</strong> {r.text}
            </div>
          ))}
        </div>
      )}

      <div className="pin-tooltip-actions">
        <button
          className="pin-tooltip-action-btn"
          onClick={(e) => { e.stopPropagation(); setShowReply(!showReply); }}
        >
          💬 Reply
        </button>
        <button
          className="pin-tooltip-action-btn"
          onClick={(e) => { e.stopPropagation(); onResolve(annotation.id); }}
        >
          {annotation.resolved ? "↩ Reopen" : "☑ Resolve"}
        </button>
        {!isGuest && (
          <button
            className="pin-tooltip-action-btn pin-tooltip-action-btn--danger"
            onClick={(e) => { e.stopPropagation(); onDelete(annotation.id); }}
          >
            🗑 Delete
          </button>
        )}
      </div>

      {showReply && (
        <div className="pin-tooltip-reply-form" onClick={(e) => e.stopPropagation()}>
          <input
            className="pin-tooltip-reply-input"
            placeholder="Write a reply…"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <button
            className="pin-tooltip-reply-send"
            onClick={handleReplySubmit}
            disabled={!replyText.trim()}
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}

export default function WebsitePreview({
  url,
  zoom,
  activeTool,
  annotations,
  onAnnotationAdd,
  activeCommentId,
  onPinClick,
  onResolve,
  onDelete,
  onReply,
  isGuest = false,
}) {
  const [loading, setLoading] = useState(true);
  const [screenshotUrl, setScreenshotUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const overlayRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const [dragging, setDragging] = useState(null);
  const [hoveredPin, setHoveredPin] = useState(null);
  const hoverTimeout = useRef(null);
  const didDragRef = useRef(false);

  // Fetch full-page screenshot on mount
  useEffect(() => {
    if (!url) return;
    setLoading(true);
    setFailed(false);

    const imgUrl = `/api/screenshot?url=${encodeURIComponent(url)}&fullPage=true`;

    // Preload the image to check if it loads
    const img = new Image();
    img.onload = () => {
      setScreenshotUrl(imgUrl);
      setLoading(false);
    };
    img.onerror = () => {
      setFailed(true);
      setLoading(false);
    };
    img.src = imgUrl;
  }, [url]);

  // Scroll to annotation when clicking sidebar
  useEffect(() => {
    if (!activeCommentId || !scrollContainerRef.current) return;
    const annotation = annotations.find((a) => a.id === activeCommentId);
    if (!annotation?.position) return;

    const container = scrollContainerRef.current;
    const imgEl = container.querySelector(".preview-page-image");
    if (!imgEl) return;

    const scaleF = zoom / 100;
    const targetY = (annotation.position.y / 100) * imgEl.naturalHeight * scaleF;
    container.scrollTo({
      top: targetY - container.clientHeight / 3,
      behavior: "smooth",
    });
  }, [activeCommentId, annotations, zoom]);

  const handlePinEnter = (id) => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    setHoveredPin(id);
  };

  const handlePinLeave = () => {
    hoverTimeout.current = setTimeout(() => setHoveredPin(null), 150);
  };

  const handleTooltipEnter = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
  };

  const handleTooltipLeave = () => {
    hoverTimeout.current = setTimeout(() => setHoveredPin(null), 150);
  };

  const handleOverlayClick = useCallback(
    (e) => {
      if (activeTool === "select") return;
      if (didDragRef.current) {
        didDragRef.current = false;
        return;
      }

      const rect = overlayRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;

      onAnnotationAdd({
        type: activeTool,
        position: { x, y },
        clientX: e.clientX,
        clientY: e.clientY,
      });
    },
    [activeTool, onAnnotationAdd]
  );

  const handleMouseDown = useCallback(
    (e) => {
      if (activeTool !== "highlight" && activeTool !== "approve") return;
      didDragRef.current = false;

      const rect = overlayRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;

      setDragging({ startX: x, startY: y, currentX: x, currentY: y, clientX: e.clientX, clientY: e.clientY });
    },
    [activeTool]
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (!dragging) return;

      const rect = overlayRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;

      setDragging((prev) => ({ ...prev, currentX: x, currentY: y, clientX: e.clientX, clientY: e.clientY }));
    },
    [dragging]
  );

  const handleMouseUp = useCallback(() => {
    if (!dragging) return;

    const width = Math.abs(dragging.currentX - dragging.startX);
    const height = Math.abs(dragging.currentY - dragging.startY);

    if (width > 1 && height > 1) {
      didDragRef.current = true;
      onAnnotationAdd({
        type: activeTool,
        position: {
          x: Math.min(dragging.startX, dragging.currentX),
          y: Math.min(dragging.startY, dragging.currentY),
          width,
          height,
        },
        clientX: dragging.clientX,
        clientY: dragging.clientY,
      });
    }

    setDragging(null);
  }, [dragging, activeTool, onAnnotationAdd]);

  const getAnnotationNumber = (annotation) => {
    const idx = annotations.findIndex((a) => a.id === annotation.id);
    return idx + 1;
  };

  const renderTooltip = (a) => {
    if (hoveredPin !== a.id) return null;
    return (
      <div onMouseEnter={handleTooltipEnter} onMouseLeave={handleTooltipLeave}>
        <PinTooltip
          annotation={a}
          onResolve={onResolve}
          onDelete={onDelete}
          onReply={onReply}
          isGuest={isGuest}
        />
      </div>
    );
  };

  return (
    <div className="preview-panel" ref={scrollContainerRef}>
      {loading && (
        <div className="preview-loading">
          <div className="preview-spinner" />
          <span>Capturing full page screenshot…</span>
        </div>
      )}

      {failed ? (
        <div className="preview-fallback">
          <div className="preview-fallback-icon">🚫</div>
          <div className="preview-fallback-text">
            Failed to capture this website. It may be blocking screenshots.
          </div>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn--small"
          >
            Open in new tab ↗
          </a>
        </div>
      ) : screenshotUrl ? (
        <div
          className="preview-screenshot-wrap"
          style={{
            transform: `scale(${zoom / 100})`,
            transformOrigin: "top left",
            width: `${10000 / zoom}%`,
          }}
        >
          {/* Full-page screenshot as the visual layer */}
          <img
            src={screenshotUrl}
            alt="Full page screenshot"
            className="preview-page-image"
            draggable={false}
          />

          {/* Annotation overlay — matches the image size exactly */}
          <div
            ref={overlayRef}
            className={`preview-overlay${activeTool === "select" ? " mode-select" : ""}`}
            onClick={handleOverlayClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            {/* Render annotations */}
            {annotations.map((a) => {
              if (a.position?.width && a.position?.height) {
                return (
                  <div
                    key={a.id}
                    className={`annotation-rect annotation-rect--${a.type}`}
                    style={{
                      left: `${a.position.x}%`,
                      top: `${a.position.y}%`,
                      width: `${a.position.width}%`,
                      height: `${a.position.height}%`,
                    }}
                    onMouseEnter={() => handlePinEnter(a.id)}
                    onMouseLeave={handlePinLeave}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPinClick(a.id);
                    }}
                  >
                    {renderTooltip(a)}
                  </div>
                );
              }

              return (
                <div
                  key={a.id}
                  className={`annotation-pin annotation-pin--${a.type}${activeCommentId === a.id ? " active" : ""}`}
                  style={{
                    left: `${a.position?.x || 0}%`,
                    top: `${a.position?.y || 0}%`,
                  }}
                  onMouseEnter={() => handlePinEnter(a.id)}
                  onMouseLeave={handlePinLeave}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPinClick(a.id);
                  }}
                >
                  {getAnnotationNumber(a)}
                  {renderTooltip(a)}
                </div>
              );
            })}

            {/* Drag preview rectangle */}
            {dragging && (
              <div
                className={`annotation-rect annotation-rect--${activeTool}`}
                style={{
                  left: `${Math.min(dragging.startX, dragging.currentX)}%`,
                  top: `${Math.min(dragging.startY, dragging.currentY)}%`,
                  width: `${Math.abs(dragging.currentX - dragging.startX)}%`,
                  height: `${Math.abs(dragging.currentY - dragging.startY)}%`,
                  opacity: 0.6,
                }}
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
