"use client";

import Link from "next/link";
import { useState } from "react";
import { useProjects } from "@/lib/context";
import { formatDate } from "@/lib/store";
import { useToast } from "./components/Toast";
import Modal from "./components/Modal";
import EmptyState from "./components/EmptyState";

function getBadgeClass(status) {
  switch (status) {
    case "Approved":
      return "badge badge--approved";
    case "Pending":
      return "badge badge--pending";
    case "Changes needed":
      return "badge badge--changes";
    default:
      return "badge";
  }
}

function getDomain(url) {
  try {
    const cleanUrl = url.startsWith("http") ? url : `https://${url}`;
    return new URL(cleanUrl).hostname.replace("www.", "");
  } catch {
    return url;
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

export default function HomePage() {
  const { projects, loaded, deleteProject } = useProjects();
  const { addToast } = useToast();
  const [deleteModal, setDeleteModal] = useState({ open: false, project: null });

  const handleDelete = (e, project) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteModal({ open: true, project });
  };

  const confirmDelete = () => {
    if (deleteModal.project) {
      deleteProject(deleteModal.project.id);
      addToast(`"${deleteModal.project.name}" deleted`, "success");
    }
    setDeleteModal({ open: false, project: null });
  };

  if (!loaded) {
    return (
      <div className="wrap page-enter">
        <div className="top">
          <div>
            <div className="eyebrow">Nexoos</div>
            <h1>Recent Projects</h1>
          </div>
        </div>
        <div className="grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card">
              <div className="card-thumb skeleton" style={{ height: 120 }} />
              <div className="card-body">
                <div className="skeleton" style={{ height: 20, width: "60%", marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 14, width: "40%", marginBottom: 10 }} />
                <div className="skeleton" style={{ height: 12, width: "80%" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="wrap page-enter">
      <div className="top">
        <div>
          <div className="eyebrow">Nexoos</div>
          <h1>Recent Projects</h1>
        </div>
        <Link href="/review-form" className="btn">
          <span className="btn-icon">+</span> Review a Project
        </Link>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon="📋"
          title="No projects yet"
          description="Create your first review to start collaborating on website copy."
          ctaText="+ Review a Project"
          ctaHref="/review-form"
        />
      ) : (
        <div className="grid">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/project/${project.id}`}
              className="card"
            >
              <button
                className="card-delete"
                onClick={(e) => handleDelete(e, project)}
                title="Delete project"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
              <div className="card-thumb">
                {project.url ? (
                  <img
                    src={`/api/screenshot?url=${encodeURIComponent(project.url)}`}
                    alt={`${project.name} screenshot`}
                    onError={(e) => {
                      e.target.style.display = "none";
                      e.target.nextSibling.style.display = "flex";
                    }}
                  />
                ) : null}
                <div
                  className="card-thumb-fallback"
                  style={{
                    display: project.url ? "none" : "flex",
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
                  {project.url
                    ? project.url.replace(/^https?:\/\//, "")
                    : "No URL"}
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
        title="Delete project?"
        message={`Are you sure you want to delete "${deleteModal.project?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        danger
      />
    </div>
  );
}
