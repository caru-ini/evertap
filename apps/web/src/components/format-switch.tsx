import { buttonVariants } from "@evertap/ui/components/button";
import { cx } from "@evertap/ui/lib/cx";
import type { Icon } from "@phosphor-icons/react";
import { useId } from "react";

import styles from "./format-switch.module.css";

/** Native radios styled as buttons: one Tab stop per group, arrow keys change the selection. */
export const FormatSwitch = <Id extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: readonly { id: Id; label: string; mono?: boolean; icon?: Icon }[];
  value: Id;
  onChange: (id: Id) => void;
}) => {
  const name = useId();

  return (
    <fieldset className={styles.switch}>
      <legend className="sr-only">{legend}</legend>
      {options.map((item) => (
        <label key={item.id} className={styles.choice}>
          <input
            type="radio"
            name={name}
            value={item.id}
            checked={item.id === value}
            onChange={() => {
              onChange(item.id);
            }}
            className="sr-only"
          />
          <span
            className={buttonVariants({
              variant: item.id === value ? "secondary" : "ghost",
              size: "default",
              className: cx(
                styles.option,
                item.mono && styles.mono,
                item.id !== value && styles.unselected,
              ),
            })}
          >
            {item.icon ? <item.icon aria-hidden /> : null}
            {item.label}
          </span>
        </label>
      ))}
    </fieldset>
  );
};
