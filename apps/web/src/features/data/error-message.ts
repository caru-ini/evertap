/** The engine's or the API's own words; a dropped connection gets the next action instead. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message !== "Failed to fetch"
    ? error.message
    : "Couldn't reach evertap. Check that you're on the same network, then try again.";
