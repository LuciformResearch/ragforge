export type Preprocessor = (input: string) => string;

const preprocessors: Record<string, Preprocessor> = {
  normalizeWhitespace: (input: string) => input.replace(/\s+/g, ' ').trim(),
  camelCaseSplit: (input: string) => input.replace(/([a-z0-9])([A-Z])/g, '$1 $2'),
  stripComments: (input: string) =>
    input
      // Block comments
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Line comments
      .replace(/(^|\s)\/\/.*$/gm, '')
      .trim()
};

export function applyPreprocessors(text: string, names: string[] = []): string {
  return names.reduce((acc, name) => {
    const processor = preprocessors[name];
    if (!processor) {
      console.warn(`⚠️  Unknown preprocessor: ${name}`);
      return acc;
    }
    return processor(acc);
  }, text);
}
