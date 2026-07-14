"use client";

import { useState } from "react";
import { formatDate } from "@/lib/store";

export default function CommentsSidebar({
  comments,
  activeCommentId,
  onCommentClick,
  onResolve,
  onDelete,
  onReply,
  onAddComment,
  isGuest = false,
  guestName = "",
  onGuestNameChange,
}) {
  const [filter, setFilter] = useState("all");
  const [newComment, setNewComment] = useState("");
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState("");

  const filtered = comments.filter((c) => {
    if (filter === "all") return true;
    if (filter === "unresolved") return !c.resolved;
    if (filter === "resolved") return c.resolved;
    return true;
  });

  const handleSubmit = () => {
    if (!newComment.trim()) return;
    onAddComment(newComment.trim());
    setNewComment("");
  };

  const handleReplySubmit = (commentId) => {
    if (!replyText.trim()) return;
    onReply(commentId, replyText.trim());
    setReplyText("");
    setReplyingTo(null);
  };

  const handleKeyDown = (e, action) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      action();
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case "comment": return "💬";
      case "highlight": return "🔴";
      case "approve": return "✅";
      case "suggestion": return "✏️";
      default: return "💬";
    }
  };

  const formatTime = (timestamp) => {
    const now = Date.now();
    const diff = now - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return formatDate(timestamp);
  };

  return (
    <div className="comments-sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title">
          Comments <span className="sidebar-count">({comments.length})</span>
        </div>
        <div className="sidebar-filters">
          {["all", "unresolved", "resolved"].map((f) => (
            <button
              key={f}
              className={`sidebar-filter-btn${filter === f ? " active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-list">
        {filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: "40px 20px" }}>
            <div className="empty-state-icon" style={{ fontSize: 32 }}>
              {filter === "resolved" ? "☑️" : "💬"}
            </div>
            <h2 className="empty-state-title" style={{ fontSize: 16 }}>
              {filter === "resolved"
                ? "No resolved comments"
                : "No comments yet"}
            </h2>
            <p className="empty-state-desc" style={{ fontSize: 13 }}>
              {filter === "all"
                ? "Use the tools to start reviewing"
                : `No ${filter} comments to show`}
            </p>
          </div>
        ) : (
          filtered.map((comment) => (
            <div
              key={comment.id}
              className={`comment-card${activeCommentId === comment.id ? " active" : ""}${comment.resolved ? " resolved" : ""}`}
              onClick={() => onCommentClick(comment.id)}
            >
              <div className="comment-header">
                <div className="comment-author">
                  <span className={`comment-type-dot comment-type-dot--${comment.type}`} />
                  {comment.author}
                </div>
                <span className="comment-time">{formatTime(comment.createdAt)}</span>
              </div>

              <div className={`comment-text${comment.resolved ? " resolved-text" : ""}`}>
                {comment.text || `${getTypeIcon(comment.type)} ${comment.type === "highlight" ? "Marked as unwanted" : comment.type === "approve" ? "Approved section" : comment.type === "suggestion" ? "Edit suggestion" : "Comment"}`}
              </div>

              <div className="comment-actions">
                <button
                  className="comment-action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onResolve(comment.id);
                  }}
                >
                  {comment.resolved ? "↩ Reopen" : "☑ Resolve"}
                </button>
                <button
                  className="comment-action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setReplyingTo(replyingTo === comment.id ? null : comment.id);
                  }}
                >
                  💬 Reply
                </button>
                {!isGuest && (
                  <button
                    className="comment-action-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(comment.id);
                    }}
                  >
                    🗑
                  </button>
                )}
              </div>

              {/* Replies */}
              {comment.replies && comment.replies.length > 0 && (
                <div className="comment-replies">
                  {comment.replies.map((reply) => (
                    <div key={reply.id} className="reply-item">
                      <div className="reply-author">
                        {reply.author}
                        <span className="comment-time">{formatTime(reply.createdAt)}</span>
                      </div>
                      <div className="reply-text">{reply.text}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Reply form */}
              {replyingTo === comment.id && (
                <div className="reply-form" onClick={(e) => e.stopPropagation()}>
                  <input
                    className="reply-input"
                    placeholder="Write a reply…"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, () => handleReplySubmit(comment.id))}
                    autoFocus
                  />
                  <button
                    className="reply-send"
                    onClick={() => handleReplySubmit(comment.id)}
                  >
                    Send
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="sidebar-add-comment">
        <textarea
          placeholder="Add a general comment…"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, handleSubmit)}
        />
        <div className="sidebar-add-row">
          {isGuest && (
            <input
              className="sidebar-add-name"
              placeholder="Your name"
              value={guestName}
              onChange={(e) => onGuestNameChange(e.target.value)}
            />
          )}
          <button
            className="sidebar-add-submit"
            onClick={handleSubmit}
            disabled={!newComment.trim()}
          >
            Add Comment
          </button>
        </div>
      </div>
    </div>
  );
}
