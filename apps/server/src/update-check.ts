import type { Update } from "@evertap/api/schemas";

const REPO = "https://github.com/caru-ini/evertap";

/**
 * GitHub redirects this to the newest stable release's page, never a prerelease's. Reading the
 * redirect is one request with no body, and outside the API's limit of 60 an hour per address.
 */
const LATEST_URL = `${REPO}/releases/latest`;

/** Soon after `evertap serve` starts, without holding it up. */
const FIRST_CHECK_MS = 10_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

/** A release, or a develop build such as `0.2.0-dev.14+1a2b3c4`; `dev` from source is neither. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i;

const RELEASE_PATTERN = /^\d+\.\d+\.\d+$/;

const INSTALL_COMMAND = "curl -fsSL https://evertap.dev/install.sh | sh";

/** The stable release GitHub redirects `releases/latest` to; null before the first release. */
export const releaseIn = (location: string | null) => {
  if (location === null || !URL.canParse(location, LATEST_URL)) {
    return null;
  }
  const { pathname } = new URL(location, LATEST_URL);
  const version = /\/releases\/tag\/v([^/]+)$/.exec(pathname)?.[1];
  return version !== undefined && RELEASE_PATTERN.test(version) ? version : null;
};

/** By semver, so a develop build comes before its release; never for `dev` from source. */
export const isNewer = (latest: string, current: string) =>
  VERSION_PATTERN.test(latest) &&
  VERSION_PATTERN.test(current) &&
  Bun.semver.order(latest, current) > 0;

/**
 * What to tell a CLI older than the evertap it uses, when that runs a release the install script
 * brings; null otherwise, as for a develop build, which the script does not install.
 */
export const cliBehind = (cli: string, running: string) =>
  RELEASE_PATTERN.test(running) && isNewer(running, cli)
    ? `This machine has evertap ${cli}, and the evertap it uses runs ${running}. Run the install script again on this machine: ${INSTALL_COMMAND}`
    : null;

/** evertap's own image upgrades by pulling a new one; any other install by the script again. */
const upgradeAdvice = (image: boolean) =>
  image
    ? "Run docker compose pull and docker compose up -d on the machine running evertap"
    : `Run the install script again on the machine running evertap: ${INSTALL_COMMAND}`;

const failure = (error: unknown) => {
  if (error instanceof Error && error.name === "TimeoutError") {
    return "GitHub did not answer";
  }
  return error instanceof Error ? error.message : String(error);
};

export type UpdateCheckOptions = {
  /** This evertap's version; one that is not a release or a develop build is never checked. */
  version: string;
  /** False with `EVERTAP_UPDATE_CHECK=0`. */
  enabled: boolean;
  /** Running in evertap's own image. */
  image: boolean;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  log?: (line: string) => void;
};

/**
 * Asks GitHub for the newest stable release and keeps a newer one in memory. Sends nothing about
 * the machine; a failed check waits for the next one.
 */
export const createUpdateCheck = (options: UpdateCheckOptions) => {
  const send = options.fetch ?? fetch;
  const log = options.log ?? console.log;
  const active = options.enabled && VERSION_PATTERN.test(options.version);
  let found: Update | null = null;

  const check = async () => {
    if (!active) {
      return;
    }
    let latest: string | null;
    try {
      const response = await send(LATEST_URL, {
        redirect: "manual",
        headers: { "user-agent": "evertap" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await response.body?.cancel();
      if (response.status < 300 || response.status > 399) {
        throw new Error(`GitHub answered ${response.status}`);
      }
      latest = releaseIn(response.headers.get("location"));
    } catch (error) {
      log(`Could not check for a newer evertap, so it tries again in a day: ${failure(error)}`);
      return;
    }
    if (latest === null || !isNewer(latest, options.version)) {
      found = null;
      return;
    }
    const advice = upgradeAdvice(options.image);
    if (found?.version !== latest) {
      log(`evertap ${latest} is out (this is ${options.version}). ${advice}`);
    }
    found = { version: latest, url: `${REPO}/releases/tag/v${latest}`, advice };
  };

  return {
    /** The newer release the last check found; null when it found none or evertap does not check. */
    latest: () => found,
    check,
    /** Checks soon after start, then once a day. */
    start: () => {
      if (active) {
        setTimeout(() => void check(), FIRST_CHECK_MS).unref();
        setInterval(() => void check(), CHECK_INTERVAL_MS).unref();
      }
    },
  };
};
