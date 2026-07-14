"use client";

import { supabase } from "./supabase";

/**
 * Get all comments for a project (with replies)
 */
export async function getCommentsByProject(projectId, viewMode = null) {
  let query = supabase
    .from("comments")
    .select("*, replies(*)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  // Filter by view mode if specified
  if (viewMode) {
    query = query.eq("view_mode", viewMode);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Failed to fetch comments:", error);
    return [];
  }

  // Sort replies by created_at within each comment
  return (data || []).map((c) => ({
    ...c,
    id: c.id,
    projectId: c.project_id,
    type: c.type,
    text: c.text,
    author: c.author,
    position: c.position,
    resolved: c.resolved,
    createdAt: new Date(c.created_at).getTime(),
    replies: (c.replies || [])
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((r) => ({
        id: r.id,
        text: r.text,
        author: r.author,
        createdAt: new Date(r.created_at).getTime(),
      })),
  }));
}

/**
 * Add a new comment/annotation
 */
export async function addComment(projectId, data) {
  const { data: inserted, error } = await supabase
    .from("comments")
    .insert({
      project_id: projectId,
      type: data.type || "comment",
      text: data.text || "",
      author: data.author || "Anonymous",
      position: data.position || null,
      resolved: false,
      view_mode: data.view_mode || "desktop",
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to add comment:", error);
    return null;
  }
  return inserted;
}

/**
 * Update a comment
 */
export async function updateComment(projectId, commentId, updates) {
  const { error } = await supabase
    .from("comments")
    .update(updates)
    .eq("id", commentId);

  if (error) console.error("Failed to update comment:", error);
}

/**
 * Delete a comment
 */
export async function deleteComment(projectId, commentId) {
  const { error } = await supabase
    .from("comments")
    .delete()
    .eq("id", commentId);

  if (error) console.error("Failed to delete comment:", error);
}

/**
 * Toggle resolved state of a comment
 */
export async function resolveComment(projectId, commentId) {
  // First get current state
  const { data: comment } = await supabase
    .from("comments")
    .select("resolved")
    .eq("id", commentId)
    .single();

  if (!comment) return null;

  const { error } = await supabase
    .from("comments")
    .update({ resolved: !comment.resolved })
    .eq("id", commentId);

  if (error) console.error("Failed to resolve comment:", error);
}

/**
 * Add a reply to a comment
 */
export async function addReply(projectId, commentId, replyData) {
  const { data: inserted, error } = await supabase
    .from("replies")
    .insert({
      comment_id: commentId,
      text: replyData.text,
      author: replyData.author || "Anonymous",
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to add reply:", error);
    return null;
  }
  return inserted;
}

/**
 * Delete all comments for a project
 */
export async function deleteAllComments(projectId) {
  const { error } = await supabase
    .from("comments")
    .delete()
    .eq("project_id", projectId);

  if (error) console.error("Failed to delete all comments:", error);
}
