import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MAIN_SOURCE_PATH = new URL("./main.ts", import.meta.url);

test("desktop auth session cleanup clears persisted Better Auth cookie and local cache", async () => {
  const source = await readFile(MAIN_SOURCE_PATH, "utf8");

  assert.match(source, /function clearPersistedAuthCookie\(\) \{/);
  assert.match(source, /if \("cookie" in betterAuth\) \{/);
  assert.match(source, /delete betterAuth\.cookie;/);
  assert.match(source, /if \("local_cache" in betterAuth\) \{/);
  assert.match(source, /delete betterAuth\.local_cache;/);
});

test("desktop sign-out clears persisted auth state before broadcasting the signed-out user", async () => {
  const source = await readFile(MAIN_SOURCE_PATH, "utf8");

  assert.match(
    source,
    /handleTrustedIpc\("auth:signOut", \["main", "auth-popup"], async \(\) => \{[\s\S]*try \{\s*await requireAuthClient\(\)\.signOut\(\);\s*} finally \{\s*clearPersistedAuthCookie\(\);\s*}[\s\S]*pendingAuthError = null;[\s\S]*emitAuthUserUpdated\(null\);[\s\S]*}\);/,
  );
});
