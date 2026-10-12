import { Button } from "@evertap/ui/components/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@evertap/ui/components/input-group";
import { Skeleton } from "@evertap/ui/components/skeleton";
import { Spinner } from "@evertap/ui/components/spinner";
import { MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";

import { orpc } from "@/lib/orpc.ts";

import { REDIS_TYPES, formatTtl } from "../redis-draft.ts";
import { KeyDetail } from "./key-detail.tsx";
import { LoadError } from "./load-error.tsx";
import { NewKeyDialog } from "./new-key-dialog.tsx";

import styles from "./key-browser.module.css";

const SCAN_COUNT = 100;
const SKELETON = ["a", "b", "c", "d", "e"];

const typeLabel = (type: string) => REDIS_TYPES.find((item) => item.id === type)?.label ?? type;

/** Redis: SCAN by pattern on one side, the chosen key's value on the other. */
export const KeyBrowser = ({ id, selectedKey }: { id: string; selectedKey?: string }) => {
  const navigate = useNavigate();
  const [typed, setTyped] = useState("*");
  const [pattern, setPattern] = useState("*");
  const [creating, setCreating] = useState(false);
  const detail = useRef<HTMLDivElement>(null);
  const help = useId();
  const keys = useInfiniteQuery(
    orpc.data.keys.infiniteOptions({
      input: (cursor: string) => ({ id, pattern, cursor, count: SCAN_COUNT }),
      initialPageParam: "0",
      getNextPageParam: (last) => (last.cursor === "0" ? undefined : last.cursor),
    }),
  );
  // SCAN may return a key twice across pages.
  const found = [
    ...new Map(
      (keys.data?.pages ?? []).flatMap((page) => page.keys).map((item) => [item.key, item]),
    ).values(),
  ];

  // Stacked on a narrow screen the value sits below the list; bring it into view when picked.
  useEffect(() => {
    const element = detail.current;
    if (
      selectedKey !== undefined &&
      element &&
      element.getBoundingClientRect().top > window.innerHeight
    ) {
      element.scrollIntoView({ block: "start" });
    }
  }, [selectedKey]);

  const open = (key: string | undefined) =>
    navigate({ to: "/resources/$id/data", params: { id }, search: { key } });

  return (
    <div className={styles.browser}>
      <div className={styles.toolbar}>
        <form
          role="search"
          className={styles.search}
          onSubmit={(event) => {
            event.preventDefault();
            setPattern(typed.trim() === "" ? "*" : typed.trim());
          }}
        >
          <InputGroup className={styles.pattern}>
            <InputGroupAddon>
              <MagnifyingGlassIcon aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
              }}
              aria-label="Key pattern"
              aria-describedby={help}
              placeholder="user:*"
              autoComplete="off"
              spellCheck={false}
              className={styles.patternInput}
            />
          </InputGroup>
          <Button type="submit" variant="outline" size="lg">
            Search
          </Button>
        </form>
        <Button
          size="lg"
          className={styles.newKey}
          onClick={() => {
            setCreating(true);
          }}
        >
          <PlusIcon />
          New key
        </Button>
      </div>
      <p id={help} className={styles.help}>
        <span className={styles.wildcard}>*</span> matches any run of characters,{" "}
        <span className={styles.wildcard}>?</span> one character.
      </p>

      <div className={styles.split}>
        <div className={styles.list}>
          {keys.isError ? (
            <LoadError
              error={keys.error}
              retrying={keys.isFetching}
              onRetry={() => {
                void keys.refetch();
              }}
            />
          ) : keys.data === undefined ? (
            <div aria-hidden className={styles.skeletons}>
              {SKELETON.map((key) => (
                <Skeleton key={key} className={styles.skeletonKey} />
              ))}
            </div>
          ) : (
            <>
              <p className={styles.count}>
                Keys
                <span className={styles.countValue}>
                  {found.length}
                  {keys.hasNextPage ? "+" : ""}
                </span>
                {keys.isFetching ? <Spinner className={styles.countSpinner} /> : null}
              </p>
              {found.length > 0 ? (
                <ul aria-label="Keys" className={styles.keys}>
                  {found.map((item) => (
                    <li key={item.key}>
                      <Link
                        to="/resources/$id/data"
                        params={{ id }}
                        search={{ key: item.key }}
                        aria-current={item.key === selectedKey ? "page" : undefined}
                        title={item.key}
                        className={styles.key}
                      >
                        <span className={styles.keyName}>{item.key}</span>
                        <span className={styles.keyType}>
                          {typeLabel(item.type)}
                          {item.ttlMs === null ? "" : ` · ${formatTtl(item.ttlMs)}`}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>
                  {keys.hasNextPage
                    ? "No matches in this part of the scan. Load more to keep looking."
                    : pattern === "*"
                      ? "No keys yet. Create one with New key."
                      : "No key matches. Try a broader pattern, such as adding *."}
                </p>
              )}
              {keys.hasNextPage ? (
                <Button
                  variant="ghost"
                  className={styles.loadMore}
                  disabled={keys.isFetchingNextPage}
                  onClick={() => {
                    void keys.fetchNextPage();
                  }}
                >
                  {keys.isFetchingNextPage ? <Spinner /> : null}
                  Load more
                </Button>
              ) : null}
            </>
          )}
        </div>

        <div ref={detail} className={styles.detail}>
          {selectedKey === undefined ? (
            <p className={styles.placeholder}>
              Choose a key to see and edit its value, or create one with New key.
            </p>
          ) : (
            <KeyDetail
              key={selectedKey}
              id={id}
              keyName={selectedKey}
              onDeleted={() => open(undefined)}
            />
          )}
        </div>
      </div>

      <NewKeyDialog
        id={id}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(key) => {
          void open(key);
        }}
      />
    </div>
  );
};
