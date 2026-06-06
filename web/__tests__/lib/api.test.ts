import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock localStorage
const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { for (const k in store) delete store[k]; }),
};
vi.stubGlobal("localStorage", mockLocalStorage);

// Mock window.location
vi.stubGlobal("window", { location: { href: "" } });

// Must import AFTER mocking fetch/localStorage
const { authApi, workspaceApi, cardApi, chatApi } = await import("@/lib/api");

beforeEach(() => {
  mockFetch.mockReset();
  mockLocalStorage.clear();
  store.token = "test-token";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("API client: auth headers", () => {
  it("sends Authorization header when token exists", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "1", nickname: "test" }),
    });

    await authApi.me();

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers).toHaveProperty("Authorization", "Bearer test-token");
  });

  it("does not send Authorization header when no token", async () => {
    store.token = undefined as any;
    mockLocalStorage.getItem.mockReturnValue(null);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "1" }),
    });

    await authApi.me();

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers).not.toHaveProperty("Authorization");
  });
});

describe("API client: error handling", () => {
  it("throws error on non-OK response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ detail: "参数错误" }),
    });

    await expect(authApi.me()).rejects.toThrow("参数错误");
  });

  it("throws generic error when no detail in response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => { throw new Error("no json"); },
    });

    await expect(authApi.me()).rejects.toThrow("Internal Server Error");
  });
});

describe("API client: URL construction", () => {
  it("constructs correct URL for auth login", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "tok" }),
    });

    await authApi.login("user", "pass");

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/auth/login");
  });

  it("constructs correct URL for workspace get", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "ws-123" }),
    });

    await workspaceApi.get("ws-123");

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/workspaces/ws-123");
  });

  it("constructs correct URL for card list with query params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [], next_cursor: null }),
    });

    await cardApi.list("ws-1", { limit: 10 });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/cards/");
    expect(url).toContain("workspace_id=ws-1");
    expect(url).toContain("limit=10");
  });
});

describe("API client: request body", () => {
  it("sends JSON body for POST requests", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "tok" }),
    });

    await authApi.login("admin", "secret");

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ username: "admin", password: "secret" });
  });

  it("sends PUT for workspace update", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "ws-1", name: "新名字" }),
    });

    await workspaceApi.update("ws-1", { name: "新名字" });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ name: "新名字" });
  });

  it("sends DELETE for workspace delete", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await workspaceApi.delete("ws-1");

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("DELETE");
  });
});

describe("API client: content-type", () => {
  it("sets Content-Type to application/json", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    await authApi.me();

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers).toHaveProperty("Content-Type", "application/json");
  });
});
