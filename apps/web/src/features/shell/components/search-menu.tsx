import type { Resource } from "@evertap/api/schemas";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@evertap/ui/components/command";
import {
  GearSixIcon,
  PlusIcon,
  StackIcon,
  StethoscopeIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ResourceIcon } from "@/components/resource-icon.tsx";
import { openCreateResource } from "@/lib/create-resource.ts";
import { orpc } from "@/lib/orpc.ts";
import { recentResources } from "@/lib/recent-resources.ts";
import { ENGINE_INFO, RESOURCE_GROUPS } from "@/lib/resource-engines.ts";

import styles from "./search-menu.module.css";

const ENGINES = RESOURCE_GROUPS.flatMap((group) => group.engines);

// Every typed word must appear as written: cmdk's fuzzy default also finds "shop" in
// "search_e2e PostgreSQL", which buries the real matches once there are hundreds of names.
const matchWords = (value: string, search: string) => {
  const text = value.toLowerCase();
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.every((word) => text.includes(word))) return 0;
  return words.some((word) => text.startsWith(word)) ? 1 : 0.5;
};

const ResourceItem = ({ resource, onSelect }: { resource: Resource; onSelect: () => void }) => (
  <CommandItem
    // A name is unique within its engine only, and cmdk needs a unique value.
    value={`${resource.name} ${ENGINE_INFO[resource.engine].label}`}
    onSelect={onSelect}
  >
    <ResourceIcon engine={resource.engine} />
    <span title={resource.name} className={styles.name}>
      {resource.name}
    </span>
    <CommandShortcut className={styles.engine}>
      {ENGINE_INFO[resource.engine].label}
    </CommandShortcut>
  </CommandItem>
);

// Mounted only while the dialog is open, so the typed text resets every time.
const SearchMenuContent = ({ onDone }: { onDone: () => void }) => {
  const navigate = useNavigate();
  const resources = useQuery(orpc.resources.list.queryOptions());
  const [search, setSearch] = useState("");
  const rows = resources.data ?? [];
  const searching = search.trim() !== "";

  const openResource = (id: string) => {
    onDone();
    void navigate({ to: "/resources/$id", params: { id } });
  };

  return (
    <Command filter={matchWords}>
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search resources and pages"
      />
      <CommandList className={styles.list}>
        <CommandEmpty className={styles.empty}>
          Nothing matches. Try part of a resource name.
        </CommandEmpty>
        {searching ? (
          ENGINES.map((engine) => {
            const matches = rows.filter((resource) => resource.engine === engine);
            return matches.length > 0 ? (
              <CommandGroup key={engine} heading={ENGINE_INFO[engine].label}>
                {matches.map((resource) => (
                  <ResourceItem
                    key={resource.id}
                    resource={resource}
                    onSelect={() => {
                      openResource(resource.id);
                    }}
                  />
                ))}
              </CommandGroup>
            ) : null;
          })
        ) : rows.length > 0 ? (
          <CommandGroup heading="Recently used">
            {recentResources(rows, 5).map((resource) => (
              <ResourceItem
                key={resource.id}
                resource={resource}
                onSelect={() => {
                  openResource(resource.id);
                }}
              />
            ))}
          </CommandGroup>
        ) : null}
        <CommandGroup heading="Go to">
          <CommandItem
            onSelect={() => {
              onDone();
              void navigate({ to: "/", search: {} });
            }}
          >
            <StackIcon aria-hidden />
            All resources
          </CommandItem>
          {ENGINES.map((engine) => (
            <CommandItem
              key={engine}
              onSelect={() => {
                onDone();
                void navigate({ to: "/", search: { engine } });
              }}
            >
              <ResourceIcon engine={engine} />
              {ENGINE_INFO[engine].label}
            </CommandItem>
          ))}
          <CommandItem
            onSelect={() => {
              onDone();
              void navigate({ to: "/clients" });
            }}
          >
            <TerminalWindowIcon aria-hidden />
            Clients
          </CommandItem>
          <CommandItem
            onSelect={() => {
              onDone();
              void navigate({ to: "/doctor" });
            }}
          >
            <StethoscopeIcon aria-hidden />
            Doctor
          </CommandItem>
          <CommandItem
            onSelect={() => {
              onDone();
              void navigate({ to: "/settings" });
            }}
          >
            <GearSixIcon aria-hidden />
            Settings
          </CommandItem>
          <CommandItem
            onSelect={() => {
              onDone();
              openCreateResource();
            }}
          >
            <PlusIcon aria-hidden />
            New resource
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
};

export const SearchMenu = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      // Another dialog is asking something; search must not cover it.
      if (!open && document.querySelector("[role=dialog], [role=alertdialog]")) return;
      event.preventDefault();
      onOpenChange(!open);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Find a resource by name or go to a page."
      className={styles.dialog}
    >
      <SearchMenuContent
        onDone={() => {
          onOpenChange(false);
        }}
      />
    </CommandDialog>
  );
};
