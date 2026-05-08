const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const ENTITY = /&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|([a-zA-Z]+));/g;

export function decodeHtmlEntities(input: string): string {
  let prev: string;
  let curr = input;
  let iterations = 0;
  do {
    prev = curr;
    curr = curr.replace(ENTITY, (match, hex, dec, name) => {
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      if (dec) return String.fromCodePoint(parseInt(dec, 10));
      const char = NAMED[name as string];
      return char ?? match;
    });
    iterations += 1;
  } while (curr !== prev && iterations < 5);
  return curr;
}
