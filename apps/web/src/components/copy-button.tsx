import { Button } from "@evertap/ui/components/button";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";

import { useCopy } from "@/lib/use-copy.ts";

import styles from "./copy-button.module.css";

/** The icon and label swap is the feedback; no toast on success. */
export const CopyButton = ({
  value,
  label = "Copy",
  size = "default",
  variant = "ghost",
  className,
  labelClassName,
  ariaLabel,
}: {
  value: string;
  label?: string;
  size?: "default" | "sm" | "lg";
  variant?: "ghost" | "secondary" | "default";
  className?: string;
  labelClassName?: string;
  ariaLabel?: string;
}) => {
  const { copied, copy } = useCopy();

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      aria-live="polite"
      aria-label={copied ? "Copied" : ariaLabel}
      onClick={() => {
        void copy(value);
      }}
    >
      {/* Green loses contrast on the filled button's light fill; keep its text color there. */}
      {copied ? (
        <CheckIcon weight="bold" className={variant === "default" ? undefined : styles.copied} />
      ) : (
        <CopyIcon />
      )}
      <span className={labelClassName}>{copied ? "Copied" : label}</span>
    </Button>
  );
};
