// `bun build --define` replaces it; running from source leaves it undeclared, so read it with typeof.
declare const EVERTAP_VERSION: string | undefined;

/** The version `pnpm build` stamps into the binary; `dev` when run from source. */
export const VERSION = typeof EVERTAP_VERSION === "string" ? EVERTAP_VERSION : "dev";
