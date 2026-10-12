// Vite's `?raw` import: the file's text, as it is.
declare module "*?raw" {
  const text: string;
  export default text;
}
