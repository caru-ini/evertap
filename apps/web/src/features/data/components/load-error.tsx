import { Button } from "@evertap/ui/components/button";
import { Spinner } from "@evertap/ui/components/spinner";
import { WarningCircleIcon } from "@phosphor-icons/react";

import { errorMessage } from "../error-message.ts";

import styles from "./load-error.module.css";

/** A failed read in place of what it would have shown; the message is the engine's or the API's. */
export const LoadError = ({
  error,
  retrying,
  onRetry,
}: {
  error: unknown;
  retrying: boolean;
  onRetry: () => void;
}) => (
  <div role="alert" className={styles.error}>
    <p className={styles.message}>
      <WarningCircleIcon aria-hidden className={styles.icon} />
      {errorMessage(error)}
    </p>
    <Button variant="outline" size="default" disabled={retrying} onClick={onRetry}>
      {retrying ? <Spinner /> : null}
      Try again
    </Button>
  </div>
);
