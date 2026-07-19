declare module "wink-lemmatizer" {
  const noun: (w: string) => string;
  const verb: (w: string) => string;
  const adjective: (w: string) => string;
  export { noun, verb, adjective };
  const _default: { noun: typeof noun; verb: typeof verb; adjective: typeof adjective };
  export default _default;
}
