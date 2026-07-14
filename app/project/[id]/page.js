"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useProjects } from "@/lib/context";
import { useToast } from "@/app/components/Toast";
import { formatDate } from "@/lib/store";
import { getCommentsByProject } from "@/lib/annotations";
import Modal from "@/app/components/Modal";

export default function ProjectDetail() {
  const { id } = useParams();
  const router = useRouter();
  const { getProjectById, updateProject, deleteProject } = useProjects();
  const { addToast } = useToast();

  const project = getProjectById(id);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [deleteModal, setDeleteModal] = useState(false);
  const [comments, setComments] = useState([]);

  useEffect(() => {
    if (project) {
      setForm({
        name: project.name,
        url: project.url,
        reviewerName: project.reviewerName,
        status: project.status,
        notes: project.notes,
      });
      setComments(getCommentsByProject(project.id));
    }
  }, [project]);

  if (!project) {
    return (
      <div className="wrap wrap--narrow page-enter">
        <Link href="/" className="back">
          <span className="back-arrow">←</span> Back to projects
        </Link>
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <h2 className="empty-state-title">Project not found</h2>
          <p className="empty-state-desc">
            This project may have been deleted or the link is invalid.
          </p>
        </div>
      </div>
    );
  }

  const handleSave = async () => {
    await updateProject(id, form);
    setEditing(false);
    addToast("Project updated", "success");
  };

  const handleDelete = async () => {
    await deleteProject(id);
    addToast(`"${project.name}" deleted`, "success");
    router.push("/");
  };

  const copyShareLink = () => {
    const url = `${window.location.origin}/review/${project.shareToken}`;
    navigator.clipboard.writeText(url).then(() => {
      addToast("Share link copied to clipboard", "success");
    }).catch(() => {
      addToast("Failed to copy link", "error");
    });
  };

  const statuses = ["Pending", "Approved", "Changes needed"];

  function getBadgeClass(status) {
    switch (status) {
      case "Approved": return "badge badge--approved";
      case "Pending": return "badge badge--pending";
      case "Changes needed": return "badge badge--changes";
      default: return "badge";
    }
  }

  const commentCounts = {
    total: comments.length,
    comments: comments.filter((c) => c.type === "comment").length,
    highlights: comments.filter((c) => c.type === "highlight").length,
    approvals: comments.filter((c) => c.type === "approve").length,
    suggestions: comments.filter((c) => c.type === "suggestion").length,
    resolved: comments.filter((c) => c.resolved).length,
  };

  return (
    <div className="wrap wrap--narrow page-enter">
      <Link href="/" className="back">
        <span className="back-arrow">←</span> Back to projects
      </Link>

      <div className="project-header">
        <div className="project-header-left">
          {editing ? (
            <input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              style={{ fontSize: 28, fontWeight: 800, width: "100%", padding: "4px 8px" }}
            />
          ) : (
            <h1 className="form-title">{project.name}</h1>
          )}
          <a
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
            className="project-url-link"
          >
            {project.url.replace(/^https?:\/\//, "")} ↗
          </a>
          <div className="project-meta-row">
            <span>
              <strong>Reviewer:</strong> {project.reviewerName || "Unassigned"}
            </span>
            <span>
              <strong>Created:</strong> {formatDate(project.createdAt)}
            </span>
            <span className={getBadgeClass(project.status)}>
              {project.status}
            </span>
          </div>
        </div>
      </div>

      <div className="project-actions">
        <Link href={`/project/${id}/editor`} className="btn">
          🖊 Open Editor
        </Link>
        <button className="btn btn--secondary btn--small" onClick={copyShareLink}>
          🔗 Copy Share Link
        </button>
        {editing ? (
          <>
            <button className="btn btn--small" onClick={handleSave}>
              Save Changes
            </button>
            <button
              className="btn btn--secondary btn--small"
              onClick={() => {
                setEditing(false);
                setForm({
                  name: project.name,
                  url: project.url,
                  reviewerName: project.reviewerName,
                  status: project.status,
                  notes: project.notes,
                });
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            className="btn btn--secondary btn--small"
            onClick={() => setEditing(true)}
          >
            ✏️ Edit
          </button>
        )}
        <button
          className="btn btn--danger btn--small"
          onClick={() => setDeleteModal(true)}
        >
          🗑 Delete
        </button>
      </div>

      <hr className="section-divider" />

      {editing && (
        <>
          <div className="url-box">
            <label htmlFor="edit-url">Website URL</label>
            <input
              id="edit-url"
              type="url"
              value={form.url}
              onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
            />
          </div>

          <div className="two-col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="edit-reviewer">Reviewer name</label>
              <input
                id="edit-reviewer"
                value={form.reviewerName}
                onChange={(e) =>
                  setForm((p) => ({ ...p, reviewerName: e.target.value }))
                }
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Status</label>
              <div className="status-row">
                {statuses.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`status-chip${form.status === s ? " active" : ""}`}
                    onClick={() => setForm((p) => ({ ...p, status: s }))}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="field">
            <label htmlFor="edit-notes">Notes</label>
            <textarea
              id="edit-notes"
              rows={4}
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </div>

          <hr className="section-divider" />
        </>
      )}

      {!editing && project.notes && (
        <>
          <div className="field">
            <label>Notes</label>
            <p style={{ fontSize: "14.5px", color: "oklch(0.4 0.01 90)", lineHeight: 1.6 }}>
              {project.notes}
            </p>
          </div>
          <hr className="section-divider" />
        </>
      )}

      <div className="comments-summary">
        <h2>Comments ({commentCounts.total})</h2>
        {commentCounts.total === 0 ? (
          <p style={{ fontSize: "14px", color: "oklch(0.55 0.01 90)" }}>
            No comments yet. Open the editor to start reviewing.
          </p>
        ) : (
          <>
            <div className="comment-summary-item">
              <div className="comment-type-icon">💬</div>
              <div>
                <strong>{commentCounts.comments}</strong> comments
              </div>
            </div>
            <div className="comment-summary-item">
              <div className="comment-type-icon">🔴</div>
              <div>
                <strong>{commentCounts.highlights}</strong> highlights
              </div>
            </div>
            <div className="comment-summary-item">
              <div className="comment-type-icon">✅</div>
              <div>
                <strong>{commentCounts.approvals}</strong> approvals
              </div>
            </div>
            <div className="comment-summary-item">
              <div className="comment-type-icon">✏️</div>
              <div>
                <strong>{commentCounts.suggestions}</strong> edit suggestions
              </div>
            </div>
            <div className="comment-summary-item">
              <div className="comment-type-icon">☑️</div>
              <div>
                <strong>{commentCounts.resolved}</strong> resolved
              </div>
            </div>
          </>
        )}
      </div>

      <Modal
        isOpen={deleteModal}
        onClose={() => setDeleteModal(false)}
        onConfirm={handleDelete}
        title="Delete project?"
        message={`Are you sure you want to delete "${project.name}"? All comments and annotations will be lost.`}
        confirmText="Delete"
        danger
      />
    </div>
  );
}
