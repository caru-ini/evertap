// Imported `with { type: "text" }`: Bun's default loader would render the file to HTML.
declare module "*.md" {
  const text: string;
  export default text;
}
