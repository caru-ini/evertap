import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/lib/orpc.ts";

/** The chip leaving is the feedback; only failures speak. */
export const useKeepResource = () => {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.resources.keep.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.resources.key() });
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );
};
