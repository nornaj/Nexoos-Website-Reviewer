"use client";

import { useParams } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { useProjects } from "@/lib/context";
import { useToast } from "@/app/components/Toast";
import {
  getCommentsByProject,
  addComment,
  resolveComment,
  addReply,
} from "@/lib/annotations";
import EditorToolbar from "@/app/components/EditorToolbar";
import WebsitePreview from "@/app/components/WebsitePreview";
import CommentsSidebar from "@/app/components/CommentsSidebar";
import AnnotationPopup from "@/app/components/AnnotationPopup";

export default function PublicReviewPage() {
  const { token } = useParams();
  const { getProjectByToken } = useProjects();
  const { addToast } = useToast();

  const project = getProjectByToken(token);

  const [activeTool, setActiveTool] = useState("select");
  const [zoom, setZoom] = useState(100);
  const [comments, setComments] = useState([]);
  const [activeCommentId, setActiveCommentId] = useState(null);
  const [guestName, setGuestName] = useState("");
  const [popup, setPopup] = useState({ open: false, type: null, position: null, annotationData: null });

  useEffect(() => {
    if (project) {
      getCommentsByProject(project.id).then(setComments);
    }
  }, [project]);

  const refreshComments = useCallback(async () => {
    if (project) {
      const data = await getCommentsByProject(project.id);
      setComments(data);
    }
  }, [project]);

  const authorName = guestName.trim() || "Guest";

  const handleAnnotationAdd = useCallback(
    (data) => {
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
    async (text) => {
      if (!popup.annotationData) return;

      const isRequired = popup.type === "comment" || popup.type === "suggestion";
      if (isRequired && !text) {
        setPopup({ open: false, type: null, position: null, annotationData: null });
        return;
      }

      await addComment(project.id, {
        type: popup.type,
        text: text || "",
        author: authorName,
        position: popup.annotationData.position,
      });

      await refreshComments();
      setActiveTool("select");
      setPopup({ open: false, type: null, position: null, annotationData: null });
    },
    [popup, project, authorName, refreshComments]
  );

  const handlePopupCancel = useCallback(() => {
    setPopup({ open: false, type: null, position: null, annotationData: null });
  }, []);

  const handleAddGeneralComment = useCallback(
    async (text) => {
      await addComment(project.id, {
        type: "comment",
        text,
        author: authorName,
        position: null,
      });
      await refreshComments();
    },
    [project, authorName, refreshComments]
  );

  const handleResolve = useCallback(
    async (commentId) => {
      await resolveComment(project.id, commentId);
      await refreshComments();
    },
    [project, refreshComments]
  );

  const handleReply = useCallback(
    async (commentId, text) => {
      await addReply(project.id, commentId, {
        text,
        author: authorName,
      });
      await refreshComments();
    },
    [project, authorName, refreshComments]
  );

  const handleShare = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      addToast("Review link copied!", "success");
    }).catch(() => {
      addToast("Failed to copy link", "error");
    });
  }, [addToast]);

  const handlePinClick = useCallback((commentId) => {
    setActiveCommentId((prev) => (prev === commentId ? null : commentId));
  }, []);

  if (!project) {
    return (
      <div className="editor-layout">
        <div className="preview-fallback">
          <div className="preview-fallback-icon">🔗</div>
          <div className="preview-fallback-text">
            This review link is invalid or has expired.
          </div>
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
        isGuest
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
          onDelete={() => {}}
          onReply={handleReply}
          isGuest
        />

        <CommentsSidebar
          comments={comments}
          activeCommentId={activeCommentId}
          onCommentClick={handlePinClick}
          onResolve={handleResolve}
          onDelete={() => {}}
          onReply={handleReply}
          onAddComment={handleAddGeneralComment}
          isGuest
          guestName={guestName}
          onGuestNameChange={setGuestName}
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
