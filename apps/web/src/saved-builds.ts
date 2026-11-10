import { PARTS, importAssembly, registerPart } from '@brick-workshop/engine';
import type { Assembly, Part } from '@brick-workshop/engine';

const AUTOSAVE_KEY = 'brick-workshop-current-build-v1';

export interface SavedBuildSummary {
  id: string;
  name: string;
  pieces: number;
  savedAt: string;
}

export interface BuildDocument {
  version: 1;
  assembly: Assembly;
  /** Library parts picked at runtime, so the build reopens without browsing for them again. */
  parts: Part[];
}

export function createBuildDocument(
  assembly: Assembly,
  runtimeParts: readonly Part[],
): BuildDocument {
  const used = new Set(assembly.bricks.map((brick) => brick.partId));
  return { version: 1, assembly, parts: runtimeParts.filter((part) => used.has(part.id)) };
}

/** Registers the document's runtime parts, then validates the assembly like an import. */
export function openBuildDocument(value: unknown): { assembly: Assembly; parts: Part[] } {
  const parts =
    typeof value === 'object' && value !== null && Array.isArray((value as BuildDocument).parts)
      ? (value as BuildDocument).parts
      : [];
  for (const part of parts) registerPart(part);
  return {
    assembly: importAssembly(value),
    parts: parts.filter((part) => !PARTS.some((entry) => entry.id === part.id)),
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error('The workshop server is not reachable.');
  }
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok)
    throw new Error(
      payload?.error ??
        (response.status === 404
          ? 'Saving needs the workshop dev or preview server.'
          : 'Request failed.'),
    );
  return payload as T;
}

export function listSavedBuilds() {
  return request<SavedBuildSummary[]>('/api/builds');
}

export function loadSavedBuild(id: string) {
  return request<unknown>(`/api/builds/${encodeURIComponent(id)}`);
}

/** Saves over `id`, or creates a new file named after the build when `id` is null. */
export function saveBuild(document: BuildDocument, id: string | null) {
  return request<{ id: string; path: string; savedAt: string }>(
    id === null ? '/api/builds' : `/api/builds/${encodeURIComponent(id)}`,
    {
      method: id === null ? 'POST' : 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(document),
    },
  );
}

/** The build from the last session, or null when there is none or it no longer validates. */
export function readAutosave(): {
  assembly: Assembly;
  parts: Part[];
  savedId: string | null;
} | null {
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (!saved) return null;
    const value = JSON.parse(saved) as BuildDocument & { savedId?: unknown };
    return {
      ...openBuildDocument(value),
      savedId: typeof value.savedId === 'string' ? value.savedId : null,
    };
  } catch {
    return null;
  }
}

export function writeAutosave(document: BuildDocument, savedId: string | null) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ ...document, savedId }));
  } catch {
    // Storage is full or blocked; the build then lasts for this session only.
  }
}
