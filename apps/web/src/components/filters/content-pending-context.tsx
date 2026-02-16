"use client";

import {
  createContext,
  useContext,
  useTransition,
  type TransitionStartFunction,
  type ReactNode,
} from "react";

interface ContentPendingContextValue {
  isPending: boolean;
  startTransition: TransitionStartFunction;
}

const ContentPendingContext = createContext<ContentPendingContextValue | null>(
  null
);

export function ContentPendingProvider({ children }: { children: ReactNode }) {
  const [isPending, startTransition] = useTransition();

  return (
    <ContentPendingContext.Provider value={{ isPending, startTransition }}>
      {children}
    </ContentPendingContext.Provider>
  );
}

export function useContentPending() {
  const context = useContext(ContentPendingContext);
  if (!context) {
    throw new Error(
      "useContentPending must be used within a ContentPendingProvider"
    );
  }
  return context;
}
