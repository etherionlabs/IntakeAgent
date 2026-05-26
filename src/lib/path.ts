export function getByPath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function setByPath<T extends Record<string, unknown>>(
  obj: T,
  path: string,
  value: unknown,
): T {
  const parts = path.split('.');
  const clone = structuredClone(obj);
  let cur: Record<string, unknown> = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (
      cur[key] == null ||
      typeof cur[key] !== 'object' ||
      Array.isArray(cur[key])
    ) {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
  return clone;
}

export function hasPath(obj: unknown, path: string): boolean {
  if (obj == null) return false;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return false;
    if (!(part in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[part];
  }
  return true;
}
