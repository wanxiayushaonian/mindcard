import { create } from "zustand";

interface AuthState {
  token: string | null;
  setToken: (token: string | null) => void;
  isAuthenticated: boolean;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: typeof window !== "undefined" ? localStorage.getItem("token") : null,
  setToken: (token) => {
    if (token) {
      localStorage.setItem("token", token);
    } else {
      localStorage.removeItem("token");
    }
    set({ token, isAuthenticated: !!token });
  },
  isAuthenticated: typeof window !== "undefined" ? !!localStorage.getItem("token") : false,
}));

interface AppState {
  currentWorkspaceId: string | null;
  setCurrentWorkspace: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentWorkspaceId: null,
  setCurrentWorkspace: (id) => set({ currentWorkspaceId: id }),
}));
