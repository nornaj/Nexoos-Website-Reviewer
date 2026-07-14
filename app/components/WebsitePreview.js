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
  const [failed, setFailed] = useState(false);
  const overlayRef = useRef(null);
  const iframeRef = useRef(null);
  const [dragging, setDragging] = useState(null);
  const [hoveredPin, setHoveredPin] = useState(null);
  const hoverTimeout = useRef(null);

  // Track the iframe's internal scroll offset via polling
  const [iframeScroll, setIframeScroll] = useState({ x: 0, y: 0 });
  const scrollPollRef = useRef(null);

  useEffect(() => {
    const poll = () => {
      try {
        const iframe = iframeRef.current;
        if (iframe && iframe.contentWindow) {
          const sx = iframe.contentWindow.scrollX || 0;
          const sy = iframe.contentWindow.scrollY || 0;
          setIframeScroll((prev) => {
            if (prev.x !== sx || prev.y !== sy) return { x: sx, y: sy };
            return prev;
          });
        }
      } catch {
        // Cross-origin: can't access scroll — that's OK
      }
    };
    scrollPollRef.current = setInterval(poll, 100);
    return () => clearInterval(scrollPollRef.current);
  }, []);

  const handleIframeLoad = () => {
    setLoading(false);
    // Try to inject scroll listener for same-origin iframes
    try {
      const win = iframeRef.current?.contentWindow;
      if (win) {
        win.addEventListener("scroll", () => {
          setIframeScroll({ x: win.scrollX || 0, y: win.scrollY || 0 });
        });
      }
    } catch {
      // Cross-origin — polling handles this
    }
  };

  const handleIframeError = () => {
    setLoading(false);
    setFailed(true);
  };

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

  /**
   * Convert a click to a DOCUMENT-RELATIVE position.
   * We store: x% across the viewport width, y in PIXELS from the top of the page
   * (viewport-relative y + scrollY). This means the pin is anchored to page content.
   */
  const getDocPosition = useCallback((e) => {
    const overlay = overlayRef.current;
    if (!overlay) return { x: 0, y: 0, scrollY: 0 };
    const rect = overlay.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    // Y position = viewport-relative pixels + iframe scroll offset
    const yViewportPx = e.clientY - rect.top;
    const yPagePx = yViewportPx + iframeScroll.y;
    return { x: xPct, y: yPagePx, viewportHeight: rect.height };
  }, [iframeScroll]);

  const handleOverlayClick = useCallback(
    (e) => {
      if (activeTool === "select") return;
      const { x, y, viewportHeight } = getDocPosition(e);

      onAnnotationAdd({
        type: activeTool,
        position: { x, y, viewportHeight },
        clientX: e.clientX,
        clientY: e.clientY,
      });
    },
    [activeTool, onAnnotationAdd, getDocPosition]
  );

  const handleMouseDown = useCallback(
    (e) => {
      if (activeTool !== "highlight" && activeTool !== "approve") return;
      const { x, y, viewportHeight } = getDocPosition(e);
      setDragging({ startX: x, startY: y, currentX: x, currentY: y, viewportHeight, clientX: e.clientX, clientY: e.clientY });
    },
    [activeTool, getDocPosition]
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (!dragging) return;
      const { x, y } = getDocPosition(e);
      setDragging((prev) => ({ ...prev, currentX: x, currentY: y, clientX: e.clientX, clientY: e.clientY }));
    },
    [dragging, getDocPosition]
  );

  const handleMouseUp = useCallback(() => {
    if (!dragging) return;

    const widthPct = Math.abs(dragging.currentX - dragging.startX);
    const heightPx = Math.abs(dragging.currentY - dragging.startY);

    if (widthPct > 1 && heightPx > 5) {
      onAnnotationAdd({
        type: activeTool,
        position: {
          x: Math.min(dragging.startX, dragging.currentX),
          y: Math.min(dragging.startY, dragging.currentY),
          width: widthPct,
          height: heightPx,
          viewportHeight: dragging.viewportHeight,
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

  /**
   * Convert stored document-relative position back to viewport-relative
   * for rendering. If the pin is off-screen, it won't show (which is correct).
   */
  const getPinStyle = useCallback((pos) => {
    if (!pos || !overlayRef.current) return { display: "none" };
    const rect = overlayRef.current.getBoundingClientRect();
    const vh = rect.height;

    // Y: stored as page-absolute pixels. Subtract current scroll to get viewport position.
    const yViewport = pos.y - iframeScroll.y;
    const topPct = (yViewport / vh) * 100;

    return {
      left: `${pos.x}%`,
      top: `${topPct}%`,
    };
  }, [iframeScroll]);

  const getRectStyle = useCallback((pos) => {
    if (!pos || !overlayRef.current) return { display: "none" };
    const rect = overlayRef.current.getBoundingClientRect();
    const vh = rect.height;

    const yViewport = pos.y - iframeScroll.y;
    const topPct = (yViewport / vh) * 100;
    const heightPct = (pos.height / vh) * 100;

    return {
      left: `${pos.x}%`,
      top: `${topPct}%`,
      width: `${pos.width}%`,
      height: `${heightPct}%`,
    };
  }, [iframeScroll]);

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

  // When activeCommentId changes, try to scroll iframe to that annotation
  useEffect(() => {
    if (!activeCommentId) return;
    const annotation = annotations.find((a) => a.id === activeCommentId);
    if (!annotation?.position) return;
    try {
      const iframe = iframeRef.current;
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.scrollTo({
          top: Math.max(0, annotation.position.y - 200),
          behavior: "smooth",
        });
      }
    } catch {
      // Cross-origin: can't scroll iframe
    }
  }, [activeCommentId, annotations]);

  return (
    <div className="preview-panel">
      {loading && (
        <div className="preview-loading">
          <div className="preview-spinner" />
          <span>Loading website preview…</span>
        </div>
      )}

      {failed ? (
        <div className="preview-fallback">
          <div className="preview-fallback-icon">🚫</div>
          <div className="preview-fallback-text">
            This website cannot be embedded. It may be blocking iframe loading.
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
      ) : (
        <div
          className="preview-iframe-wrap"
          style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top left", width: `${10000 / zoom}%`, height: `${10000 / zoom}%` }}
        >
          <iframe
            ref={iframeRef}
            src={url}
            className="preview-iframe"
            title="Website preview"
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            onLoad={handleIframeLoad}
            onError={handleIframeError}
          />

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
                const style = getRectStyle(a.position);
                return (
                  <div
                    key={a.id}
                    className={`annotation-rect annotation-rect--${a.type}`}
                    style={style}
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

              const style = getPinStyle(a.position);
              return (
                <div
                  key={a.id}
                  className={`annotation-pin annotation-pin--${a.type}${activeCommentId === a.id ? " active" : ""}`}
                  style={style}
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
            {dragging && (() => {
              const rect = overlayRef.current?.getBoundingClientRect();
              const vh = rect?.height || 1;
              const yViewport = dragging.currentY - iframeScroll.y;
              const startYViewport = dragging.startY - iframeScroll.y;
              return (
                <div
                  className={`annotation-rect annotation-rect--${activeTool}`}
                  style={{
                    left: `${Math.min(dragging.startX, dragging.currentX)}%`,
                    top: `${(Math.min(startYViewport, yViewport) / vh) * 100}%`,
                    width: `${Math.abs(dragging.currentX - dragging.startX)}%`,
                    height: `${(Math.abs(dragging.currentY - dragging.startY) / vh) * 100}%`,
                    opacity: 0.6,
                  }}
                />
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
