import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

export const TokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
  userId: z.string(),
  email: z.string(),
});

export type Tokens = z.infer<typeof TokensSchema>;

export interface CredentialStore {
  read(): Promise<Tokens | null>;
  write(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

const DEFAULT_PATH = join(homedir(), ".config", "brief", "credentials.json");

export function createInMemoryStore(): CredentialStore {
  let state: Tokens | null = null;
  return {
    async read() {
      return state ? { ...state } : null;
    },
    async write(tokens) {
      state = { ...tokens };
    },
    async clear() {
      state = null;
    },
  };
}

export function createFilesystemStore(path: string = DEFAULT_PATH): CredentialStore {
  return {
    async read() {
      try {
        const content = await readFile(path, "utf-8");
        const raw = JSON.parse(content);
        const parsed = TokensSchema.safeParse(raw);
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    async write(tokens) {
      await mkdir(dirname(path), { recursive: true });
      const tmpPath = `${path}.tmp.${process.pid}`;
      await writeFile(tmpPath, JSON.stringify(tokens), { mode: 0o600 });
      await rename(tmpPath, path);
    },
    async clear() {
      try {
        await unlink(path);
      } catch {
        // already absent — clear is idempotent
      }
    },
  };
}
