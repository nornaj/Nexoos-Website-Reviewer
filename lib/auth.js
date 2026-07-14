"use client";

import { createContext, useContext, useState, useEffect } from "react";

const AuthContext = createContext(null);

const CREDENTIALS = {
  username: "Nexoos",
  password: "LCCbeforeAUA",
};

export function AuthProvider({ children }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("nexoos_auth");
    if (stored === "true") setIsLoggedIn(true);
    setLoading(false);
  }, []);

  const login = (username, password) => {
    if (username === CREDENTIALS.username && password === CREDENTIALS.password) {
      localStorage.setItem("nexoos_auth", "true");
      setIsLoggedIn(true);
      return true;
    }
    return false;
  };

  const logout = () => {
    localStorage.removeItem("nexoos_auth");
    setIsLoggedIn(false);
  };

  return (
    <AuthContext.Provider value={{ isLoggedIn, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
