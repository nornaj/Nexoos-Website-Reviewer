"use client";

import { useState, useRef, useEffect } from "react";

export default function AnnotationPopup({
  isOpen,
  position,
  type,
  onSubmit,
  onCancel,
  required = false,
}) {
  const [text, setText] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setText("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (required && !text.trim()) return;
    onSubmit(text.trim());
    setText("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      onCancel();
    }
  };

  const labels = {
    comment: { title: "Add Comment", placeholder: "Write your comment…", icon: "💬" },
    highlight: { title: "Highlight Note", placeholder: "Why is this unwanted? (optional)", icon: "🔴" },
    approve: { title: "Approval Note", placeholder: "Add a note (optional)", icon: "✅" },
    suggestion: { title: "Edit Suggestion", placeholder: "Suggest a text change…", icon: "✏️" },
  };

  const label = labels[type] || labels.comment;

  return (
    <div className="ann-popup-overlay" onClick={onCancel}>
      <div
        className="ann-popup"
        style={{
          left: `${Math.min(position?.clientX || 300, window.innerWidth - 320)}px`,
          top: `${Math.min((position?.clientY || 200) + 12, window.innerHeight - 200)}px`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ann-popup-header">
          <span className="ann-popup-icon">{label.icon}</span>
          <span className="ann-popup-title">{label.title}</span>
        </div>
        <textarea
          ref={inputRef}
          className="ann-popup-input"
          placeholder={label.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
        />
        <div className="ann-popup-actions">
          <button className="ann-popup-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="ann-popup-submit"
            onClick={handleSubmit}
            disabled={required && !text.trim()}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
