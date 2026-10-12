import { Skeleton } from "@evertap/ui/components/skeleton";

import styles from "./resources-skeleton.module.css";

const ROWS = ["first", "second", "third", "fourth"];

export const ResourcesSkeleton = () => (
  <section className={styles.skeleton}>
    <span className="sr-only">Loading</span>
    <div aria-hidden className={styles.head}>
      <Skeleton className={styles.title} />
      <Skeleton className={styles.button} />
    </div>
    <ul aria-hidden className={styles.rows}>
      {ROWS.map((key) => (
        <li key={key} className={styles.row}>
          <Skeleton className={styles.name} />
          <Skeleton className={styles.meta} />
        </li>
      ))}
    </ul>
  </section>
);
