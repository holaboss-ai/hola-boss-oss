import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "SpaceBrowserDisplayPane.tsx");

test("space browser display selects the full address when the navigation field is clicked", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /const addressInputRef = useRef<HTMLInputElement \| null>\(null\);/,
  );
  assert.match(
    source,
    /const selectAddressInput = \(\) => \{\s*addressInputRef\.current\?\.focus\(\);\s*addressInputRef\.current\?\.select\(\);\s*\};/,
  );
  assert.match(
    source,
    /className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted\/50 px-3 py-2 transition-colors focus-within:border-ring"[\s\S]*onClick=\{selectAddressInput\}/,
  );
  assert.match(source, /ref=\{addressInputRef\}/);
  assert.match(
    source,
    /onFocus=\{\(event\) => \{[\s\S]*event\.currentTarget\.select\(\);[\s\S]*setAddressFocused\(true\);[\s\S]*\}\}/,
  );
  assert.match(source, /onClick=\{\(event\) => event\.currentTarget\.select\(\)\}/);
});

test("space browser display keeps loading state in the address bar and turns refresh into stop", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /const isActiveTabBusy = activeTab\.loading \|\| !activeTab\.initialized;/);
  assert.match(source, /aria-label=\{activeTab\.loading \? "Stop loading" : "Refresh"\}/);
  assert.match(source, /title=\{activeTab\.loading \? "Stop loading" : "Refresh"\}/);
  assert.match(
    source,
    /activeTab\.loading\s*\?\s*window\.electronAPI\.browser\.stopLoading\(\)\s*:\s*window\.electronAPI\.browser\.reload\(\)/,
  );
  assert.match(
    source,
    /\{activeTab\.loading \? \(\s*<X size=\{13\} \/>\s*\) : \(\s*<RefreshCcw size=\{13\} \/>\s*\)\}/,
  );
  assert.match(
    source,
    /\{isActiveTabBusy \? \(\s*<Loader2[\s\S]*className="shrink-0 animate-spin text-primary\/85"[\s\S]*\/>\s*\) : \(\s*<Globe size=\{13\} className="shrink-0 text-muted-foreground" \/>\s*\)\}/,
  );
  assert.doesNotMatch(source, /activeTab\.initialized && activeTab\.loading/);
});

test("space browser display uses stored history entries for address suggestions", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /useWorkspaceBrowser\(browserSpace, \{ includeHistory: true \}\)/,
  );
  assert.match(source, /const \[addressFocused, setAddressFocused\] = useState\(false\);/);
  assert.match(
    source,
    /const historySuggestions = useMemo\(\(\) => \{[\s\S]*historyEntries\.filter\(\(entry\) => \{/,
  );
  assert.match(
    source,
    /window\.electronAPI\.browser\.showAddressSuggestions\(\s*bounds,\s*suggestions,\s*highlightedSuggestionIndex,\s*\)/,
  );
  assert.match(
    source,
    /window\.electronAPI\.browser\.onAddressSuggestionChosen\(\(index\) => \{[\s\S]*navigateTo\(entry\.url\);/,
  );
  assert.match(
    source,
    /if \(event\.key === "ArrowDown"\) \{[\s\S]*if \(event\.key === "ArrowUp"\) \{[\s\S]*if \(event\.key === "Enter" && highlightedSuggestionIndex >= 0\)/,
  );
  assert.match(
    source,
    /onBlur=\{\(\) =>\s*window\.setTimeout\(\(\) => setAddressFocused\(false\), 120\)\s*\}/,
  );
});
