import { Button } from "@evertap/ui/components/button";
import { cx } from "@evertap/ui/lib/cx";
import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { maskConnectionValue } from "@/lib/resource-connections.ts";

import { CopyButton } from "./copy-button.tsx";

import styles from "./connection-url.module.css";

/** Read-only field: the string you copy. The password is masked until revealed; copy always takes the real one. */
export const ConnectionUrl = ({
  value,
  copyLabel = "Copy",
  size = "default",
  className,
  secrets = [],
  secretLabel = "password",
}: {
  value: string;
  copyLabel?: string;
  size?: "default" | "lg";
  className?: string;
  secrets?: readonly string[];
  secretLabel?: string;
}) => {
  const [revealed, setRevealed] = useState(false);
  const masked = maskConnectionValue(value, secrets);
  const hasSecret = masked !== value;
  const large = size === "lg";
  const shown = revealed ? value : masked;

  const reveal = hasSecret ? (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`${revealed ? "Hide" : "Show"} ${secretLabel}`}
      aria-pressed={revealed}
      className={styles.reveal}
      onClick={() => {
        setRevealed((current) => !current);
      }}
    >
      {revealed ? <EyeSlashIcon /> : <EyeIcon />}
    </Button>
  ) : null;

  return (
    <div className={cx(styles.field, large ? styles.large : styles.compact, className)}>
      <code
        title={shown}
        className={cx(styles.value, large ? styles.valueWrapped : styles.valueLine)}
      >
        {shown}
      </code>
      {large ? (
        <div className={styles.actions}>
          <CopyButton
            value={value}
            label={copyLabel}
            size="lg"
            variant="default"
            className={styles.copyLarge}
          />
          {reveal}
        </div>
      ) : (
        <>
          {reveal}
          <CopyButton
            value={value}
            label="Copy"
            ariaLabel={copyLabel}
            size="default"
            variant="ghost"
            className={styles.copy}
          />
        </>
      )}
    </div>
  );
};
