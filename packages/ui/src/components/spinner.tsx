import { cx } from "@evertap/ui/lib/cx";
import { SpinnerIcon } from "@phosphor-icons/react";

import styles from "./spinner.module.css";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <SpinnerIcon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cx(styles.spinner, className)}
      {...props}
    />
  );
}

export { Spinner };
