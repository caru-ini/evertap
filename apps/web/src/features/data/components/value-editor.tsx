import { Button } from "@evertap/ui/components/button";
import { Input } from "@evertap/ui/components/input";
import { Textarea } from "@evertap/ui/components/textarea";
import { cx } from "@evertap/ui/lib/cx";
import { PlusIcon, XIcon } from "@phosphor-icons/react";

import type { RedisDraft } from "../redis-draft.ts";

import styles from "./value-editor.module.css";

const RemoveButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    aria-label={label}
    className={styles.remove}
    onClick={onClick}
  >
    <XIcon />
  </Button>
);

const AddButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <div>
    <Button type="button" variant="ghost" size="default" className={styles.add} onClick={onClick}>
      <PlusIcon />
      {label}
    </Button>
  </div>
);

const without = <T,>(items: T[], index: number) => items.filter((_, at) => at !== index);

const replace = <T,>(items: T[], index: number, item: T) =>
  items.map((current, at) => (at === index ? item : current));

/** Edits a Redis value in the shape its type has; `readOnly` shows it without add or remove. */
export const ValueEditor = ({
  draft,
  onChange,
  readOnly = false,
  label,
}: {
  draft: RedisDraft;
  onChange: (draft: RedisDraft) => void;
  readOnly?: boolean;
  /** Names the value for screen readers, such as the key. */
  label: string;
}) => {
  switch (draft.type) {
    case "string":
      return (
        <Textarea
          aria-label={`Value of ${label}`}
          value={draft.value}
          readOnly={readOnly}
          spellCheck={false}
          onChange={(event) => {
            onChange({ type: "string", value: event.target.value });
          }}
          className={cx(styles.value, styles.stringValue)}
        />
      );
    case "hash":
      return (
        <div className={styles.editor}>
          <div className={styles.fields}>
            <span className={styles.head}>Field</span>
            <span className={styles.head}>Value</span>
            <span />
            {draft.entries.map((entry, index) => (
              // Rows have no identity besides their place; fields may be renamed or repeated mid-edit.
              <div key={index} className={styles.entry}>
                <Textarea
                  rows={1}
                  aria-label={`Field ${index + 1}`}
                  value={entry.field}
                  readOnly={readOnly}
                  spellCheck={false}
                  onChange={(event) => {
                    onChange({
                      ...draft,
                      entries: replace(draft.entries, index, {
                        ...entry,
                        field: event.target.value,
                      }),
                    });
                  }}
                  className={styles.value}
                />
                <Textarea
                  rows={1}
                  aria-label={`Value of field ${index + 1}`}
                  value={entry.value}
                  readOnly={readOnly}
                  spellCheck={false}
                  onChange={(event) => {
                    onChange({
                      ...draft,
                      entries: replace(draft.entries, index, {
                        ...entry,
                        value: event.target.value,
                      }),
                    });
                  }}
                  className={styles.value}
                />
                {readOnly ? (
                  <span />
                ) : (
                  <RemoveButton
                    label={`Remove field ${index + 1}`}
                    onClick={() => {
                      onChange({ ...draft, entries: without(draft.entries, index) });
                    }}
                  />
                )}
              </div>
            ))}
          </div>
          {readOnly ? null : (
            <AddButton
              label="Add field"
              onClick={() => {
                onChange({ ...draft, entries: [...draft.entries, { field: "", value: "" }] });
              }}
            />
          )}
        </div>
      );
    case "list":
    case "set": {
      const items = draft.type === "list" ? draft.items : draft.members;
      const set = (next: string[]) => {
        onChange(
          draft.type === "list" ? { type: "list", items: next } : { type: "set", members: next },
        );
      };
      const noun = draft.type === "list" ? "item" : "member";
      return (
        <div className={styles.editor}>
          <ol className={styles.editor}>
            {items.map((item, index) => (
              // A list's order is its identity; equal items are allowed.
              <li key={index} className={styles.item}>
                {draft.type === "list" ? <span className={styles.index}>{index}</span> : null}
                <Textarea
                  rows={1}
                  aria-label={`${noun === "item" ? "Item" : "Member"} ${index + 1}`}
                  value={item}
                  readOnly={readOnly}
                  spellCheck={false}
                  onChange={(event) => {
                    set(replace(items, index, event.target.value));
                  }}
                  className={styles.value}
                />
                {readOnly ? null : (
                  <RemoveButton
                    label={`Remove ${noun} ${index + 1}`}
                    onClick={() => {
                      set(without(items, index));
                    }}
                  />
                )}
              </li>
            ))}
          </ol>
          {readOnly ? null : (
            <AddButton
              label={`Add ${noun}`}
              onClick={() => {
                set([...items, ""]);
              }}
            />
          )}
        </div>
      );
    }
    default:
      return (
        <div className={styles.editor}>
          <div className={styles.scores}>
            <span className={styles.head}>Score</span>
            <span className={styles.head}>Member</span>
            <span />
            {draft.members.map((item, index) => (
              // Scores repeat, and members may be renamed mid-edit; the place is the identity.
              <div key={index} className={styles.entry}>
                <Input
                  inputMode="decimal"
                  aria-label={`Score of member ${index + 1}`}
                  value={item.score}
                  readOnly={readOnly}
                  onChange={(event) => {
                    onChange({
                      ...draft,
                      members: replace(draft.members, index, {
                        ...item,
                        score: event.target.value,
                      }),
                    });
                  }}
                  className={styles.score}
                />
                <Textarea
                  rows={1}
                  aria-label={`Member ${index + 1}`}
                  value={item.member}
                  readOnly={readOnly}
                  spellCheck={false}
                  onChange={(event) => {
                    onChange({
                      ...draft,
                      members: replace(draft.members, index, {
                        ...item,
                        member: event.target.value,
                      }),
                    });
                  }}
                  className={styles.value}
                />
                {readOnly ? (
                  <span />
                ) : (
                  <RemoveButton
                    label={`Remove member ${index + 1}`}
                    onClick={() => {
                      onChange({ ...draft, members: without(draft.members, index) });
                    }}
                  />
                )}
              </div>
            ))}
          </div>
          {readOnly ? null : (
            <AddButton
              label="Add member"
              onClick={() => {
                onChange({ ...draft, members: [...draft.members, { member: "", score: "0" }] });
              }}
            />
          )}
        </div>
      );
  }
};
