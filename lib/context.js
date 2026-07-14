"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import { getStoredData, setStoredData, STORAGE_KEYS } from "./store";

/* ============================================================
   PROJECTS CONTEXT — Supabase-backed
   ============================================================ */
const ProjectsContext = createContext(null);

function mapProject(row) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    reviewerName: row.reviewer_name,
    status: row.status,
    notes: row.notes,
    shareToken: row.share_token,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

export function ProjectsProvider({ children }) {
  const [projects, setProjects] = useState([]);
  const [loaded, setLoaded] = useState(false);

  // Load from Supabase on mount
  useEffect(() => {
    async function fetchProjects() {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to fetch projects:", error);
        setProjects([]);
      } else {
        setProjects((data || []).map(mapProject));
      }
      setLoaded(true);
    }
    fetchProjects();
  }, []);

  const addProject = useCallback(async (data) => {
    const { data: inserted, error } = await supabase
      .from("projects")
      .insert({
        name: data.name || "Untitled Project",
        url: data.url || "",
        reviewer_name: data.reviewerName || "",
        status: data.status || "Pending",
        notes: data.notes || "",
      })
      .select()
      .single();

    if (error) {
      console.error("Failed to add project:", error);
      return null;
    }

    const mapped = mapProject(inserted);
    setProjects((prev) => [mapped, ...prev]);
    return mapped;
  }, []);

  const updateProject = useCallback(async (id, updates) => {
    const dbUpdates = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.url !== undefined) dbUpdates.url = updates.url;
    if (updates.reviewerName !== undefined) dbUpdates.reviewer_name = updates.reviewerName;
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
    dbUpdates.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from("projects")
      .update(dbUpdates)
      .eq("id", id);

    if (error) {
      console.error("Failed to update project:", error);
      return;
    }

    setProjects((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
      )
    );
  }, []);

  const deleteProject = useCallback(async (id) => {
    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Failed to delete project:", error);
      return;
    }

    setProjects((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const getProjectById = useCallback(
    (id) => projects.find((p) => p.id === id) || null,
    [projects]
  );

  const getProjectByToken = useCallback(
    (token) => projects.find((p) => p.shareToken === token) || null,
    [projects]
  );

  return (
    <ProjectsContext.Provider
      value={{
        projects,
        loaded,
        addProject,
        updateProject,
        deleteProject,
        getProjectById,
        getProjectByToken,
      }}
    >
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects() {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error("useProjects must be used within ProjectsProvider");
  return ctx;
}

/* ============================================================
   USER CONTEXT — still localStorage (no auth yet)
   ============================================================ */
const SEED_USER = {
  name: "Review Admin",
  username: "admin",
  email: "admin@nexoos.com",
  password: "",
};

const UserContext = createContext(null);

export function UserProvider({ children }) {
  const [user, setUser] = useState(SEED_USER);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const stored = getStoredData(STORAGE_KEYS.USER);
    if (stored) {
      setUser(stored);
    } else {
      setStoredData(STORAGE_KEYS.USER, SEED_USER);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) {
      setStoredData(STORAGE_KEYS.USER, user);
    }
  }, [user, loaded]);

  const updateUser = useCallback((updates) => {
    setUser((prev) => ({ ...prev, ...updates }));
  }, []);

  return (
    <UserContext.Provider value={{ user, loaded, updateUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within UserProvider");
  return ctx;
}
