import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFilesystemStore,
  createInMemoryStore,
  type CredentialStore,
  type Tokens,
} from "./credentials";

const sampleTokens: Tokens = {
  accessToken: "access-abc",
  refreshToken: "refresh-xyz",
  expiresAt: 1_700_000_000, // seconds since epoch (2023-11)
  userId: "user_01H7ZZZ",
  email: "user@example.com",
};

describe.each([
  {
    name: "in-memory",
    makeStore: async (): Promise<{ store: CredentialStore; cleanup: () => Promise<void> }> => ({
      store: createInMemoryStore(),
      cleanup: async () => {},
    }),
  },
  {
    name: "filesystem",
    makeStore: async (): Promise<{ store: CredentialStore; cleanup: () => Promise<void> }> => {
      const dir = await mkdtemp(join(tmpdir(), "brief-creds-"));
      const path = join(dir, "credentials.json");
      return {
        store: createFilesystemStore(path),
        cleanup: async () => {
          await rm(dir, { recursive: true, force: true });
        },
      };
    },
  },
])("CredentialStore contract: $name", ({ makeStore }) => {
  let store: CredentialStore;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ store, cleanup } = await makeStore());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns null when nothing stored", async () => {
    expect(await store.read()).toBeNull();
  });

  it("round-trips tokens through write/read", async () => {
    await store.write(sampleTokens);
    expect(await store.read()).toEqual(sampleTokens);
  });

  it("clear removes stored tokens", async () => {
    await store.write(sampleTokens);
    await store.clear();
    expect(await store.read()).toBeNull();
  });

  it("write overwrites previous tokens", async () => {
    await store.write(sampleTokens);
    const newer: Tokens = { ...sampleTokens, accessToken: "access-new" };
    await store.write(newer);
    expect(await store.read()).toEqual(newer);
  });

  it("clear is idempotent (no-op when empty)", async () => {
    await expect(store.clear()).resolves.not.toThrow();
    await store.clear();
    expect(await store.read()).toBeNull();
  });

  it("does not leak external mutations back into the store", async () => {
    const mutable = { ...sampleTokens };
    await store.write(mutable);
    mutable.accessToken = "tampered";
    const read = await store.read();
    expect(read?.accessToken).toBe(sampleTokens.accessToken);
  });
});

describe("createFilesystemStore", () => {
  let dir: string;
  let storePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "brief-creds-fs-"));
    storePath = join(dir, "credentials.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes the credentials file with 0600 perms", async () => {
    const store = createFilesystemStore(storePath);
    await store.write(sampleTokens);
    const stats = await stat(storePath);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it("creates parent directories when missing", async () => {
    const deepPath = join(dir, "nested", "deep", "credentials.json");
    const store = createFilesystemStore(deepPath);
    await store.write(sampleTokens);
    expect(await store.read()).toEqual(sampleTokens);
  });

  it("returns null when the credentials file is malformed JSON", async () => {
    await writeFile(storePath, "not-json-at-all", { mode: 0o600 });
    const store = createFilesystemStore(storePath);
    expect(await store.read()).toBeNull();
  });

  it("returns null when the credentials file has the wrong shape", async () => {
    await writeFile(storePath, JSON.stringify({ accessToken: "abc" }), { mode: 0o600 });
    const store = createFilesystemStore(storePath);
    expect(await store.read()).toBeNull();
  });

  it("returns null when fields have wrong types", async () => {
    await writeFile(
      storePath,
      JSON.stringify({ ...sampleTokens, expiresAt: "not-a-number" }),
      { mode: 0o600 },
    );
    const store = createFilesystemStore(storePath);
    expect(await store.read()).toBeNull();
  });

  it("invalidates legacy credentials whose expiresAt was written in milliseconds", async () => {
    // 1.7e12 = ms in 2023; interpreted as seconds it's year 55,830. The threshold
    // catches anything clearly out of range so the user is prompted to re-login.
    await writeFile(
      storePath,
      JSON.stringify({ ...sampleTokens, expiresAt: 1_700_000_000_000 }),
      { mode: 0o600 },
    );
    const store = createFilesystemStore(storePath);
    expect(await store.read()).toBeNull();
  });

  it("write is atomic: a crash mid-write does not leave a corrupted credentials file", async () => {
    const store = createFilesystemStore(storePath);
    await store.write(sampleTokens);
    const original = await readFile(storePath, "utf-8");
    expect(JSON.parse(original)).toEqual(sampleTokens);

    const newer: Tokens = { ...sampleTokens, accessToken: "rotated" };
    await store.write(newer);
    const current = await readFile(storePath, "utf-8");
    expect(JSON.parse(current)).toEqual(newer);
  });
});
