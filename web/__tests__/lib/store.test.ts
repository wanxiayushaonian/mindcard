import { describe, it, expect, beforeEach } from "vitest";
import { useAuthStore } from "@/lib/store";

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ token: null, isAuthenticated: false });
});

describe("useAuthStore", () => {
  it("starts with null token and false isAuthenticated", () => {
    const { token, isAuthenticated } = useAuthStore.getState();
    expect(token).toBeNull();
    expect(isAuthenticated).toBe(false);
  });

  it("setToken stores token in localStorage", () => {
    useAuthStore.getState().setToken("test-token");
    expect(localStorage.getItem("token")).toBe("test-token");
  });

  it("setToken updates isAuthenticated to true", () => {
    useAuthStore.getState().setToken("test-token");
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it("setToken(null) removes token from localStorage", () => {
    localStorage.setItem("token", "old-token");
    useAuthStore.getState().setToken(null);
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("setToken(null) sets isAuthenticated to false", () => {
    useAuthStore.getState().setToken("token");
    useAuthStore.getState().setToken(null);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it("setToken('') removes token and sets isAuthenticated to false", () => {
    useAuthStore.getState().setToken("");
    expect(localStorage.getItem("token")).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
