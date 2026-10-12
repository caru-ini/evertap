import type { Resource } from "@evertap/api/schemas";

// A resource nobody has connected to yet counts from its creation, so a new one shows up at once.
const usedAt = (resource: Resource) => resource.lastConnectedAt ?? resource.createdAt;

/** The most recently used resources first, cut to `limit` when one is given. */
export const recentResources = (resources: Resource[], limit?: number) =>
  resources.toSorted((a, b) => usedAt(b).localeCompare(usedAt(a))).slice(0, limit);
