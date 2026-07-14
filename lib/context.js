"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import { getStoredData, setStoredData, STORAGE_KEYS } from "./store";

/* ============================================================
   FOLDERS CONTEXT — Supabase-backed
   ============================================================ */
const FoldersContext = createContext(null);

export function FoldersProvider({ children }) {
  const [folders, setFolders] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function fetchFolders() {
      const { data, error } = await supabase
        .from("folders")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to fetch folders:", error);
        setFolders([]);
      } else {
        setFolders(data || []);
      }
      setLoaded(true);
    }
    fetchFolders();
  }, []);

  const addFolder = useCallback(async (name) => {
    const { data, error } = await supabase
      .from("folders")
      .insert({ name: name || "New Project" })
      .select()
      .single();

    if (error) {
      console.error("Failed to add folder:", error);
      return null;
    }

    setFolders((prev) => [data, ...prev]);
    return data;
  }, []);

  const renameFolder = useCallback(async (id, name) => {
    const { error } = await supabase
      .from("folders")
      .update({ name })
      .eq("id", id);

    if (error) {
      console.error("Failed to rename folder:", error);
      return;
    }

    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
  }, []);

  const deleteFolder = useCallback(async (id) => {
    const { error } = await supabase
      .from("folders")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Failed to delete folder:", error);
      return;
    }

    setFolders((prev) => prev.filter((f) => f.id !== id));
  }, []);

  return (
    <FoldersContext.Provider value={{ folders, loaded, addFolder, renameFolder, deleteFolder }}>
      {children}
    </FoldersContext.Provider>
  );
}

export function useFolders() {
  const ctx = useContext(FoldersContext);
  if (!ctx) throw new Error("useFolders must be used within FoldersProvider");
  return ctx;
}

/* ============================================================
   PROJECTS CONTEXT — Supabase-backed (pages inside folders)
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
    folderId: row.folder_id,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

export function ProjectsProvider({ children }) {
  const [projects, setProjects] = useState([]);
  const [loaded, setLoaded] = useState(false);

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
        name: data.name || "Untitled Page",
        url: data.url || "",
        reviewer_name: data.reviewerName || "",
        status: data.status || "Pending",
        notes: data.notes || "",
        folder_id: data.folderId || null,
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

  const getProjectsByFolder = useCallback(
    (folderId) => projects.filter((p) => p.folderId === folderId),
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
        getProjectsByFolder,
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
   USER CONTEXT — localStorage
   ============================================================ */
const SEED_USER = {
  name: "Nexoos",
  username: "Nexoos",
  email: "",
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
