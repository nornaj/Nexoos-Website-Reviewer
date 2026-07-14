"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { useFolders } from "@/lib/context";
import { useToast } from "./components/Toast";
import Modal from "./components/Modal";
import EmptyState from "./components/EmptyState";

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

function FolderCard({ folder, onDelete, onRename }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(folder.name);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleRename = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== folder.name) {
      onRename(folder.id, trimmed);
    } else {
      setName(folder.name);
    }
    setEditing(false);
  };

  const colors = getAvatarColor(folder.name);

  return (
    <Link href={`/folder/${folder.id}`} className="folder-card">
      <button
        className="card-delete"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(folder); }}
        title="Delete folder"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>

      <div className="folder-card-avatar">
        <span className="folder-card-letter">{folder.name.charAt(0).toUpperCase()}</span>
      </div>

      {editing ? (
        <input
          ref={inputRef}
          className="folder-card-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleRename}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
            if (e.key === "Escape") { setName(folder.name); setEditing(false); }
          }}
        />
      ) : (
        <div
          className="folder-card-name"
          onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(true); }}
          title="Double-click to rename"
        >
          {folder.name}
        </div>
      )}
    </Link>
  );
}

export default function HomePage() {
  const { folders, loaded, addFolder, renameFolder, deleteFolder } = useFolders();
  const { addToast } = useToast();
  const [deleteModal, setDeleteModal] = useState({ open: false, folder: null });

  const handleCreate = async () => {
    const folder = await addFolder("New Project");
    if (folder) addToast("Project folder created", "success");
  };

  const handleDelete = (folder) => {
    setDeleteModal({ open: true, folder });
  };

  const confirmDelete = async () => {
    if (deleteModal.folder) {
      await deleteFolder(deleteModal.folder.id);
      addToast(`"${deleteModal.folder.name}" deleted`, "success");
    }
    setDeleteModal({ open: false, folder: null });
  };

  const handleRename = async (id, name) => {
    await renameFolder(id, name);
    addToast("Folder renamed", "success");
  };

  if (!loaded) {
    return (
      <div className="wrap page-enter">
        <div className="top">
          <div>
            <div className="eyebrow">Nexoos</div>
            <h1>Projects</h1>
          </div>
        </div>
        <div className="folder-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="folder-card">
              <div className="folder-card-avatar skeleton" />
              <div className="skeleton" style={{ height: 16, width: "60%", marginTop: 10 }} />
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
          <h1>Projects</h1>
        </div>
        <button className="btn" onClick={handleCreate}>
          <span className="btn-icon">+</span> Review a Project
        </button>
      </div>

      {folders.length === 0 ? (
        <EmptyState
          icon="📁"
          title="No projects yet"
          description="Create your first project folder to start reviewing websites."
          ctaText="+ Review a Project"
          onCtaClick={handleCreate}
        />
      ) : (
        <div className="folder-grid">
          {folders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              onDelete={handleDelete}
              onRename={handleRename}
            />
          ))}
        </div>
      )}

      <Modal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, folder: null })}
        onConfirm={confirmDelete}
        title="Delete project?"
        message={`Are you sure you want to delete "${deleteModal.folder?.name}"? All pages inside will be deleted too.`}
        confirmText="Delete"
        danger
      />
    </div>
  );
}
