"use client";

import { getStoredData, setStoredData, generateId, STORAGE_KEYS } from "./store";

/**
 * Get all comments for a project
 */
export function getCommentsByProject(projectId) {
  const allComments = getStoredData(STORAGE_KEYS.COMMENTS, {});
  return allComments[projectId] || [];
}

/**
 * Save comments for a project
 */
function saveComments(projectId, comments) {
  const allComments = getStoredData(STORAGE_KEYS.COMMENTS, {});
  allComments[projectId] = comments;
  setStoredData(STORAGE_KEYS.COMMENTS, allComments);
}

/**
 * Add a new comment/annotation
 */
export function addComment(projectId, data) {
  const comments = getCommentsByProject(projectId);
  const newComment = {
    id: generateId(),
    projectId,
    type: data.type || "comment", // "comment" | "highlight" | "approve" | "suggestion"
    text: data.text || "",
    author: data.author || "Anonymous",
    position: data.position || null, // { x, y, width?, height? }
    resolved: false,
    replies: [],
    createdAt: Date.now(),
  };
  comments.push(newComment);
  saveComments(projectId, comments);
  return newComment;
}

/**
 * Update a comment
 */
export function updateComment(projectId, commentId, updates) {
  const comments = getCommentsByProject(projectId);
  const idx = comments.findIndex((c) => c.id === commentId);
  if (idx !== -1) {
    comments[idx] = { ...comments[idx], ...updates };
    saveComments(projectId, comments);
    return comments[idx];
  }
  return null;
}

/**
 * Delete a comment
 */
export function deleteComment(projectId, commentId) {
  const comments = getCommentsByProject(projectId).filter(
    (c) => c.id !== commentId
  );
  saveComments(projectId, comments);
}

/**
 * Toggle resolved state of a comment
 */
export function resolveComment(projectId, commentId) {
  const comments = getCommentsByProject(projectId);
  const idx = comments.findIndex((c) => c.id === commentId);
  if (idx !== -1) {
    comments[idx].resolved = !comments[idx].resolved;
    saveComments(projectId, comments);
    return comments[idx];
  }
  return null;
}

/**
 * Add a reply to a comment
 */
export function addReply(projectId, commentId, replyData) {
  const comments = getCommentsByProject(projectId);
  const idx = comments.findIndex((c) => c.id === commentId);
  if (idx !== -1) {
    const reply = {
      id: generateId(),
      text: replyData.text,
      author: replyData.author || "Anonymous",
      createdAt: Date.now(),
    };
    comments[idx].replies.push(reply);
    saveComments(projectId, comments);
    return reply;
  }
  return null;
}

/**
 * Delete all comments for a project
 */
export function deleteAllComments(projectId) {
  const allComments = getStoredData(STORAGE_KEYS.COMMENTS, {});
  delete allComments[projectId];
  setStoredData(STORAGE_KEYS.COMMENTS, allComments);
}
