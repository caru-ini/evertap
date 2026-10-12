/**
 * The tunnel evertap runs, made, moved, or removed from Settings with access the person approves in
 * Cloudflare. The server holds that access for the one change, as setup does in its own process.
 */

import { DataError } from "@evertap/api/context";
import { tunnelOrigins } from "@evertap/api/proxy";
import {
  CLOUDFLARE_CONNECTED_APPS,
  PAIRING_WINDOW_MS,
  type TunnelPhase,
  tunnelLeftovers,
} from "@evertap/api/rules";
import type {
  SavedSettings,
  Tunnel,
  TunnelChange,
  TunnelNames,
  TunnelResult,
} from "@evertap/api/schemas";
import type { SettingsEnvironment } from "@evertap/api/settings";

import { type Approval, redeem, startApproval } from "./cloudflare-oauth.ts";
import type { Cloudflare } from "./cloudflare.ts";

/** Long enough for the answer to a change to leave through the tunnel it stops. */
export const ANSWER_MS = 5000;

/** Why a tunnel's settings were not put in force: cloudflared did not connect it in time. */
export const TUNNEL_UNCONNECTED =
  "The tunnel did not connect to Cloudflare within a minute, so evertap did not switch to it. Let this machine connect out to Cloudflare on TCP 7844 in its firewall, then try again";

/**
 * Removes what `previous` made in Cloudflare that `next` does not use; what it cannot remove is
 * left for the person, with why.
 */
const removeUnused = async (
  api: Cloudflare,
  previous: Tunnel,
  next: Tunnel | null,
): Promise<TunnelResult["left"]> => {
  try {
    await api.tearDown(previous, next);
    return null;
  } catch (error) {
    if (!(error instanceof DataError)) {
      throw error;
    }
    const { token: _, ...ids } = previous;
    return { tunnel: ids, reason: error.message };
  }
};

export const createTunnelChanges = ({
  settings,
  save,
  run,
  now = Date.now,
  answerMs = ANSWER_MS,
}: {
  settings: () => Promise<{ saved: SavedSettings | null; environment: SettingsEnvironment }>;
  /**
   * Puts the settings in force, moving listeners and starting or stopping cloudflared to match. A
   * tunnel they bring has to connect first, or nothing changes and it throws `TUNNEL_UNCONNECTED`.
   * `report` hears each phase it goes through.
   */
  save: (saved: SavedSettings, report: (phase: TunnelPhase) => void) => Promise<void>;
  /** Runs cloudflared for a tunnel, or stops it for null, whatever the settings say. */
  run: (tunnel: Tunnel | null) => Promise<void>;
  now?: () => number;
  answerMs?: number;
}) => {
  // One open approval per signed-in browser, for as long as a sign-in code lasts.
  const open = new Map<string, Approval & { expiresAt: number }>();
  // Where each browser's change is while it runs.
  const phases = new Map<string, TunnelPhase>();
  const drop = () => {
    for (const [session, { expiresAt }] of open) {
      if (expiresAt <= now()) {
        open.delete(session);
      }
    }
  };

  /**
   * Saving moves the UI's listener, and the one this request came in on closes soon after, so the
   * slow part comes first: cloudflared stops before the settings change, and only quick calls
   * follow.
   */
  const removeNow = async (
    api: Cloudflare,
    previous: Tunnel,
    next: SavedSettings,
    report: (phase: TunnelPhase) => void,
  ) => {
    try {
      // Cloudflare deletes a tunnel only once cloudflared has let go of it.
      await run(null);
      const left = await removeUnused(api, previous, null);
      report("switching");
      await save(next, report);
      return left;
    } catch (error) {
      // Back to the tunnel the settings still hold; the first failure says more than this one.
      await run(previous).catch(() => undefined);
      throw error;
    }
  };

  /**
   * Makes or moves the tunnel for `names` in Cloudflare and switches to it once cloudflared
   * connects. The names it served before still lead here until whoever called removes them.
   */
  const switchTo = async (
    api: Cloudflare,
    names: TunnelNames,
    previous: Tunnel | null,
    report: (phase: TunnelPhase) => void,
  ) => {
    const { environment } = await settings();
    const zone = await api.zoneFor(names);
    const tunnel = await api.setUp(zone, names, tunnelOrigins(environment), previous);
    await save({ mode: "cloudflare", publicUrl: `https://${tunnel.hostnames.ui}`, tunnel }, report);
    return tunnel;
  };

  /**
   * Removes what `previous` used and `next` does not, once the answer to the change has gone out
   * through it, then gives the access back. The browser has moved on by then, so the log says what
   * was left.
   */
  const finishLater = async (
    access: Awaited<ReturnType<typeof redeem>>,
    previous: Tunnel,
    next: Tunnel | null,
  ) => {
    await Bun.sleep(answerMs);
    let left: TunnelResult["left"] = null;
    try {
      if (!next) {
        await run(null);
      }
      left = await removeUnused(access.api, previous, next);
    } catch (error) {
      const { token: _, ...ids } = previous;
      left = { tunnel: ids, reason: error instanceof Error ? error.message : String(error) };
    }
    if (left) {
      console.warn(
        `evertap could not remove what it made in Cloudflare for ${left.tunnel.hostnames.ui}: ${left.reason}. Remove it there:`,
      );
      for (const { what, where, url } of tunnelLeftovers(left.tunnel)) {
        console.warn(`  ${what}, under ${where}: ${url}`);
      }
    }
    if (!(await access.revoke())) {
      console.warn(
        `Cloudflare did not confirm it took back evertap's access. Remove evertap under Connected applications in Cloudflare: ${CLOUDFLARE_CONNECTED_APPS}`,
      );
    }
  };

  return {
    approve: (session: string) => {
      drop();
      const approval = startApproval();
      open.set(session, { ...approval, expiresAt: now() + PAIRING_WINDOW_MS });
      return Promise.resolve(approval.url);
    },

    change: async (
      session: string,
      pasted: string,
      change: TunnelChange,
      { answerFirst }: { answerFirst: boolean },
    ): Promise<TunnelResult> => {
      drop();
      const approval = open.get(session);
      // Also after a restart, which forgets every approval.
      if (!approval) {
        throw new DataError("This approval has expired. Approve evertap in Cloudflare again");
      }
      const report = (phase: TunnelPhase) => {
        phases.set(session, phase);
      };
      report("approval");
      try {
        const access = await redeem(approval, pasted);
        // A code works once, so this approval is spent whatever happens next.
        open.delete(session);
        const { saved } = await settings();
        const previous = saved?.mode === "cloudflare" ? saved.tunnel : null;
        let left: TunnelResult["left"];
        try {
          report("cloudflare");
          if (change.action === "remove") {
            if (!previous) {
              throw new DataError("evertap runs no tunnel to remove. Reload Settings");
            }
            if (answerFirst) {
              // Stopping cloudflared now would drop this answer, which goes back through the tunnel.
              report("switching");
              await save(change.next, report);
              void finishLater(access, previous, null);
              return { left: null, revoked: null };
            }
            left = await removeNow(access.api, previous, change.next, report);
          } else {
            const tunnel = await switchTo(access.api, change.names, previous, report);
            if (answerFirst && previous) {
              // The answer goes back through a name this change leaves, so it stays till then.
              void finishLater(access, previous, tunnel);
              return { left: null, revoked: null };
            }
            left = previous ? await removeUnused(access.api, previous, tunnel) : null;
          }
        } catch (error) {
          await access.revoke();
          throw error;
        }
        return { left, revoked: await access.revoke() };
      } finally {
        phases.delete(session);
      }
    },

    progress: (session: string) => Promise.resolve(phases.get(session) ?? null),
  };
};
