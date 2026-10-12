import { cx } from "@evertap/ui/lib/cx";
import {
  CheckCircleIcon,
  InfoIcon,
  WarningIcon,
  XCircleIcon,
  SpinnerIcon,
} from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import type * as React from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import styles from "./sonner.module.css";

// Inline, because sonner's own unlayered stylesheet sets these variables too.
const style: React.CSSProperties & Record<`--${string}`, string> = {
  "--normal-bg": "var(--popover)",
  "--normal-text": "var(--popover-foreground)",
  "--normal-border": "var(--border)",
  "--border-radius": "var(--radius)",
};

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme === "light" || theme === "dark" ? theme : "system"}
      icons={{
        success: <CheckCircleIcon className={styles.icon} />,
        info: <InfoIcon className={styles.icon} />,
        warning: <WarningIcon className={styles.icon} />,
        error: <XCircleIcon className={styles.icon} />,
        loading: <SpinnerIcon className={cx(styles.icon, styles.spin)} />,
      }}
      style={style}
      {...props}
    />
  );
};

export { Toaster };
