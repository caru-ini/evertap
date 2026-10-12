import type { Caller, Store } from "./context.ts";

/**
 * The UI's path: a browser by its session cookie. A CLI token or API key in the cookie is refused,
 * or a client could act as a person and approve other clients.
 */
export const sessionCaller = async (
  store: Store,
  token: string | undefined,
  ip: string | null,
): Promise<Caller> => {
  const client = token ? await store.authenticate(token, { ip }) : null;
  return client?.kind === "browser" ? { kind: "person", client } : { kind: "anonymous" };
};

/** The CLI's path: a paired CLI or an API key by `Authorization: Bearer`, never a browser's session. */
export const bearerCaller = async (
  store: Store,
  authorization: string | null | undefined,
  ip: string | null,
): Promise<Caller> => {
  const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
  const client = token ? await store.authenticate(token, { ip }) : null;
  return client && client.kind !== "browser" ? { kind: "client", client } : { kind: "anonymous" };
};
