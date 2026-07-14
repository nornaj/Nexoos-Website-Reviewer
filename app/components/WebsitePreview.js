"use client";

import { useState, useRef, useEffect } from "react";

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
        <button className="pin-tooltip-action-btn" onClick={(e) => { e.stopPropagation(); setShowReply(!showReply); }}>💬 Reply</button>
        <button className="pin-tooltip-action-btn" onClick={(e) => { e.stopPropagation(); onResolve(annotation.id); }}>{annotation.resolved ? "↩ Reopen" : "☑ Resolve"}</button>
        {!isGuest && (
          <button className="pin-tooltip-action-btn pin-tooltip-action-btn--danger" onClick={(e) => { e.stopPropagation(); onDelete(annotation.id); }}>🗑 Delete</button>
        )}
      </div>

      {showReply && (
        <div className="pin-tooltip-reply-form" onClick={(e) => e.stopPropagation()}>
          <input className="pin-tooltip-reply-input" placeholder="Write a reply…" value={replyText} onChange={(e) => setReplyText(e.target.value)} onKeyDown={handleKeyDown} autoFocus />
          <button className="pin-tooltip-reply-send" onClick={handleReplySubmit} disabled={!replyText.trim()}>Send</button>
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
  viewMode = "desktop",
}) {
  const [loading, setLoading] = useState(true);
  const overlayRef = useRef(null);
  const iframeRef = useRef(null);
  const [dragging, setDragging] = useState(null);
  const [hoveredPin, setHoveredPin] = useState(null);
  const hoverTimeout = useRef(null);
  const didDragRef = useRef(false);

  // Scroll state from the proxied iframe
  const [iframeScroll, setIframeScroll] = useState({ x: 0, y: 0, scrollHeight: 0, clientHeight: 0 });
  const iframeScrollRef = useRef({ x: 0, y: 0, scrollHeight: 0, clientHeight: 0 });

  // Refs for event handlers to avoid stale closures
  const activeToolRef = useRef(activeTool);
  const onAnnotationAddRef = useRef(onAnnotationAdd);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { onAnnotationAddRef.current = onAnnotationAdd; }, [onAnnotationAdd]);

  // The proxied URL
  const proxyUrl = url ? `/api/proxy?url=${encodeURIComponent(url)}` : "";

  // Listen for scroll messages from the proxied iframe
  useEffect(() => {
    function handleMessage(e) {
      if (!e.data || e.data.type !== "nexoos-scroll") return;
      const s = {
        x: e.data.scrollX || 0,
        y: e.data.scrollY || 0,
        scrollHeight: e.data.scrollHeight || 0,
        clientHeight: e.data.clientHeight || 0,
      };
      iframeScrollRef.current = s;
      setIframeScroll(s);
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Scroll iframe to annotation when clicking sidebar (only once per click)
  const lastScrolledId = useRef(null);
  useEffect(() => {
    if (!activeCommentId || !iframeRef.current) return;
    if (lastScrolledId.current === activeCommentId) return;
    lastScrolledId.current = activeCommentId;

    const annotation = annotations.find((a) => a.id === activeCommentId);
    if (!annotation?.position?.pageY) return;

    try {
      iframeRef.current.contentWindow.postMessage(
        { type: "nexoos-scrollTo", top: annotation.position.pageY - 200 },
        "*"
      );
    } catch {}
  }, [activeCommentId, annotations]);

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

  // ─── Click: place annotation ───
  const handleOverlayClick = (e) => {
    const tool = activeToolRef.current;
    if (tool === "select") return;
    if (didDragRef.current) { didDragRef.current = false; return; }

    const rect = overlayRef.current.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yViewportPx = e.clientY - rect.top;

    // Page-absolute position: viewport Y + iframe scroll offset
    const scroll = iframeScrollRef.current;
    const pageY = yViewportPx + scroll.y;

    onAnnotationAddRef.current({
      type: tool,
      position: { x: xPct, pageY, viewportHeight: rect.height },
      clientX: e.clientX,
      clientY: e.clientY,
    });
  };

  // ─── Drag: highlight/approve rectangle ───
  const handleMouseDown = (e) => {
    const tool = activeToolRef.current;
    if (tool !== "highlight" && tool !== "approve") return;
    didDragRef.current = false;

    const rect = overlayRef.current.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yViewportPx = e.clientY - rect.top;
    const scroll = iframeScrollRef.current;
    const pageY = yViewportPx + scroll.y;

    setDragging({
      startX: xPct, startPageY: pageY,
      currentX: xPct, currentPageY: pageY,
      clientX: e.clientX, clientY: e.clientY,
      viewportHeight: rect.height,
    });
  };

  const handleMouseMove = (e) => {
    if (!dragging) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yViewportPx = e.clientY - rect.top;
    const scroll = iframeScrollRef.current;
    const pageY = yViewportPx + scroll.y;

    setDragging((prev) => ({
      ...prev,
      currentX: xPct, currentPageY: pageY,
      clientX: e.clientX, clientY: e.clientY,
    }));
  };

  const handleMouseUp = () => {
    if (!dragging) return;
    const widthPct = Math.abs(dragging.currentX - dragging.startX);
    const heightPx = Math.abs(dragging.currentPageY - dragging.startPageY);

    if (widthPct > 1 && heightPx > 5) {
      didDragRef.current = true;
      onAnnotationAddRef.current({
        type: activeToolRef.current,
        position: {
          x: Math.min(dragging.startX, dragging.currentX),
          pageY: Math.min(dragging.startPageY, dragging.currentPageY),
          width: widthPct,
          heightPx: heightPx,
          viewportHeight: dragging.viewportHeight,
        },
        clientX: dragging.clientX,
        clientY: dragging.clientY,
      });
    }
    setDragging(null);
  };

  const getAnnotationNumber = (a) => annotations.findIndex((ann) => ann.id === a.id) + 1;

  const renderTooltip = (a) => {
    if (hoveredPin !== a.id) return null;
    return (
      <div onMouseEnter={handleTooltipEnter} onMouseLeave={handleTooltipLeave}>
        <PinTooltip annotation={a} onResolve={onResolve} onDelete={onDelete} onReply={onReply} isGuest={isGuest} />
      </div>
    );
  };

  // ─── Convert page-absolute Y to viewport-relative % ───
  const pageYToViewportPct = (pageY, overlayHeight) => {
    const viewportY = pageY - iframeScroll.y;
    return (viewportY / overlayHeight) * 100;
  };

  const renderOverlay = () => {
    const overlayHeight = overlayRef.current?.getBoundingClientRect().height || 1;

    return (
      <div
        ref={overlayRef}
        className={`preview-overlay${activeTool === "select" ? " mode-select" : ""}`}
        onClick={handleOverlayClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {annotations.map((a) => {
          const pos = a.position;
          if (!pos) return null;

          // Rectangle annotations
          if (pos.width && pos.heightPx) {
            const topPct = pageYToViewportPct(pos.pageY, overlayHeight);
            const heightPct = (pos.heightPx / overlayHeight) * 100;
            // Hide if completely off-screen
            if (topPct > 100 || topPct + heightPct < 0) return null;

            return (
              <div
                key={a.id}
                className={`annotation-rect annotation-rect--${a.type}`}
                style={{ left: `${pos.x}%`, top: `${topPct}%`, width: `${pos.width}%`, height: `${heightPct}%` }}
                onMouseEnter={() => handlePinEnter(a.id)}
                onMouseLeave={handlePinLeave}
                onClick={(e) => { e.stopPropagation(); onPinClick(a.id); }}
              >
                {renderTooltip(a)}
              </div>
            );
          }

          // Pin annotations
          const topPct = pageYToViewportPct(pos.pageY != null ? pos.pageY : (pos.y || 0), overlayHeight);
          // Hide if off-screen
          if (topPct > 105 || topPct < -5) return null;

          return (
            <div
              key={a.id}
              className={`annotation-pin annotation-pin--${a.type}${activeCommentId === a.id ? " active" : ""}`}
              style={{ left: `${pos.x || 0}%`, top: `${topPct}%` }}
              onMouseEnter={() => handlePinEnter(a.id)}
              onMouseLeave={handlePinLeave}
              onClick={(e) => { e.stopPropagation(); onPinClick(a.id); }}
            >
              {getAnnotationNumber(a)}
              {renderTooltip(a)}
            </div>
          );
        })}

        {/* Drag preview rectangle */}
        {dragging && (() => {
          const topPct = pageYToViewportPct(Math.min(dragging.startPageY, dragging.currentPageY), overlayHeight);
          const heightPct = (Math.abs(dragging.currentPageY - dragging.startPageY) / overlayHeight) * 100;
          return (
            <div
              className={`annotation-rect annotation-rect--${activeTool}`}
              style={{
                left: `${Math.min(dragging.startX, dragging.currentX)}%`,
                top: `${topPct}%`,
                width: `${Math.abs(dragging.currentX - dragging.startX)}%`,
                height: `${heightPct}%`,
                opacity: 0.6,
              }}
            />
          );
        })()}
      </div>
    );
  };

  const isMobile = viewMode === "mobile";

  return (
    <div className={`preview-panel${isMobile ? " preview-panel--mobile" : ""}`}>
      {loading && (
        <div className="preview-loading">
          <div className="preview-spinner" />
          <span>Loading website…</span>
        </div>
      )}

      {isMobile ? (
        <div className="mobile-device-frame">
          <div className="mobile-device-notch" />
          <div
            className="preview-iframe-wrap preview-iframe-wrap--mobile"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: "top center",
            }}
          >
            <iframe
              ref={iframeRef}
              src={proxyUrl}
              className="preview-iframe"
              title="Website preview (mobile)"
              onLoad={() => setLoading(false)}
              onError={() => setLoading(false)}
            />
            {renderOverlay()}
          </div>
        </div>
      ) : (
        <div
          className="preview-iframe-wrap"
          style={{
            transform: `scale(${zoom / 100})`,
            transformOrigin: "top left",
            width: `${10000 / zoom}%`,
            height: `${10000 / zoom}%`,
          }}
        >
          <iframe
            ref={iframeRef}
            src={proxyUrl}
            className="preview-iframe"
            title="Website preview"
            onLoad={() => setLoading(false)}
            onError={() => setLoading(false)}
          />
          {renderOverlay()}
        </div>
      )}
    </div>
  );
}

