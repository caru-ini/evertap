import type { ResourceEngine } from "@evertap/api/rules";
import type { Resource } from "@evertap/api/schemas";
import { Button, buttonVariants } from "@evertap/ui/components/button";
import { Checkbox } from "@evertap/ui/components/checkbox";
import { Collapsible, CollapsiblePanel } from "@evertap/ui/components/collapsible";
import { Label } from "@evertap/ui/components/label";
import { ArrowRightIcon, PlusIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { BackLink } from "@/components/back-link.tsx";
import { CollapseButton } from "@/components/collapse-button.tsx";
import { FormatSwitch } from "@/components/format-switch.tsx";
import { NameFilter } from "@/components/name-filter.tsx";
import { ResourceIcon } from "@/components/resource-icon.tsx";
import { openCreateResource } from "@/lib/create-resource.ts";
import { orpc } from "@/lib/orpc.ts";
import { recentResources } from "@/lib/recent-resources.ts";
import { ENGINE_INFO, RESOURCE_GROUPS } from "@/lib/resource-engines.ts";
import { useCollapsed } from "@/lib/use-collapsed.ts";
import { useNow } from "@/lib/use-now.ts";

import { ResourceColumns, ResourceRow } from "./components/resource-row.tsx";

import styles from "./resources-page.module.css";

// All resources cuts each engine short, so one long engine cannot push the others off the screen.
const ROWS_PER_ENGINE = 5;

// A handful of rows is read at a glance; the tools would only be noise there.
const TOOLS_FROM = 9;

const SORTS = [
  { id: "recent", label: "Recently used" },
  { id: "stale", label: "Least recently used" },
] as const;

// Never used sorts first: nothing depends on it, so it is the safest to delete.
const byStale = (a: Resource, b: Resource) =>
  (a.lastConnectedAt ?? "").localeCompare(b.lastConnectedAt ?? "") ||
  a.createdAt.localeCompare(b.createdAt);

const ENGINES = RESOURCE_GROUPS.flatMap((group) =>
  group.engines.map((engine) => ({
    engine,
    label: ENGINE_INFO[engine].label,
    noun: group.id === "object-storage" ? "bucket" : "database",
  })),
);

export const ResourcesPage = ({ engine }: { engine?: ResourceEngine }) => {
  const resources = useSuspenseQuery(orpc.resources.list.queryOptions());
  const now = useNow();
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("recent");
  const [protectedOnly, setProtectedOnly] = useState(false);
  const collapsed = useCollapsed("resources");

  const current = ENGINES.find((item) => item.engine === engine);
  const inEngine = (item: (typeof ENGINES)[number]) =>
    resources.data.filter((resource) => resource.engine === item.engine);
  // Deleting down to a handful hides the tools, so what they were set to must stop applying too.
  const tools = current !== undefined && inEngine(current).length >= TOOLS_FROM;
  const query = tools ? filter.trim().toLowerCase() : "";
  const narrowed = tools && (query !== "" || protectedOnly);
  // Engines without resources stay out of the list; the sidebar still reaches them.
  const sections = (current ? [current] : ENGINES).flatMap((item) => {
    const all = inEngine(item);
    const matches = narrowed
      ? all.filter(
          (resource) =>
            resource.name.toLowerCase().includes(query) && (!protectedOnly || resource.protected),
        )
      : all;
    const rows =
      tools && sort === "stale"
        ? matches.toSorted(byStale)
        : recentResources(matches, current ? undefined : ROWS_PER_ENGINE);
    return all.length > 0 ? [{ ...item, rows, total: all.length }] : [];
  });

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        {current ? <BackLink label="All resources" /> : null}
        <div className={styles.titleRow}>
          <h1 className={styles.title}>
            {current ? <ResourceIcon engine={current.engine} className={styles.titleIcon} /> : null}
            {current?.label ?? "Resources"}
          </h1>
          <Button
            size="lg"
            className={styles.newButton}
            onClick={() => {
              openCreateResource(engine);
            }}
          >
            <PlusIcon />
            New {current?.noun ?? "resource"}
          </Button>
        </div>
      </header>

      {tools ? (
        <div className={styles.tools}>
          <NameFilter
            value={filter}
            onChange={setFilter}
            label={`Filter ${current.label} ${current.noun}s by name`}
          />
          <div className={styles.protectedTools}>
            {/* A check mark, not a filled button: beside the sort switch a fill reads as either state. */}
            <Label className={styles.protectedOnly}>
              <Checkbox checked={protectedOnly} onCheckedChange={setProtectedOnly} />
              Protected only
            </Label>
            {narrowed ? (
              <p className={styles.count}>
                {sections[0]?.rows.length ?? 0} of {sections[0]?.total ?? 0}
              </p>
            ) : null}
          </div>
          <div className={styles.sort}>
            <FormatSwitch legend="Sort" options={SORTS} value={sort} onChange={setSort} />
          </div>
        </div>
      ) : null}

      {sections.length > 0 ? (
        <div className={styles.list}>
          <ResourceColumns />
          {sections.map((section) => {
            // Engine pages have no band to unfold from, so only All resources folds.
            const open = current !== undefined || !collapsed.isCollapsed(section.engine);
            return (
              <Collapsible
                key={section.engine}
                open={open}
                onOpenChange={() => {
                  collapsed.toggle(section.engine);
                }}
                render={<section aria-label={section.label} className={styles.group} />}
              >
                {current ? null : (
                  <div className={styles.band}>
                    <CollapseButton>
                      <ResourceIcon engine={section.engine} />
                      {section.label}
                      <span className={styles.count}>{section.total}</span>
                    </CollapseButton>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Create ${section.label} ${section.noun}`}
                      className={styles.bandAdd}
                      onClick={() => {
                        openCreateResource(section.engine);
                      }}
                    >
                      <PlusIcon />
                    </Button>
                  </div>
                )}
                <CollapsiblePanel className={styles.panel}>
                  <div className={styles.body}>
                    {section.rows.length > 0 ? (
                      <ul className={styles.rows}>
                        {section.rows.map((resource) => (
                          <ResourceRow key={resource.id} resource={resource} now={now} />
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.noMatch}>
                        {protectedOnly
                          ? `No protected ${section.noun} matches. Turn off Protected only to see the rest.`
                          : "No name matches. Try part of the name."}
                      </p>
                    )}
                    {!current && section.total > section.rows.length ? (
                      <Link
                        to="/"
                        search={{ engine: section.engine }}
                        className={buttonVariants({ variant: "ghost", className: styles.more })}
                      >
                        All {section.total} {section.label} {section.noun}s
                        <ArrowRightIcon aria-hidden className={styles.moreIcon} />
                      </Link>
                    ) : null}
                  </div>
                </CollapsiblePanel>
              </Collapsible>
            );
          })}
        </div>
      ) : (
        <p className={styles.empty}>
          {current
            ? `No ${current.label} ${current.noun}s yet. Create one to get its connection details.`
            : "No resources yet. Create a database or a bucket to get its connection details."}
        </p>
      )}
    </section>
  );
};
