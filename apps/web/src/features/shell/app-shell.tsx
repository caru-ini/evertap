import { SidebarInset, SidebarProvider, SidebarTrigger } from "@evertap/ui/components/sidebar";
import { cx } from "@evertap/ui/lib/cx";
import { useQuery } from "@tanstack/react-query";
import { useMatches } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

import { Brand } from "@/components/brand.tsx";
import { orpc } from "@/lib/orpc.ts";

import { AppSidebar } from "./components/app-sidebar.tsx";

import styles from "./app-shell.module.css";

// The sidebar writes `sidebar_state` itself; read it once so the choice survives a reload.
const readSidebarOpen = () => !document.cookie.split("; ").includes("sidebar_state=false");

export const AppShell = ({ children }: { children: ReactNode }) => {
  const [defaultOpen] = useState(readSidebarOpen);
  const status = useQuery(orpc.system.status.queryOptions());
  const wide = useMatches({ select: (matches) => matches.some((match) => match.staticData.wide) });
  const column = cx(styles.column, wide && styles.wide);

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar status={status.data} />
      <SidebarInset className={styles.inset}>
        <header className={styles.mobileBar}>
          <SidebarTrigger className={styles.trigger} />
          <Brand />
        </header>

        {status.data?.mode === "demo" ? (
          <div className={styles.demo}>
            <p className={cx(column, styles.demoText)}>
              <span className={styles.demoLabel}>Demo data</span> — changes reset on restart.
              Connection details are examples.
            </p>
          </div>
        ) : null}

        <div className={cx(column, wide ? styles.mainWide : styles.main)}>{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
};
