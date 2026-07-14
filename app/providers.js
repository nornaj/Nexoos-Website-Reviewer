"use client";

import { ProjectsProvider, FoldersProvider, UserProvider } from "@/lib/context";
import { ToastProvider } from "./components/Toast";
import { AuthProvider, useAuth } from "@/lib/auth";
import Navbar from "./components/Navbar";
import LoginPage from "./login/page";
import { usePathname } from "next/navigation";

function AuthGuard({ children }) {
  const { isLoggedIn, loading } = useAuth();
  const pathname = usePathname();

  // Share/review pages skip auth (client-facing)
  if (pathname?.startsWith("/share/") || pathname?.startsWith("/review/")) {
    return children;
  }

  // Show nothing while checking auth
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#111" }}>
        <div className="preview-spinner" />
      </div>
    );
  }

  // Not logged in — show login page
  if (!isLoggedIn) {
    return <LoginPage />;
  }

  return children;
}

export default function Providers({ children }) {
  return (
    <AuthProvider>
      <AuthGuard>
        <UserProvider>
          <FoldersProvider>
            <ProjectsProvider>
              <ToastProvider>
                <Navbar />
                {children}
              </ToastProvider>
            </ProjectsProvider>
          </FoldersProvider>
        </UserProvider>
      </AuthGuard>
    </AuthProvider>
  );
}
