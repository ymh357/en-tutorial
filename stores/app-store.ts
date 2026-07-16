import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppState {
  isOnboarded: boolean;
  sidebarOpen: boolean;
  setOnboarded: (v: boolean) => void;
  setSidebarOpen: (v: boolean) => void;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      isOnboarded: false,
      sidebarOpen: true,
      setOnboarded: (v) => set({ isOnboarded: v }),
      setSidebarOpen: (v) => set({ sidebarOpen: v }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    }),
    {
      name: "en-tutor-app",
    }
  )
);
