import { InputGroup, InputGroupAddon, InputGroupInput } from "@evertap/ui/components/input-group";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";

import styles from "./name-filter.module.css";

/** Narrows a long list to the names that contain what is typed. */
export const NameFilter = ({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) => (
  <InputGroup className={styles.filter}>
    <InputGroupAddon>
      <MagnifyingGlassIcon aria-hidden />
    </InputGroupAddon>
    <InputGroupInput
      type="search"
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      placeholder="Filter by name"
      aria-label={label}
      autoComplete="off"
      spellCheck={false}
    />
  </InputGroup>
);
