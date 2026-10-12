import type { SystemStatus } from "@evertap/api/schemas";
import { Kbd } from "@evertap/ui/components/kbd";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@evertap/ui/components/sidebar";
import { cx } from "@evertap/ui/lib/cx";
import {
  ArrowCircleUpIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  StackIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";

import { Brand } from "@/components/brand.tsx";
import { ResourceIcon } from "@/components/resource-icon.tsx";
import { openCreateResource } from "@/lib/create-resource.ts";
import { IS_MAC } from "@/lib/is-mac.ts";
import { orpc } from "@/lib/orpc.ts";
import { ENGINE_INFO, RESOURCE_GROUPS } from "@/lib/resource-engines.ts";

import { MachineMeter } from "./machine-meter.tsx";
import { SearchMenu } from "./search-menu.tsx";
import { ThemeMenu } from "./theme-menu.tsx";

import styles from "./app-sidebar.module.css";

export const AppSidebar = ({ status }: { status: SystemStatus | undefined }) => {
  const location = useLocation();
  const selectedEngine = new URLSearchParams(location.searchStr).get("engine");
  const resources = useQuery(orpc.resources.list.queryOptions());
  const [searchOpen, setSearchOpen] = useState(false);
  const { isMobile, setOpenMobile, state } = useSidebar();
  const collapsed = !isMobile && state === "collapsed";
  // A resource page has no row of its own here, so its engine marks where you are.
  const currentEngine = resources.data?.find(
    (resource) =>
      location.pathname === `/resources/${resource.id}` ||
      location.pathname.startsWith(`/resources/${resource.id}/`),
  )?.engine;
  const allActive = location.pathname === "/" && !selectedEngine;
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className={styles.header}>
          <Brand className={styles.brand} />
          <ThemeMenu className={styles.theme} />
          <SidebarTrigger className={styles.trigger} />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu className={styles.menu}>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Search"
                  aria-haspopup="dialog"
                  aria-keyshortcuts={IS_MAC ? "Meta+K" : "Control+K"}
                  onClick={() => {
                    closeOnMobile();
                    setSearchOpen(true);
                  }}
                  className={styles.search}
                >
                  <MagnifyingGlassIcon aria-hidden />
                  <span>Search</span>
                  <Kbd className={styles.shortcut}>{IS_MAC ? "⌘K" : "Ctrl K"}</Kbd>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={allActive}
                  tooltip="All resources"
                  render={<Link to="/" search={{}} />}
                  onClick={closeOnMobile}
                  className={styles.page}
                >
                  <StackIcon aria-hidden />
                  <span>All resources</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="New resource"
                  aria-haspopup="dialog"
                  onClick={() => {
                    closeOnMobile();
                    openCreateResource();
                  }}
                  className={styles.page}
                >
                  <PlusIcon aria-hidden />
                  <span>New resource</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
          {RESOURCE_GROUPS.map((group) => (
            <SidebarGroup key={group.id}>
              <SidebarGroupLabel aria-hidden={collapsed || undefined} className={styles.groupLabel}>
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className={styles.menu}>
                  {group.engines.map((engine) => (
                    <SidebarMenuItem key={engine}>
                      <SidebarMenuButton
                        isActive={
                          currentEngine === engine ||
                          (location.pathname === "/" && selectedEngine === engine)
                        }
                        tooltip={ENGINE_INFO[engine].label}
                        render={<Link to="/" search={{ engine }} />}
                        onClick={closeOnMobile}
                        className={cx(styles.page, styles.engine)}
                      >
                        <ResourceIcon engine={engine} />
                        <span>{ENGINE_INFO[engine].label}</span>
                      </SidebarMenuButton>
                      <SidebarMenuAction
                        showOnHover
                        aria-haspopup="dialog"
                        onClick={() => {
                          closeOnMobile();
                          openCreateResource(engine);
                        }}
                        aria-label={`Create ${ENGINE_INFO[engine].label} ${group.id === "object-storage" ? "bucket" : "database"}`}
                        title={`Create ${ENGINE_INFO[engine].label}`}
                        className={styles.create}
                      >
                        <PlusIcon aria-hidden />
                      </SidebarMenuAction>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter className={styles.footer}>
          <SidebarMenu className={styles.footerMenu}>
            {/* Doctor says how to upgrade where evertap runs, and links to the release. */}
            {status?.update ? (
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={`evertap ${status.update.version} is out`}
                  render={<Link to="/doctor" />}
                  onClick={closeOnMobile}
                  className={styles.page}
                >
                  <ArrowCircleUpIcon aria-hidden className={styles.update} />
                  <span>evertap {status.update.version} is out</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : null}
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={["/clients", "/device"].includes(location.pathname)}
                tooltip="Clients"
                render={<Link to="/clients" />}
                onClick={closeOnMobile}
                className={styles.page}
              >
                <TerminalWindowIcon aria-hidden />
                <span>Clients</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={location.pathname === "/settings"}
                tooltip="Settings"
                render={<Link to="/settings" />}
                onClick={closeOnMobile}
                className={styles.page}
              >
                <GearSixIcon aria-hidden />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <MachineMeter status={status} />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        {!isMobile ? <SidebarRail /> : null}
      </Sidebar>
      {/* Outside the sidebar: the mobile sheet unmounts its content when it closes. */}
      <SearchMenu open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
};
