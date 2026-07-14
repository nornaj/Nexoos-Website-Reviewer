"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getStoredData, setStoredData, generateId, STORAGE_KEYS } from "./store";

/* ============================================================
   SEED DATA — shown on first visit, removed once user interacts
   ============================================================ */
const SEED_PROJECTS = [
  {
    id: "seed-1",
    name: "Acme Corp Site",
    url: "https://acme.com/copy",
    reviewerName: "R. Diaz",
    status: "Approved",
    notes: "",
    shareToken: "demo-token-acme",
    createdAt: new Date("2026-07-10").getTime(),
    updatedAt: new Date("2026-07-10").getTime(),
  },
  {
    id: "seed-2",
    name: "Nova Landing",
    url: "https://novaapp.io",
    reviewerName: "J. Lee",
    status: "Pending",
    notes: "",
    shareToken: "demo-token-nova",
    createdAt: new Date("2026-07-08").getTime(),
    updatedAt: new Date("2026-07-08").getTime(),
  },
  {
    id: "seed-3",
    name: "Farmstand Co",
    url: "https://farmstand.shop",
    reviewerName: "R. Diaz",
    status: "Changes needed",
    notes: "",
    shareToken: "demo-token-farm",
    createdAt: new Date("2026-07-02").getTime(),
    updatedAt: new Date("2026-07-02").getTime(),
  },
  {
    id: "seed-4",
    name: "Bluepeak Careers",
    url: "https://bluepeak.com/careers",
    reviewerName: "M. Ortiz",
    status: "Approved",
    notes: "",
    shareToken: "demo-token-blue",
    createdAt: new Date("2026-06-28").getTime(),
    updatedAt: new Date("2026-06-28").getTime(),
  },
];

const SEED_USER = {
  name: "Review Admin",
  username: "admin",
  email: "admin@nexoos.com",
  password: "",
};

/* ============================================================
   PROJECTS CONTEXT
   ============================================================ */
const ProjectsContext = createContext(null);

export function ProjectsProvider({ children }) {
  const [projects, setProjects] = useState([]);
  const [loaded, setLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = getStoredData(STORAGE_KEYS.PROJECTS);
    if (stored && stored.length > 0) {
      setProjects(stored);
    } else {
      setProjects(SEED_PROJECTS);
      setStoredData(STORAGE_KEYS.PROJECTS, SEED_PROJECTS);
    }
    setLoaded(true);
  }, []);

  // Persist to localStorage on every change
  useEffect(() => {
    if (loaded) {
      setStoredData(STORAGE_KEYS.PROJECTS, projects);
    }
  }, [projects, loaded]);

  const addProject = useCallback((data) => {
    const now = Date.now();
    const newProject = {
      id: generateId(),
      name: data.name || "Untitled Project",
      url: data.url || "",
      reviewerName: data.reviewerName || "",
      status: data.status || "Pending",
      notes: data.notes || "",
      shareToken: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    setProjects((prev) => [newProject, ...prev]);
    return newProject;
  }, []);

  const updateProject = useCallback((id, updates) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
      )
    );
  }, []);

  const deleteProject = useCallback((id) => {
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
   USER CONTEXT
   ============================================================ */
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
