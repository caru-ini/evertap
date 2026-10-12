import { cx } from "@evertap/ui/lib/cx";

import styles from "./empty.module.css";

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="empty" className={cx(styles.empty, className)} {...props} />;
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="empty-header" className={cx(styles.header, className)} {...props} />;
}

const MEDIA_VARIANTS = {
  default: styles.mediaDefault,
  icon: styles.mediaIcon,
};

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { variant?: keyof typeof MEDIA_VARIANTS | null }) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cx(styles.media, MEDIA_VARIANTS[variant ?? "default"], className)}
      {...props}
    />
  );
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="empty-title" className={cx(styles.title, className)} {...props} />;
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div data-slot="empty-description" className={cx(styles.description, className)} {...props} />
  );
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="empty-content" className={cx(styles.content, className)} {...props} />;
}

export { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia };
