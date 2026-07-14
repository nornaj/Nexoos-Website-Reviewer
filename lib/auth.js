"use client";

import { createContext, useContext, useState, useEffect } from "react";

const AuthContext = createContext(null);

const DEFAULT_CREDENTIALS = {
  name: "Nexoos Group",
  username: "NexoosGroup",
  email: "najaryannorayr209@gmail.com",
  password: "Ananan05071998",
};

function getStoredCredentials() {
  if (typeof window === "undefined") return DEFAULT_CREDENTIALS;
  const stored = localStorage.getItem("nexoos_credentials");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {}
  }
  return DEFAULT_CREDENTIALS;
}

export function AuthProvider({ children }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [credentials, setCredentials] = useState(DEFAULT_CREDENTIALS);

  useEffect(() => {
    const stored = localStorage.getItem("nexoos_auth");
    if (stored === "true") {
      setIsLoggedIn(true);
    }
    setCredentials(getStoredCredentials());
    setLoading(false);
  }, []);

  const login = (username, password) => {
    const creds = getStoredCredentials();
    if (username === creds.username && password === creds.password) {
      localStorage.setItem("nexoos_auth", "true");
      localStorage.setItem("nexoos_user", username);
      setIsLoggedIn(true);
      return true;
    }
    return false;
  };

  const logout = () => {
    localStorage.removeItem("nexoos_auth");
    localStorage.removeItem("nexoos_user");
    setIsLoggedIn(false);
  };

  const updateCredentials = (updates) => {
    const newCreds = { ...credentials, ...updates };
    setCredentials(newCreds);
    localStorage.setItem("nexoos_credentials", JSON.stringify(newCreds));
  };

  return (
    <AuthContext.Provider value={{
      isLoggedIn,
      loading,
      login,
      logout,
      credentials,
      updateCredentials,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
