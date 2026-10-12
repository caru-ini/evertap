/** Joins the class names that are strings; Base UI's function form of className is not merged. */
export const cx = (...parts: unknown[]) =>
  parts.filter((part): part is string => typeof part === "string" && part !== "").join(" ");
