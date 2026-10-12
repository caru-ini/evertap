import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { RouteError } from "@/components/route-error.tsx";
import { DataSkeleton } from "@/features/data/components/data-skeleton.tsx";
import { DataPage } from "@/features/data/data-page.tsx";

const searchSchema = z.object({
  schema: z.string().optional(),
  table: z.string().optional(),
  sql: z.boolean().optional(),
  key: z.string().optional(),
  /** One of a bucket resource's buckets; omitted for its first. */
  bucket: z.string().optional(),
  /** A bucket's folder, ending with `/`; omitted for its top level. */
  prefix: z.string().optional(),
});

// `$id_` keeps this page out of the resource page's layout: it is a page of its own, not a panel.
export const Route = createFileRoute("/resources/$id_/data")({
  validateSearch: searchSchema,
  staticData: { wide: true },
  loaderDeps: ({ search }) => ({ bucket: search.bucket, prefix: search.prefix }),
  loader: async ({ context, params, deps }) => {
    const resource = await context.queryClient.ensureQueryData(
      context.orpc.resources.get.queryOptions({ input: { id: params.id } }),
    );
    if (resource.kind === "database" && resource.engine !== "redis") {
      void context.queryClient.prefetchQuery(
        context.orpc.data.tables.queryOptions({ input: { id: params.id } }),
      );
    }
    if (resource.kind === "object-storage") {
      void context.queryClient.prefetchInfiniteQuery(
        context.orpc.data.objects.infiniteOptions({
          input: (cursor: string | undefined) => ({
            id: params.id,
            bucket: deps.bucket,
            prefix: deps.prefix ?? "",
            cursor,
          }),
          initialPageParam: undefined,
          getNextPageParam: (last) => last.cursor ?? undefined,
        }),
      );
    }
  },
  pendingComponent: DataSkeleton,
  errorComponent: ({ error, reset }) => (
    <RouteError title="Couldn't open this database" error={error} reset={reset} backTo="/" />
  ),
  component: RouteComponent,
});

function RouteComponent() {
  const { id } = Route.useParams();
  const { schema, table, sql, key, bucket, prefix } = Route.useSearch();
  return (
    <DataPage
      key={id}
      id={id}
      selection={{ schema, table, sql }}
      selectedKey={key}
      bucket={bucket}
      prefix={prefix ?? ""}
    />
  );
}
