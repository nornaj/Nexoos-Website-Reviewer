"use client";

import { useParams } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { useProjects } from "@/lib/context";
import { useUser } from "@/lib/context";
import { useToast } from "@/app/components/Toast";
import {
  getCommentsByProject,
  addComment,
  deleteComment,
  resolveComment,
  addReply,
} from "@/lib/annotations";
import EditorToolbar from "@/app/components/EditorToolbar";
import WebsitePreview from "@/app/components/WebsitePreview";
import CommentsSidebar from "@/app/components/CommentsSidebar";
import AnnotationPopup from "@/app/components/AnnotationPopup";

export default function EditorPage() {
  const { id } = useParams();
  const { getProjectById } = useProjects();
  const { user } = useUser();
  const { addToast } = useToast();

  const project = getProjectById(id);

  const [activeTool, setActiveTool] = useState("select");
  const [zoom, setZoom] = useState(100);
  const [comments, setComments] = useState([]);
  const [activeCommentId, setActiveCommentId] = useState(null);
  const [popup, setPopup] = useState({ open: false, type: null, position: null, annotationData: null });

  // Load comments
  useEffect(() => {
    if (project) {
      setComments(getCommentsByProject(project.id));
    }
  }, [project]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (popup.open) return;

      switch (e.key.toLowerCase()) {
        case "escape":
          setActiveTool("select");
          break;
        case "c":
          setActiveTool("comment");
          break;
        case "h":
          setActiveTool("highlight");
          break;
        case "a":
          setActiveTool("approve");
          break;
        case "s":
          if (!e.ctrlKey && !e.metaKey) {
            setActiveTool("suggestion");
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [popup.open]);

  const refreshComments = useCallback(() => {
    if (project) {
      setComments(getCommentsByProject(project.id));
    }
  }, [project]);

  const handleAnnotationAdd = useCallback(
    (data) => {
      // Open custom popup instead of browser prompt
      setPopup({
        open: true,
        type: data.type,
        position: { clientX: data.clientX, clientY: data.clientY },
        annotationData: data,
      });
    },
    []
  );

  const handlePopupSubmit = useCallback(
    (text) => {
      if (!popup.annotationData) return;

      const isRequired = popup.type === "comment" || popup.type === "suggestion";
      if (isRequired && !text) {
        setPopup({ open: false, type: null, position: null, annotationData: null });
        return;
      }

      addComment(project.id, {
        type: popup.type,
        text: text || "",
        author: user?.name || "Reviewer",
        position: popup.annotationData.position,
      });

      refreshComments();
      setActiveTool("select");
      setPopup({ open: false, type: null, position: null, annotationData: null });
    },
    [popup, project, user, refreshComments]
  );

  const handlePopupCancel = useCallback(() => {
    setPopup({ open: false, type: null, position: null, annotationData: null });
  }, []);

  const handleAddGeneralComment = useCallback(
    (text) => {
      addComment(project.id, {
        type: "comment",
        text,
        author: user?.name || "Reviewer",
        position: null,
      });
      refreshComments();
    },
    [project, user, refreshComments]
  );

  const handleResolve = useCallback(
    (commentId) => {
      resolveComment(project.id, commentId);
      refreshComments();
    },
    [project, refreshComments]
  );

  const handleDelete = useCallback(
    (commentId) => {
      deleteComment(project.id, commentId);
      refreshComments();
      if (activeCommentId === commentId) setActiveCommentId(null);
    },
    [project, activeCommentId, refreshComments]
  );

  const handleReply = useCallback(
    (commentId, text) => {
      addReply(project.id, commentId, {
        text,
        author: user?.name || "Reviewer",
      });
      refreshComments();
    },
    [project, user, refreshComments]
  );

  const handleShare = useCallback(() => {
    const url = `${window.location.origin}/review/${project.shareToken}`;
    navigator.clipboard.writeText(url).then(() => {
      addToast("Share link copied!", "success");
    }).catch(() => {
      addToast("Failed to copy link", "error");
    });
  }, [project, addToast]);

  const handlePinClick = useCallback((commentId) => {
    setActiveCommentId((prev) => (prev === commentId ? null : commentId));
  }, []);

  if (!project) {
    return (
      <div className="editor-layout">
        <div className="preview-fallback">
          <div className="preview-fallback-icon">🔍</div>
          <div className="preview-fallback-text">Project not found</div>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-layout">
      <EditorToolbar
        projectId={project.id}
        projectName={project.name}
        activeTool={activeTool}
        onToolChange={setActiveTool}
        zoom={zoom}
        onZoomChange={setZoom}
        onShare={handleShare}
      />

      <div className="editor-body">
        <WebsitePreview
          url={project.url}
          zoom={zoom}
          activeTool={activeTool}
          annotations={comments.filter((c) => c.position)}
          onAnnotationAdd={handleAnnotationAdd}
          activeCommentId={activeCommentId}
          onPinClick={handlePinClick}
          onResolve={handleResolve}
          onDelete={handleDelete}
          onReply={handleReply}
        />

        <CommentsSidebar
          comments={comments}
          activeCommentId={activeCommentId}
          onCommentClick={handlePinClick}
          onResolve={handleResolve}
          onDelete={handleDelete}
          onReply={handleReply}
          onAddComment={handleAddGeneralComment}
        />
      </div>

      <AnnotationPopup
        isOpen={popup.open}
        position={popup.position}
        type={popup.type}
        onSubmit={handlePopupSubmit}
        onCancel={handlePopupCancel}
        required={popup.type === "comment" || popup.type === "suggestion"}
      />
    </div>
  );
}
