/** localStorage-based draft persistence for synthesis page. */

export interface SynthesisDraft {
  content: string;
  mode: string;
  templateId?: string;
  sourceCardIds: string[];
  sourceCardTimestamps: Record<string, string>; // cardId → updated_at
  savedAt: number; // Date.now()
}

const KEY_PREFIX = "mindcard-synthesis-draft-";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function getDraftKey(workspaceId: string, topicId?: string, nodeId?: string): string {
  const suffix = topicId ? `topic-${topicId}` : nodeId ? `node-${nodeId}` : "unknown";
  return `${KEY_PREFIX}${workspaceId}-${suffix}`;
}

export function loadDraft(key: string): SynthesisDraft | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as SynthesisDraft;
  } catch {
    return null;
  }
}

export function saveDraft(key: string, draft: SynthesisDraft): boolean {
  if (!isBrowser()) return false;
  try {
    localStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false; // quota exceeded
  }
}

export function clearDraft(key: string): void {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
