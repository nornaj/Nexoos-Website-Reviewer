"use client";

import { ProjectsProvider, UserProvider } from "@/lib/context";
import { ToastProvider } from "./components/Toast";
import Navbar from "./components/Navbar";

export default function Providers({ children }) {
  return (
    <UserProvider>
      <ProjectsProvider>
        <ToastProvider>
          <Navbar />
          {children}
        </ToastProvider>
      </ProjectsProvider>
    </UserProvider>
  );
}
