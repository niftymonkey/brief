import { describe, expect, it } from "vitest";
import { splitSqlStatements } from "./sql-statements";

describe("splitSqlStatements", () => {
  it("splits two plain statements on the semicolon between them", () => {
    expect(splitSqlStatements("SELECT 1;\nSELECT 2;")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("returns the final statement when it has no trailing semicolon", () => {
    expect(splitSqlStatements("SELECT 1;\nSELECT 2")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("returns nothing for whitespace alone", () => {
    expect(splitSqlStatements("  \n\t\n")).toEqual([]);
  });

  it("returns nothing for a stray semicolon", () => {
    expect(splitSqlStatements(";;\n;")).toEqual([]);
  });
});

describe("line comments", () => {
  it("keeps a statement whole when a prose comment above it contains a semicolon", () => {
    const sql = [
      "-- Topics own their channels; a channel may belong to several topics.",
      "CREATE TABLE topics (id UUID PRIMARY KEY);",
    ].join("\n");

    expect(splitSqlStatements(sql)).toEqual([
      "-- Topics own their channels; a channel may belong to several topics.\n" +
        "CREATE TABLE topics (id UUID PRIMARY KEY)",
    ]);
  });

  it("keeps a statement whole when a trailing comment on a column line contains a semicolon", () => {
    const sql = [
      "ALTER TABLE topics",
      "  ADD COLUMN slug TEXT; -- unique per user; blank until the first save",
      "ALTER TABLE topics ADD COLUMN name TEXT;",
    ].join("\n");

    expect(splitSqlStatements(sql)).toEqual([
      "ALTER TABLE topics\n  ADD COLUMN slug TEXT",
      "-- unique per user; blank until the first save\nALTER TABLE topics ADD COLUMN name TEXT",
    ]);
  });

  it("drops a chunk that is only a comment", () => {
    expect(splitSqlStatements("-- just a note; nothing to run\n")).toEqual([]);
  });

  it("does not start a comment on a single dash", () => {
    expect(splitSqlStatements("SELECT 1 - 2;")).toEqual(["SELECT 1 - 2"]);
  });
});

describe("block comments", () => {
  it("ignores a semicolon inside a block comment", () => {
    const sql = "/* first; second */ SELECT 1;";

    expect(splitSqlStatements(sql)).toEqual(["/* first; second */ SELECT 1"]);
  });

  it("ignores a semicolon inside a nested block comment", () => {
    const sql = "/* outer /* inner; */ still commented; */ SELECT 1;";

    expect(splitSqlStatements(sql)).toEqual([
      "/* outer /* inner; */ still commented; */ SELECT 1",
    ]);
  });

  it("drops a chunk that is only a block comment", () => {
    expect(splitSqlStatements("/* nothing; here */\n")).toEqual([]);
  });
});

describe("string literals and quoted identifiers", () => {
  it("ignores a semicolon inside a single-quoted literal", () => {
    expect(splitSqlStatements("INSERT INTO t VALUES ('a;b');")).toEqual([
      "INSERT INTO t VALUES ('a;b')",
    ]);
  });

  it("stays inside the literal across a doubled single quote", () => {
    expect(splitSqlStatements("SELECT 'it''s; fine';")).toEqual(["SELECT 'it''s; fine'"]);
  });

  it("ignores a dash pair inside a single-quoted literal", () => {
    expect(splitSqlStatements("SELECT '-- not a comment';\nSELECT 2;")).toEqual([
      "SELECT '-- not a comment'",
      "SELECT 2",
    ]);
  });

  it("honours a backslash escape inside an E'' literal", () => {
    expect(splitSqlStatements("SELECT E'a\\'; b';")).toEqual(["SELECT E'a\\'; b'"]);
  });

  it("ignores a semicolon inside a double-quoted identifier", () => {
    expect(splitSqlStatements('SELECT "odd;name" FROM t;')).toEqual([
      'SELECT "odd;name" FROM t',
    ]);
  });

  it("stays inside the identifier across a doubled double quote", () => {
    expect(splitSqlStatements('SELECT "a""b;c" FROM t;')).toEqual(['SELECT "a""b;c" FROM t']);
  });
});

describe("dollar-quoted bodies", () => {
  it("keeps a $$ function body in one statement", () => {
    const sql = [
      "CREATE FUNCTION touch() RETURNS TRIGGER AS $$",
      "BEGIN",
      "  NEW.updated_at = NOW();",
      "  RETURN NEW;",
      "END;",
      "$$ LANGUAGE plpgsql;",
      "SELECT 1;",
    ].join("\n");

    expect(splitSqlStatements(sql)).toEqual([
      "CREATE FUNCTION touch() RETURNS TRIGGER AS $$\nBEGIN\n  NEW.updated_at = NOW();\n" +
        "  RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql",
      "SELECT 1",
    ]);
  });

  it("keeps a tagged $body$ body in one statement", () => {
    const sql = "CREATE FUNCTION f() RETURNS INT AS $body$ SELECT 1; $body$ LANGUAGE sql;";

    expect(splitSqlStatements(sql)).toEqual([
      "CREATE FUNCTION f() RETURNS INT AS $body$ SELECT 1; $body$ LANGUAGE sql",
    ]);
  });

  it("does not close a tagged body on a bare $$", () => {
    const sql = "SELECT $tag$ a $$ b; $tag$;\nSELECT 2;";

    expect(splitSqlStatements(sql)).toEqual(["SELECT $tag$ a $$ b; $tag$", "SELECT 2"]);
  });

  it("ignores a comment marker inside a dollar-quoted body", () => {
    const sql = "SELECT $$ -- not a comment $$;\nSELECT 2;";

    expect(splitSqlStatements(sql)).toEqual(["SELECT $$ -- not a comment $$", "SELECT 2"]);
  });

  it("treats a positional parameter as ordinary text, not a dollar quote", () => {
    expect(splitSqlStatements("SELECT * FROM t WHERE id = $1;\nSELECT 2;")).toEqual([
      "SELECT * FROM t WHERE id = $1",
      "SELECT 2",
    ]);
  });
});

describe("unterminated input", () => {
  it("returns the remainder when a literal is never closed, leaving the error to Postgres", () => {
    expect(splitSqlStatements("SELECT 'unclosed;")).toEqual(["SELECT 'unclosed;"]);
  });

  it("returns the remainder when a dollar-quoted body is never closed", () => {
    expect(splitSqlStatements("SELECT $$ unclosed;")).toEqual(["SELECT $$ unclosed;"]);
  });
});
