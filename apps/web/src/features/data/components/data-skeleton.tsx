import { Skeleton } from "@evertap/ui/components/skeleton";

import styles from "./data-skeleton.module.css";

const ROWS = ["a", "b", "c", "d", "e"];

export const DataSkeleton = () => (
  <section className={styles.skeleton}>
    <span className="sr-only">Loading</span>
    <div aria-hidden className={styles.header}>
      <Skeleton className={styles.back} />
      <Skeleton className={styles.title} />
      <Skeleton className={styles.engine} />
    </div>
    <div aria-hidden className={styles.rows}>
      {ROWS.map((key) => (
        <Skeleton key={key} className={styles.row} />
      ))}
    </div>
  </section>
);
