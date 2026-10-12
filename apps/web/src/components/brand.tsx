import { Logo } from "@evertap/ui/components/logo";
import { cx } from "@evertap/ui/lib/cx";
import { Link } from "@tanstack/react-router";

import styles from "./brand.module.css";

export const Brand = ({ className }: { className?: string }) => (
  <Link to="/" className={cx(styles.brand, className)}>
    <Logo />
  </Link>
);
