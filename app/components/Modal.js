"use client";

import { useState, useEffect } from "react";

export default function Modal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  danger = false,
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Small delay to trigger CSS transition
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 150);
  };

  const handleConfirm = () => {
    setVisible(false);
    setTimeout(onConfirm, 150);
  };

  return (
    <div
      className={`modal-overlay${visible ? " modal-overlay--visible" : ""}`}
      onClick={handleClose}
    >
      <div
        className={`modal-card${visible ? " modal-card--visible" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="modal-title">{title}</h2>
        <p className="modal-message">{message}</p>
        <div className="modal-actions">
          <button className="modal-btn modal-btn--cancel" onClick={handleClose}>
            {cancelText}
          </button>
          <button
            className={`modal-btn ${danger ? "modal-btn--danger" : "modal-btn--confirm"}`}
            onClick={handleConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
