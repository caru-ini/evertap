import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { Button } from "@evertap/ui/components/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@evertap/ui/components/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@evertap/ui/components/tooltip";
import { useIsMobile } from "@evertap/ui/hooks/use-mobile";
import { cx } from "@evertap/ui/lib/cx";
import { SidebarIcon } from "@phosphor-icons/react";
import * as React from "react";

import styles from "./sidebar.module.css";

const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

type StyleWithVars = React.CSSProperties & Record<`--${string}`, string>;

type SidebarContextProps = {
  state: "expanded" | "collapsed";
  isMobile: boolean;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

function SidebarProvider({
  defaultOpen = true,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & { defaultOpen?: boolean }) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);
  const [open, setOpen] = React.useState(defaultOpen);

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile((value) => !value);
      return;
    }
    const next = !open;
    setOpen(next);
    document.cookie = `${SIDEBAR_COOKIE_NAME}=${next}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
  }, [isMobile, open]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  const state = open ? "expanded" : "collapsed";

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({ state, isMobile, openMobile, setOpenMobile, toggleSidebar }),
    [state, isMobile, openMobile, toggleSidebar],
  );

  const wrapperStyle: StyleWithVars = {
    "--sidebar-width": SIDEBAR_WIDTH,
    "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
    ...style,
  };

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={wrapperStyle}
        className={cx(styles.wrapper, className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

// Inline so the colors beat the sheet's own, whatever layer its styles sit in; the sheet keeps its width.
const MOBILE_STYLE: React.CSSProperties = {
  backgroundColor: "var(--sidebar)",
  color: "var(--sidebar-foreground)",
};

function Sidebar({
  collapsible = "icon",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { collapsible?: "icon" }) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent
          data-slot="sidebar"
          data-mobile="true"
          side="left"
          showCloseButton={false}
          style={MOBILE_STYLE}
        >
          <div className={styles.srOnly}>
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </div>
          <div className={styles.mobileInner}>{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div
      // `group` lets call sites style against data-collapsible with Tailwind's group-data variant.
      className={styles.sidebar}
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-slot="sidebar"
    >
      <div data-slot="sidebar-gap" className={styles.gap} />
      <div data-slot="sidebar-container" className={cx(styles.container, className)} {...props}>
        <div data-slot="sidebar-inner" className={styles.inner}>
          {children}
        </div>
      </div>
    </div>
  );
}

function SidebarTrigger({ onClick, ...props }: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar();

  return (
    <Button
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <SidebarIcon />
      <span className={styles.srOnly}>Toggle Sidebar</span>
    </Button>
  );
}

function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
  const { toggleSidebar } = useSidebar();

  return (
    <button
      type="button"
      data-slot="sidebar-rail"
      aria-label="Toggle Sidebar"
      tabIndex={-1}
      onClick={toggleSidebar}
      title="Toggle Sidebar"
      className={cx(styles.rail, className)}
      {...props}
    />
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return <main data-slot="sidebar-inset" className={cx(styles.inset, className)} {...props} />;
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-header" className={cx(styles.header, className)} {...props} />;
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-footer" className={cx(styles.footer, className)} {...props} />;
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-content" className={cx(styles.content, className)} {...props} />;
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-group" className={cx(styles.group, className)} {...props} />;
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="sidebar-group-label" className={cx(styles.groupLabel, className)} {...props} />
  );
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      className={cx(styles.groupContent, className)}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul data-slot="sidebar-menu" className={cx(styles.menu, className)} {...props} />;
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="sidebar-menu-item" className={cx(styles.menuItem, className)} {...props} />;
}

function SidebarMenuButton({
  render,
  isActive = false,
  tooltip,
  className,
  ...props
}: useRender.ComponentProps<"button"> &
  React.ComponentProps<"button"> & {
    isActive?: boolean;
    tooltip?: string;
  }) {
  const { isMobile, state } = useSidebar();
  const comp = useRender({
    defaultTagName: "button",
    props: mergeProps<"button">({ className: cx(styles.menuButton, className) }, props),
    render: tooltip ? <TooltipTrigger render={render} /> : render,
    state: {
      slot: "sidebar-menu-button",
      active: isActive,
    },
  });

  if (!tooltip) {
    return comp;
  }

  return (
    <Tooltip>
      {comp}
      <TooltipContent side="right" align="center" hidden={state !== "collapsed" || isMobile}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarMenuAction({
  className,
  render,
  showOnHover = false,
  ...props
}: useRender.ComponentProps<"button"> &
  React.ComponentProps<"button"> & {
    showOnHover?: boolean;
  }) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      { className: cx(styles.menuAction, showOnHover && styles.showOnHover, className) },
      props,
    ),
    render,
    state: {
      slot: "sidebar-menu-action",
    },
  });
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
};
