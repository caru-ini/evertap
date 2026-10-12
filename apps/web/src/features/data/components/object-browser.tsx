import { Button } from "@evertap/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@evertap/ui/components/dropdown-menu";
import { Skeleton } from "@evertap/ui/components/skeleton";
import { Spinner } from "@evertap/ui/components/spinner";
import {
  CaretDownIcon,
  DownloadSimpleIcon,
  FileIcon,
  FolderIcon,
  FolderSimpleIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useRef, useState } from "react";
import { toast } from "sonner";

import { formatBytes, formatTimeAgo } from "@/lib/format.ts";
import { orpc } from "@/lib/orpc.ts";
import { useNow } from "@/lib/use-now.ts";

import { errorMessage } from "../error-message.ts";
import { UPLOAD_MAX, uploadObject } from "../upload-object.ts";
import { DeleteObjectDialog } from "./delete-object-dialog.tsx";
import { LoadError } from "./load-error.tsx";

import styles from "./object-browser.module.css";

const SKELETON = ["a", "b", "c", "d", "e"];
const EMPTY_FOLDER = "That folder has no files. Pick a folder with files in it";
const TOO_LARGE = `Files over ${formatBytes(UPLOAD_MAX)} can't be uploaded. Split the file, then upload the pieces`;

/** `a/b/` → the bucket, then `a/`, then `a/b/`: each a place to go back to. */
const crumbs = (prefix: string) => {
  const parts = prefix.split("/").filter((part) => part !== "");
  return parts.map((part, index) => ({
    label: part,
    prefix: `${parts.slice(0, index + 1).join("/")}/`,
  }));
};

/**
 * A bucket, one folder at a time: `/` in keys reads as folders, as S3 consoles show them. The
 * resource's other buckets, those its apps made, are a switch away beside the bucket's name.
 */
export const ObjectBrowser = ({
  id,
  first,
  bucket,
  prefix,
}: {
  id: string;
  /** The resource's first bucket, its name. */
  first: string;
  /** The bucket shown; undefined for the first. */
  bucket: string | undefined;
  prefix: string;
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const buckets = useQuery(orpc.data.buckets.queryOptions({ input: { id } }));
  const now = useNow();
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  /** Share of the bytes in the current batch that have landed, 0–100. */
  const [progress, setProgress] = useState(0);
  const listing = useInfiniteQuery(
    orpc.data.objects.infiniteOptions({
      input: (cursor: string | undefined) => ({ id, bucket, prefix, cursor }),
      initialPageParam: undefined,
      getNextPageParam: (last) => last.cursor ?? undefined,
    }),
  );
  const pages = listing.data?.pages ?? [];
  const folders = pages.flatMap((page) => page.folders);
  const objects = pages.flatMap((page) => page.objects);

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const total = files.reduce((sum, file) => sum + file.size, 0);
      let sent = 0;
      setProgress(0);
      for (const file of files) {
        await uploadObject({
          id,
          bucket,
          // A folder's files carry their path inside it, so its structure is kept under `prefix`.
          key: `${prefix}${file.webkitRelativePath || file.name}`,
          file,
          onSent: (bytes) => {
            sent += bytes;
            setProgress(total === 0 ? 100 : Math.floor((sent / total) * 100));
          },
        });
      }
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: orpc.data.objects.key() }),
  });

  const pick = (files: File[]) => {
    const fitting = files.filter((file) => file.size <= UPLOAD_MAX);
    if (fitting.length < files.length) {
      toast.error(TOO_LARGE);
    }
    if (fitting.length > 0) {
      upload.mutate(fitting);
    }
  };

  const download = useMutation(
    orpc.data.objectUrl.mutationOptions({
      onSuccess: ({ url }) => {
        // The link answers with an attachment, so the page stays where it is.
        window.location.assign(url);
      },
      onError: (error) => {
        toast.error(errorMessage(error));
      },
    }),
  );

  return (
    <div className={styles.browser}>
      <div className={styles.toolbar}>
        <nav aria-label="Folder" className={styles.crumbs}>
          <Link
            to="/resources/$id/data"
            params={{ id }}
            search={{ bucket, prefix: undefined }}
            aria-current={prefix === "" ? "page" : undefined}
            className={styles.crumb}
          >
            {bucket ?? first}
          </Link>
          {(buckets.data?.length ?? 0) > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-sm" title="Other buckets" />}
              >
                <CaretDownIcon aria-hidden />
                <span className="sr-only">Other buckets</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent className={styles.bucketMenu}>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Buckets</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={bucket ?? first}
                    onValueChange={(value: string) => {
                      void navigate({
                        to: "/resources/$id/data",
                        params: { id },
                        search: { bucket: value === first ? undefined : value },
                      });
                    }}
                  >
                    {buckets.data?.map((name) => (
                      <DropdownMenuRadioItem key={name} value={name} closeOnClick>
                        {name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {crumbs(prefix).map((crumb) => (
            <Fragment key={crumb.prefix}>
              <span aria-hidden className={styles.separator}>
                /
              </span>
              <Link
                to="/resources/$id/data"
                params={{ id }}
                search={{ bucket, prefix: crumb.prefix }}
                aria-current={crumb.prefix === prefix ? "page" : undefined}
                className={styles.crumb}
              >
                {crumb.label}
              </Link>
            </Fragment>
          ))}
        </nav>
        <input
          ref={filesInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            pick(files);
          }}
        />
        <input
          ref={(node) => {
            folderInput.current = node;
            // React has no typed prop for this attribute.
            if (node) node.webkitdirectory = true;
          }}
          type="file"
          hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            if (files.length === 0) {
              toast.error(EMPTY_FOLDER);
              return;
            }
            pick(files);
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button size="lg" className={styles.upload} disabled={upload.isPending} />}
          >
            {upload.isPending ? <Spinner /> : <UploadSimpleIcon />}
            {upload.isPending ? `Uploading ${progress}%` : "Upload"}
            {upload.isPending ? null : <CaretDownIcon aria-hidden />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={styles.uploadMenu}>
            <DropdownMenuItem
              onClick={() => {
                filesInput.current?.click();
              }}
            >
              <FileIcon />
              Files
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                folderInput.current?.click();
              }}
            >
              <FolderSimpleIcon />
              Folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className={styles.list}>
        {listing.isError ? (
          <LoadError
            error={listing.error}
            retrying={listing.isFetching}
            onRetry={() => {
              void listing.refetch();
            }}
          />
        ) : listing.data === undefined ? (
          <div aria-hidden className={styles.skeletons}>
            {SKELETON.map((key) => (
              <Skeleton key={key} className={styles.skeletonRow} />
            ))}
          </div>
        ) : folders.length === 0 && objects.length === 0 ? (
          <p className={styles.empty}>
            {prefix === ""
              ? "No objects yet. Add files with Upload."
              : "This folder is empty. Add files with Upload."}
          </p>
        ) : (
          <>
            <div aria-hidden className={styles.header}>
              <span>Name</span>
              <span className={styles.typeHeader}>Type</span>
              <span className={styles.sizeHeader}>Size</span>
              <span className={styles.modifiedHeader}>Modified</span>
            </div>
            <ul aria-label="Objects" className={styles.rows}>
              {folders.map((folder) => (
                <li key={folder} className={styles.row}>
                  <Link
                    to="/resources/$id/data"
                    params={{ id }}
                    search={{ bucket, prefix: folder }}
                    className={styles.folder}
                  >
                    <FolderIcon aria-hidden weight="fill" className={styles.folderIcon} />
                    <span className={styles.name}>{folder.slice(prefix.length)}</span>
                  </Link>
                </li>
              ))}
              {objects.map((object) => (
                <li key={object.key} className={styles.row}>
                  <span className={styles.object} title={object.key}>
                    <FileIcon aria-hidden className={styles.fileIcon} />
                    <span className={styles.name}>{object.key.slice(prefix.length)}</span>
                  </span>
                  <span className={styles.type} title={object.contentType ?? undefined}>
                    {object.contentType ?? "—"}
                  </span>
                  <span className={styles.size}>{formatBytes(object.sizeBytes)}</span>
                  <span className={styles.modified}>{formatTimeAgo(object.lastModified, now)}</span>
                  <span className={styles.actions}>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Download ${object.key}`}
                      title="Download"
                      disabled={download.isPending}
                      onClick={() => {
                        download.mutate({ id, bucket, key: object.key });
                      }}
                    >
                      <DownloadSimpleIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${object.key}`}
                      title="Delete"
                      onClick={() => {
                        setDeleting(object.key);
                      }}
                    >
                      <TrashIcon />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
            {listing.hasNextPage ? (
              <Button
                variant="ghost"
                className={styles.loadMore}
                disabled={listing.isFetchingNextPage}
                onClick={() => {
                  void listing.fetchNextPage();
                }}
              >
                {listing.isFetchingNextPage ? <Spinner /> : null}
                Load more
              </Button>
            ) : null}
          </>
        )}
      </div>

      <DeleteObjectDialog
        id={id}
        bucket={bucket}
        objectKey={deleting}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
          }
        }}
      />
    </div>
  );
};
