import { Button, buttonVariants } from "@evertap/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@evertap/ui/components/empty";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { Link, useRouter } from "@tanstack/react-router";

import styles from "./route-error.module.css";

export const RouteError = ({
  title,
  error,
  reset,
  backTo,
}: {
  title: string;
  error: unknown;
  reset: () => void;
  backTo?: "/";
}) => {
  const router = useRouter();
  return (
    <Empty className={styles.error}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <WarningCircleIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>
          {error instanceof Error && error.message !== "Failed to fetch"
            ? error.message
            : "Couldn't reach evertap. Check that you're on the same network, then reload."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className={styles.actions}>
        {backTo ? (
          <Link to={backTo} className={buttonVariants({ variant: "outline", size: "lg" })}>
            Back to resources
          </Link>
        ) : null}
        <Button
          variant="outline"
          size="lg"
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          Reload
        </Button>
      </EmptyContent>
    </Empty>
  );
};
