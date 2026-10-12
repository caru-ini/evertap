import type { AppRouterClient } from "@evertap/api/router";
import { ORPCError, createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { SimpleCsrfProtectionLinkPlugin } from "@orpc/client/plugins";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const link = new RPCLink({
  url: `${window.location.origin}/api/rpc`,
  // The session is a cookie, so the server checks that a call comes from this page's script.
  plugins: [new SimpleCsrfProtectionLinkPlugin()],
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client, {
  experimental_defaults: {
    // The route renders its own error state; a toast on top would say it twice.
    resources: {
      list: { queryOptions: { meta: { silent: true } } },
      get: { queryOptions: { meta: { silent: true } } },
    },
    extensions: { list: { queryOptions: { meta: { silent: true } } } },
    clients: {
      list: { queryOptions: { meta: { silent: true } } },
      pairing: { get: { queryOptions: { meta: { silent: true }, retry: false } } },
    },
    // The data pages show the engine's message in place; asking again would get the same answer.
    data: {
      tables: { queryOptions: { meta: { silent: true }, retry: false } },
      rows: { queryOptions: { meta: { silent: true }, retry: false } },
      keys: { infiniteOptions: { meta: { silent: true }, retry: false } },
      key: { queryOptions: { meta: { silent: true }, retry: false } },
      objects: { infiniteOptions: { meta: { silent: true }, retry: false } },
    },
    // The meter shows a placeholder instead of nagging every 30 s while the box is unreachable.
    system: {
      status: { queryOptions: { meta: { silent: true }, refetchInterval: 30_000 } },
      doctor: { queryOptions: { meta: { silent: true }, refetchInterval: 10_000 } },
      settings: {
        get: { queryOptions: { meta: { silent: true } } },
        network: { queryOptions: { meta: { silent: true } } },
        tunnel: { progress: { queryOptions: { meta: { silent: true }, retry: false } } },
      },
    },
  },
});

const signedOut = (error: Error) => error instanceof ORPCError && error.code === "UNAUTHORIZED";

/** A first download is running; asking again at once only waits the same minute out. */
const notReady = (error: Error) =>
  error instanceof ORPCError && error.code === "SERVICE_UNAVAILABLE";

/** A session revoked or lapsed mid-use: the sign-in page replaces whatever was on screen. */
const toSignIn = () => {
  if (window.location.pathname !== "/signin") {
    window.location.assign("/signin");
  }
};

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, error) => !signedOut(error) && !notReady(error) && count < 1,
      },
    },
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (signedOut(error)) {
          toSignIn();
          return;
        }
        if (query.meta?.silent === true) {
          return;
        }
        toast.error(error.message);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (signedOut(error)) {
          toSignIn();
        }
      },
    }),
  });
