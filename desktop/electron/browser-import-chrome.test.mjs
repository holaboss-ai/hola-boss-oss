import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSourcePath = path.join(__dirname, "main.ts");
const overflowPreloadPath = path.join(__dirname, "overflowPopupPreload.ts");

test("desktop browser import flow discovers a Chrome profile and imports bookmarks, history, and cookies", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(source, /function resolveChromiumFamilyUserDataRoot\(\s*browser: ChromiumFamilyBrowser,\s*\): string \| null \{/);
  assert.match(source, /function resolveChromeUserDataRoot\(\): string \| null \{/);
  assert.match(source, /async function resolveChromiumFamilyProfileSelection\(\s*browser: ChromiumFamilyBrowser,\s*preferredProfileDir\?: string \| null,\s*\): Promise<ChromiumProfileSelection \| null> \{/);
  assert.match(source, /const importableProfiles: ChromiumProfileSelection\[] = \[];/);
  assert.match(source, /async function discoverChromiumFamilyImportProfiles\(\s*browser: ChromiumFamilyBrowser,\s*\): Promise<\{/);
  assert.match(source, /async function listImportBrowserProfiles\(\s*source: BrowserImportSource,\s*\): Promise<BrowserImportProfileOptionPayload\[]> \{/);
  assert.match(source, /if \(profiles\.length > 1\) \{/);
  assert.match(source, /selectChromiumFamilyProfileDirectory\(\s*browser,\s*userDataDir,\s*\)/);
  assert.match(source, /function chromeProfileHasImportableData\(profileDir: string\) \{/);
  assert.match(source, /async function resolveChromeProfileSelection\(\): Promise<ChromiumProfileSelection \| null> \{/);
  assert.match(source, /async function readChromeBookmarks\(\s*profileDir: string,\s*\): Promise<BrowserBookmarkPayload\[]> \{/);
  assert.match(source, /async function readChromeHistory\(\s*profileDir: string,\s*\): Promise<BrowserHistoryEntryPayload\[]> \{/);
  assert.match(source, /async function importChromiumFamilyCookiesIntoWorkspaceSession\(\s*browser: ChromiumFamilyBrowser,\s*browserSession: Session,\s*profileDir: string,\s*\): Promise<BrowserCookieImportSummary> \{/);
  assert.match(source, /async function importChromeCookiesIntoWorkspaceSession\(\s*browserSession: Session,\s*profileDir: string,\s*\): Promise<BrowserCookieImportSummary> \{/);
  assert.match(source, /execFileSync\(\s*"security",/);
  assert.match(source, /pbkdf2Sync\(\s*safeStoragePassword,/);
  assert.match(source, /function readChromeWindowsEncryptedKey\(userDataDir: string\) \{/);
  assert.match(source, /ProtectedData\]::Unprotect/);
  assert.match(source, /function decryptChromeCookieValueWindows\(\s*encryptedValue: Buffer,\s*encryptionKey: Buffer,\s*\) \{/);
  assert.match(source, /function stripChromeCookieDomainHashPrefix\(\s*hostKey: string,\s*decryptedValue: Buffer,\s*\) \{/);
  assert.match(source, /createHash\("sha256"\)\.update\(hostKey, "utf8"\)\.digest\(\)/);
  assert.match(source, /cookieValue = decodeChromeCookieValue\(\s*row\.host_key,\s*decryptedValue,\s*\);/);
  assert.match(source, /CHROME_WINDOWS_APP_BOUND_COOKIE_PREFIX = "v20"/);
  assert.match(source, /App-Bound encryption and cannot be imported from a different desktop app/);
  assert.match(source, /await browserSession\.cookies\.set\(\{/);
  assert.match(source, /await browserSession\.cookies\.flushStore\(\);/);
  assert.match(source, /async function importChromiumFamilyProfileIntoWorkspace\(\s*browser: ChromiumFamilyBrowser,\s*workspaceId\?: string \| null,\s*profileDir\?: string \| null,\s*\): Promise<BrowserImportSummary \| null> \{/);
  assert.match(source, /async function importSafariProfileIntoWorkspace\(\s*workspaceId\?: string \| null,\s*safariArchivePath\?: string \| null,\s*\): Promise<BrowserImportSummary \| null> \{/);
  assert.match(source, /async function importBrowserProfileIntoWorkspace\(\s*payload: BrowserImportProfilePayload,\s*\): Promise<BrowserImportSummary \| null> \{/);
  assert.match(source, /async function copyBrowserWorkspaceProfile\(\s*payload: BrowserCopyWorkspaceProfilePayload,\s*\): Promise<BrowserImportSummary> \{/);
  assert.match(source, /async function importChromeProfileIntoWorkspace\(\s*workspaceId\?: string \| null,\s*\): Promise<BrowserImportSummary \| null> \{/);
});

test("desktop browser overflow popup exposes Chrome import and reports the result", async () => {
  const source = await readFile(mainSourcePath, "utf8");

  assert.match(source, /<button class="item" id="chrome-import"><span class="icon">⇪<\/span><span>Import Chrome<\/span><\/button>/);
  assert.match(source, /window\.overflowPopup\.importChrome\(\)/);
  assert.match(source, /ipcMain\.handle\("browser:overflowImportChrome", async \(\) => \{/);
  assert.match(source, /Chrome data was imported into this workspace browser\./);
  assert.match(source, /Could not import data from Chrome\./);
  assert.match(source, /handleTrustedIpc\(\s*"workspace:listImportBrowserProfiles",/);
  assert.match(source, /handleTrustedIpc\(\s*"workspace:importBrowserProfile",/);
  assert.match(source, /handleTrustedIpc\(\s*"workspace:copyBrowserWorkspaceProfile",/);
});

test("overflow popup preload exposes the Chrome import action", async () => {
  const source = await readFile(overflowPreloadPath, "utf8");

  assert.match(source, /importChrome: \(\) =>\s*ipcRenderer\.invoke\("browser:overflowImportChrome"\) as Promise<void>,/);
});
