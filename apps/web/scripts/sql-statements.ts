/**
 * Splits a SQL script into the statements a driver can run one at a time.
 *
 * A naive split on `;` breaks the house style of this repo, where migrations
 * carry prose comments above non-obvious columns: one semicolon in that prose
 * chops the statement below it in half. So this scanner walks the text and
 * only splits on a semicolon it meets in ordinary code, skipping over `--`
 * line comments, `/* *\/` block comments (which nest in Postgres), single-quoted
 * literals, double-quoted identifiers, and dollar-quoted bodies.
 *
 * Statements come back trimmed and without their trailing semicolon. A chunk
 * holding nothing but comments and whitespace is dropped. Unterminated input
 * is returned as-is so Postgres reports the syntax error itself.
 */

/** `$$` or `$tag$`, anchored at the current position. */
const DOLLAR_QUOTE_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/**
 * True when the quote at `index` opens an `E'...'` literal, where a backslash
 * escapes the character after it (including a closing quote).
 */
function opensEscapeStringLiteral(sql: string, index: number): boolean {
  const prev = sql[index - 1];
  if (prev !== "e" && prev !== "E") return false;
  const beforePrev = sql[index - 2];
  return beforePrev === undefined || !/[A-Za-z0-9_$]/.test(beforePrev);
}

/** Index just past the closing `*\/` of the block comment opening at `index`. */
function endOfBlockComment(sql: string, index: number): number {
  let depth = 0;
  let i = index;
  while (i < sql.length) {
    if (sql[i] === "/" && sql[i + 1] === "*") {
      depth++;
      i += 2;
      continue;
    }
    if (sql[i] === "*" && sql[i + 1] === "/") {
      depth--;
      i += 2;
      if (depth === 0) return i;
      continue;
    }
    i++;
  }
  return sql.length;
}

/** Index just past the closing quote of the literal or identifier at `index`. */
function endOfQuoted(sql: string, index: number, quote: '"' | "'"): number {
  const backslashEscapes = quote === "'" && opensEscapeStringLiteral(sql, index);
  let i = index + 1;
  while (i < sql.length) {
    const char = sql[i];
    if (backslashEscapes && char === "\\") {
      i += 2;
      continue;
    }
    if (char === quote) {
      // A doubled quote is an escaped quote, not the end of the run.
      if (sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return sql.length;
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  // Whether the chunk so far holds anything but comments and whitespace.
  let hasCode = false;
  let i = 0;

  function endStatement(): void {
    if (hasCode) {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
    }
    current = "";
    hasCode = false;
  }

  while (i < sql.length) {
    const char = sql[i];
    const nextChar = sql[i + 1];

    if (char === "-" && nextChar === "-") {
      const newline = sql.indexOf("\n", i);
      const end = newline === -1 ? sql.length : newline;
      current += sql.slice(i, end);
      i = end;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      const end = endOfBlockComment(sql, i);
      current += sql.slice(i, end);
      i = end;
      continue;
    }

    if (char === "'" || char === '"') {
      const end = Math.min(endOfQuoted(sql, i, char), sql.length);
      current += sql.slice(i, end);
      i = end;
      hasCode = true;
      continue;
    }

    if (char === "$") {
      const tag = DOLLAR_QUOTE_TAG.exec(sql.slice(i))?.[0];
      // No tag means this is something like a `$1` placeholder: ordinary text.
      if (tag) {
        const close = sql.indexOf(tag, i + tag.length);
        const end = close === -1 ? sql.length : close + tag.length;
        current += sql.slice(i, end);
        i = end;
        hasCode = true;
        continue;
      }
    }

    if (char === ";") {
      endStatement();
      i++;
      continue;
    }

    current += char;
    if (!/\s/.test(char)) hasCode = true;
    i++;
  }

  endStatement();
  return statements;
}
