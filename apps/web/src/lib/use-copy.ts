import { useEffect, useState } from "react";
import { toast } from "sonner";

import { copyText } from "@/lib/clipboard.ts";

const COPIED_MS = 2500;

/** Copies and holds `copied` for a moment; the caller's icon swap is the feedback, so success has no toast. */
export const useCopy = () => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = copied
      ? setTimeout(() => {
          setCopied(false);
        }, COPIED_MS)
      : undefined;
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  const copy = async (value: string) => {
    if (await copyText(value)) {
      setCopied(true);
    } else {
      toast.error("Couldn't copy. Select the value and copy it by hand.");
    }
  };

  return { copied, copy };
};
