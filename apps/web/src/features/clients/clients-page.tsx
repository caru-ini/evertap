import type { Client } from "@evertap/api/schemas";
import { Button, buttonVariants } from "@evertap/ui/components/button";
import { Collapsible, CollapsiblePanel } from "@evertap/ui/components/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@evertap/ui/components/dropdown-menu";
import {
  BrowserIcon,
  CaretDownIcon,
  CaretUpIcon,
  DevicesIcon,
  DotsThreeIcon,
  KeyIcon,
  PlusIcon,
  ProhibitIcon,
  SignOutIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { CollapseButton } from "@/components/collapse-button.tsx";
import { FormatSwitch } from "@/components/format-switch.tsx";
import { NameFilter } from "@/components/name-filter.tsx";
import { formatDate, formatTimeAgo } from "@/lib/format.ts";
import { orpc } from "@/lib/orpc.ts";
import { useCollapsed } from "@/lib/use-collapsed.ts";
import { useNow } from "@/lib/use-now.ts";

import { CreateApiKeyDialog } from "./components/create-api-key-dialog.tsx";
import { RevokeClientDialog } from "./components/revoke-client-dialog.tsx";

import styles from "./clients-page.module.css";

// A handful of clients is read at a glance; the tools would only be noise there.
const TOOLS_FROM = 9;

// A kind is cut short until asked for, so many CLIs cannot push the API keys off the screen.
const ROWS_PER_KIND = 5;

const SORTS = [
  { id: "added", label: "Newest" },
  { id: "stale", label: "Least recently used" },
] as const;

// Never used sorts first: nothing depends on it, so it is the safest to revoke.
const byStale = (a: Client, b: Client) =>
  (a.lastUsedAt ?? "").localeCompare(b.lastUsedAt ?? "") || a.createdAt.localeCompare(b.createdAt);

const Band = ({
  icon,
  label,
  count,
  action,
}: {
  icon: ReactNode;
  label: string;
  count: string;
  action?: ReactNode;
}) => (
  <div className={styles.band}>
    <CollapseButton>
      {icon}
      {label}
      <span className={styles.count}>{count}</span>
    </CollapseButton>
    {action}
  </div>
);

const ClientRow = ({
  client,
  now,
  current,
  onRevoke,
  onSignOut,
}: {
  client: Client;
  now: number;
  /** The browser showing this page, which signs out instead of being revoked. */
  current: boolean;
  onRevoke: () => void;
  onSignOut: () => void;
}) => {
  const lastUsed = client.lastUsedAt ? formatTimeAgo(client.lastUsedAt, now) : "Never";

  return (
    <li className={styles.row}>
      <div className={styles.nameCell}>
        <h3 title={client.name} className={styles.name}>
          {client.name}
          {current ? <span className={styles.current}>This browser</span> : null}
        </h3>
        <p className={styles.summary}>
          {lastUsed === "Never" ? "Never used" : `Last used ${lastUsed}`}
          {client.lastUsedIp ? ` from ${client.lastUsedIp}` : ""}
        </p>
      </div>
      <p className={styles.lastUsed}>
        <span className="sr-only">Last used </span>
        {lastUsed}
      </p>
      <p title={client.lastUsedIp ?? undefined} className={styles.ip}>
        <span className="sr-only">Last used from </span>
        {client.lastUsedIp ?? "—"}
      </p>
      <p className={styles.added}>
        <span className="sr-only">Added </span>
        {formatDate(client.createdAt)}
      </p>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" className={styles.rowActions} />}
        >
          <DotsThreeIcon aria-hidden weight="bold" />
          <span className="sr-only">Actions for {client.name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={styles.menu}>
          {current ? (
            <DropdownMenuItem onClick={onSignOut}>
              <SignOutIcon />
              Sign out
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem variant="destructive" onClick={onRevoke}>
              <ProhibitIcon />
              Revoke…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
};

export const ClientsPage = () => {
  const clients = useSuspenseQuery(orpc.clients.list.queryOptions());
  const session = useQuery(orpc.session.get.queryOptions());
  const signOut = useMutation(
    orpc.session.end.mutationOptions({
      onSuccess: () => {
        window.location.assign("/signin");
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );
  const now = useNow();
  const [creating, setCreating] = useState(false);
  // The dialog keeps its client while it closes, so the name does not blank out mid-animation.
  const [revoking, setRevoking] = useState<Client | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("added");
  const [expanded, setExpanded] = useState<Client["kind"][]>([]);
  const collapsed = useCollapsed("clients");

  const tools = clients.data.length >= TOOLS_FROM;
  // Revoking down to a handful hides the field, so what was typed must stop applying too.
  const query = tools ? filter.trim().toLowerCase() : "";
  const shown = (kind: Client["kind"]) => {
    const rows = clients.data.filter(
      (client) => client.kind === kind && client.name.toLowerCase().includes(query),
    );
    return tools && sort === "stale" ? rows.toSorted(byStale) : rows;
  };
  const total = (kind: Client["kind"]) =>
    clients.data.filter((client) => client.kind === kind).length;

  const groups = [
    {
      kind: "browser",
      label: "Browsers",
      icon: <BrowserIcon aria-hidden className={styles.bandIcon} />,
      empty: "No browsers signed in. Add one with the code a new browser shows.",
      action: (
        <Link
          to="/device"
          aria-label="Sign in a browser"
          className={buttonVariants({
            variant: "ghost",
            size: "icon",
            className: styles.bandAction,
          })}
        >
          <PlusIcon />
        </Link>
      ),
    },
    {
      kind: "cli",
      label: "CLI",
      icon: <TerminalWindowIcon aria-hidden className={styles.bandIcon} />,
      empty: "No paired CLIs yet. Pair one to use evertap from a terminal or through an agent.",
      action: (
        <Link
          to="/device"
          aria-label="Pair a CLI"
          className={buttonVariants({
            variant: "ghost",
            size: "icon",
            className: styles.bandAction,
          })}
        >
          <PlusIcon />
        </Link>
      ),
    },
    {
      kind: "api-key",
      label: "API keys",
      icon: <KeyIcon aria-hidden className={styles.bandIcon} />,
      empty: "No API keys yet. Create one for CI or a script that cannot run evertap login.",
      action: (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Create API key"
          className={styles.bandAction}
          onClick={() => {
            setCreating(true);
          }}
        >
          <PlusIcon />
        </Button>
      ),
    },
  ] as const;

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Clients</h1>
          <div className={styles.pageActions}>
            <Link to="/device" className={buttonVariants({ variant: "outline", size: "lg" })}>
              <DevicesIcon aria-hidden />
              Add a device
            </Link>
            <Button
              size="lg"
              onClick={() => {
                setCreating(true);
              }}
            >
              <PlusIcon />
              New API key
            </Button>
          </div>
        </div>
        <p className={styles.intro}>
          Signed-in browsers, paired CLIs, and API keys can use evertap. Revoke the ones you no
          longer use.
        </p>
      </header>

      {tools ? (
        <div className={styles.tools}>
          <NameFilter value={filter} onChange={setFilter} label="Filter clients by name" />
          <div className={styles.sort}>
            <FormatSwitch legend="Sort" options={SORTS} value={sort} onChange={setSort} />
          </div>
        </div>
      ) : null}

      <div className={styles.list}>
        <div aria-hidden className={styles.columnHeads}>
          <span>Name</span>
          <span>Last used</span>
          <span className={styles.ipHead}>IP address</span>
          <span>Added</span>
        </div>

        {groups.map((group) => {
          const matches = shown(group.kind);
          const all = total(group.kind);
          const open = expanded.includes(group.kind);
          // A typed name shows every match: the cut would hide what was asked for.
          const cuttable = query === "" && matches.length > ROWS_PER_KIND;
          const rows = cuttable && !open ? matches.slice(0, ROWS_PER_KIND) : matches;
          return (
            <Collapsible
              key={group.kind}
              open={!collapsed.isCollapsed(group.kind)}
              onOpenChange={() => {
                collapsed.toggle(group.kind);
              }}
              render={<section aria-label={group.label} className={styles.group} />}
            >
              <Band
                icon={group.icon}
                label={group.label}
                count={query === "" ? String(all) : `${matches.length} of ${all}`}
                action={group.action}
              />
              <CollapsiblePanel>
                <div className={styles.body}>
                  {rows.length > 0 ? (
                    <ul className={styles.rows}>
                      {rows.map((client) => (
                        <ClientRow
                          key={client.id}
                          client={client}
                          now={now}
                          current={client.id === session.data?.clientId}
                          onSignOut={() => {
                            signOut.mutate({});
                          }}
                          onRevoke={() => {
                            setRevoking(client);
                            setRevokeOpen(true);
                          }}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.empty}>
                      {all === 0 ? group.empty : "No name matches. Try part of the name."}
                    </p>
                  )}
                  {cuttable ? (
                    <Button
                      variant="ghost"
                      className={styles.showAll}
                      onClick={() => {
                        setExpanded((kinds) =>
                          open
                            ? kinds.filter((kind) => kind !== group.kind)
                            : [...kinds, group.kind],
                        );
                      }}
                    >
                      {open ? "Show fewer" : `Show all ${matches.length}`}
                      {open ? (
                        <CaretUpIcon aria-hidden className={styles.caret} />
                      ) : (
                        <CaretDownIcon aria-hidden className={styles.caret} />
                      )}
                    </Button>
                  ) : null}
                </div>
              </CollapsiblePanel>
            </Collapsible>
          );
        })}
      </div>

      <CreateApiKeyDialog open={creating} onOpenChange={setCreating} />
      {revoking ? (
        <RevokeClientDialog
          client={revoking}
          now={now}
          open={revokeOpen}
          onOpenChange={setRevokeOpen}
        />
      ) : null}
    </section>
  );
};
