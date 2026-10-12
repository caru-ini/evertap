import { CheckIcon } from "@phosphor-icons/react";
import { type ReactNode, useId } from "react";

import styles from "./choices.module.css";

export type Choice<Id extends string> = {
  id: Id;
  label: string;
  hint?: string;
  address?: string;
  icon?: ReactNode;
};

/** Native radios drawn as rows, each with a line on what it means. */
export const Choices = <Id extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: readonly Choice<Id>[];
  value: Id;
  onChange: (id: Id) => void;
}) => {
  const name = useId();

  return (
    <fieldset className={styles.choices}>
      <legend className={styles.legend}>{legend}</legend>
      {options.map((option) => (
        <label key={option.id} className={styles.choice}>
          <input
            type="radio"
            name={name}
            value={option.id}
            checked={option.id === value}
            onChange={() => {
              onChange(option.id);
            }}
            className="sr-only"
          />
          {option.icon ? <span className={styles.choiceIcon}>{option.icon}</span> : null}
          <span className={styles.choiceText}>
            <span className={styles.choiceLabel}>
              {option.label}
              {option.address ? <code className={styles.address}>{option.address}</code> : null}
            </span>
            {option.hint ? <span className={styles.choiceHint}>{option.hint}</span> : null}
          </span>
          <CheckIcon aria-hidden weight="bold" className={styles.choiceCheck} />
        </label>
      ))}
    </fieldset>
  );
};
