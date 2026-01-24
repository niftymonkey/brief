"use client";

import { type ReactNode } from "react";
import { useLayout } from "./layout-context";
import { LibrarySidebar } from "./library-sidebar";
import { LibraryToolbar } from "./library-toolbar";

interface LibraryShellProps {
  children: ReactNode;
}

export function LibraryShell({ children }: LibraryShellProps) {
  const { mode, mounted } = useLayout();

  // Prevent hydration mismatch by not rendering layout-dependent UI until mounted
  if (!mounted) {
    return (
      <main className="flex-1 px-4 py-4 md:py-6">
        <div className="max-w-5xl mx-auto">{children}</div>
      </main>
    );
  }

  // Compact mode: simple centered layout (current behavior)
  if (mode === "compact") {
    return (
      <main className="flex-1 px-4 py-4 md:py-6">
        <div className="max-w-5xl mx-auto">{children}</div>
      </main>
    );
  }

  // Expanded mode: sidebar + toolbar + full-width content
  return (
    <div className="flex flex-1">
      {/* Desktop sidebar */}
      <LibrarySidebar />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        <LibraryToolbar />

        <main
          className="flex-1 px-4 py-4 md:py-6"
          style={{ transition: "margin var(--sidebar-transition)" }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

