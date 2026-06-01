/**
 * Unified WebSocket Client for AI Chat Streaming
 *
 * Inspired by DeepTutor's WebSocket architecture.
 * Provides reliable streaming with auto-reconnect and heartbeat.
 */

// ---- Event types ----

export type StreamEventType =
  | "content"
  | "sources"
  | "web_search_results"
  | "done"
  | "error"
  | "cancelled"
  | "pong";

export interface StreamEvent {
  type: StreamEventType;
  content?: string;
  results?: any[];
  source_cards?: any[];
  metadata?: Record<string, unknown>;
}

// ---- Client message types ----

export interface ChatMessage {
  type: "chat";
  message: string;
  history?: Array<{ role: string; content: string }>;
  web_search?: boolean;
}

export interface RAGMessage {
  type: "rag";
  question: string;
  workspace_ids?: string[];
  card_id?: string;
  top_k?: number;
  web_search?: boolean;
  history?: Array<{ role: string; content: string }>;
}

export interface CancelMessage {
  type: "cancel";
}

export interface PingMessage {
  type: "ping";
}

export type WSMessage = ChatMessage | RAGMessage | CancelMessage | PingMessage;

// ---- Connection manager ----

export type EventHandler = (event: StreamEvent) => void;

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY_MS = 200;

export class UnifiedWSClient {
  private ws: WebSocket | null = null;
  private onEvent: EventHandler;
  private onClose?: () => void;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastReceivedAt = 0;

  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  private wsUrl: string;

  constructor(wsUrl: string, onEvent: EventHandler, onClose?: () => void) {
    this.wsUrl = wsUrl;
    this.onEvent = onEvent;
    this.onClose = onClose;
  }

  connect(): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.intentionalClose = false;

    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      console.log("WebSocket connected");
      this.reconnectAttempt = 0;
      this.lastReceivedAt = Date.now();
      this.startHeartbeat();
    };

    this.ws.onmessage = (ev) => {
      this.lastReceivedAt = Date.now();
      try {
        const event: StreamEvent = JSON.parse(ev.data);
        this.onEvent(event);
      } catch (e) {
        console.warn("Unparseable WS message:", ev.data);
      }
    };

    this.ws.onclose = () => {
      console.log("WebSocket closed");
      this.ws = null;
      this.stopHeartbeat();
      if (!this.intentionalClose) {
        this.attemptReconnect();
      } else {
        this.onClose?.();
      }
    };

    this.ws.onerror = (err) => {
      console.error("WS error:", err);
    };
  }

  send(msg: WSMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("WebSocket not connected");
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.stopHeartbeat();
    this.clearReconnectTimer();
    this.ws?.close();
    this.ws = null;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ---- Heartbeat ----

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      if (Date.now() - this.lastReceivedAt > HEARTBEAT_TIMEOUT_MS) {
        console.warn("Heartbeat timeout, closing connection");
        this.ws.close();
        return;
      }

      try {
        this.ws.send(JSON.stringify({ type: "ping" }));
      } catch {
        // send may fail if socket is closing
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ---- Reconnect ----

  private attemptReconnect(): void {
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      console.error("Max reconnect attempts reached");
      this.onClose?.();
      return;
    }

    const delay = BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempt);
    this.reconnectAttempt += 1;

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

/**
 * Create WebSocket URL from API base URL
 */
export function createWSUrl(path: string): string {
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

  // Convert http(s) to ws(s)
  const wsBase = API_BASE.replace(/^http/, "ws");
  const url = new URL(path, wsBase);

  if (token) {
    url.searchParams.set("token", token);
  }

  return url.toString();
}
