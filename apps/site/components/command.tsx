"use client";

import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import styles from "./command.module.css";

const COPIED_MS = 2500;

/** A shell command in a field with a copy button; the icon and label swap is the feedback. */
export function Command({ value }: { value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    const timer =
      state === "idle"
        ? undefined
        : setTimeout(() => {
            setState("idle");
          }, COPIED_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  return (
    <div className={styles.field}>
      <code className={styles.value}>{value}</code>
      <button
        type="button"
        className={styles.copy}
        aria-live="polite"
        onClick={() => {
          void copy();
        }}
      >
        {state === "copied" ? <CheckIcon weight="bold" className={styles.copied} /> : <CopyIcon />}
        <span>
          {state === "copied" ? "Copied" : state === "failed" ? "Select it to copy" : "Copy"}
        </span>
      </button>
    </div>
  );
}
