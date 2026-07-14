"use client";

import Link from "next/link";
import { useState, use } from "react";
import { useFolders, useProjects } from "@/lib/context";
import { formatDate } from "@/lib/store";
import { useToast } from "../../../components/Toast";
import Modal from "../../../components/Modal";
import EmptyState from "../../../components/EmptyState";

function getBadgeClass(status) {
  switch (status) {
    case "Approved": return "badge badge--approved";
    case "Pending": return "badge badge--pending";
    case "Changes needed": return "badge badge--changes";
    default: return "badge";
  }
}

const AVATAR_COLORS = [
  ["#d4562a", "#e8734d"],
  ["#2a6fd4", "#4d8be8"],
  ["#2ab86b", "#4dd48e"],
  ["#9b59b6", "#b07cc8"],
  ["#e67e22", "#f0964a"],
  ["#1abc9c", "#48d1b5"],
];

function getAvatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function FolderPage({ params }) {
  const resolvedParams = use(params);
  const folderId = resolvedParams.id;
  const { folders } = useFolders();
  const { projects, loaded, addProject, deleteProject, getProjectsByFolder } = useProjects();
  const { addToast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", reviewerName: "", notes: "" });
  const [deleteModal, setDeleteModal] = useState({ open: false, project: null });

  const folder = folders.find((f) => f.id === folderId);
  const pages = getProjectsByFolder(folderId);

  const handleAddPage = async () => {
    if (!form.url.trim()) return;
    const page = await addProject({
      name: form.name.trim() || form.url.trim(),
      url: form.url.trim().startsWith("http") ? form.url.trim() : `https://${form.url.trim()}`,
      reviewerName: form.reviewerName.trim(),
      notes: form.notes.trim(),
      folderId: folderId,
    });
    if (page) {
      addToast("Page added", "success");
      setShowForm(false);
      setForm({ name: "", url: "", reviewerName: "", notes: "" });
    }
  };

  const handleDelete = (e, project) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteModal({ open: true, project });
  };

  const confirmDelete = async () => {
    if (deleteModal.project) {
      await deleteProject(deleteModal.project.id);
      addToast(`"${deleteModal.project.name}" deleted`, "success");
    }
    setDeleteModal({ open: false, project: null });
  };

  if (!folder) {
    return (
      <div className="wrap page-enter">
        <Link href="/" className="back"><span className="back-arrow">←</span> Back to projects</Link>
        <h1 className="form-title">Folder not found</h1>
      </div>
    );
  }

  return (
    <div className="wrap page-enter">
      <Link href="/" className="back"><span className="back-arrow">←</span> Back to projects</Link>

      <div className="top">
        <div>
          <div className="eyebrow">Project</div>
          <h1>{folder.name}</h1>
        </div>
        <button className="btn" onClick={() => setShowForm(!showForm)}>
          <span className="btn-icon">+</span> Add a Page
        </button>
      </div>

      {/* Add page form */}
      {showForm && (
        <div className="add-page-form">
          <div className="field">
            <label htmlFor="page-name">Page Name</label>
            <input
              id="page-name"
              placeholder="e.g. Homepage, About, Contact"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="page-url">Website URL *</label>
            <input
              id="page-url"
              placeholder="https://example.com"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="page-reviewer">Reviewer Name</label>
            <input
              id="page-reviewer"
              placeholder="Who is reviewing this?"
              value={form.reviewerName}
              onChange={(e) => setForm({ ...form, reviewerName: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="page-notes">Notes</label>
            <textarea
              id="page-notes"
              placeholder="Any additional notes…"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
            />
          </div>
          <div className="add-page-actions">
            <button className="btn btn--secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn" onClick={handleAddPage} disabled={!form.url.trim()}>Add Page</button>
          </div>
        </div>
      )}

      {/* Pages list */}
      {pages.length === 0 && !showForm ? (
        <EmptyState
          icon="📄"
          title="No pages yet"
          description="Add a page to start reviewing."
          ctaText="+ Add a Page"
          onCtaClick={() => setShowForm(true)}
        />
      ) : (
        <div className="grid">
          {pages.map((project) => (
            <Link
              key={project.id}
              href={`/project/${project.id}`}
              className="card"
            >
              <button
                className="card-delete"
                onClick={(e) => handleDelete(e, project)}
                title="Delete page"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
              <div className="card-thumb">
                <div
                  className="card-thumb-fallback"
                  style={{
                    display: "flex",
                    background: `linear-gradient(135deg, ${getAvatarColor(project.name)[0]}, ${getAvatarColor(project.name)[1]})`,
                  }}
                >
                  <span className="card-thumb-letter">{project.name.charAt(0).toUpperCase()}</span>
                </div>
              </div>
              <div className="card-body">
                <div className="card-row">
                  <div className="card-name">{project.name}</div>
                  <span className={getBadgeClass(project.status)}>
                    {project.status}
                  </span>
                </div>
                <div className="card-url">
                  {project.url ? project.url.replace(/^https?:\/\//, "") : "No URL"}
                </div>
                <div className="card-meta">
                  <span>{project.reviewerName || "Unassigned"}</span>
                  <span>{formatDate(project.createdAt)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, project: null })}
        onConfirm={confirmDelete}
        title="Delete page?"
        message={`Are you sure you want to delete "${deleteModal.project?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        danger
      />
    </div>
  );
}
