import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

type ExtensionManifest = {
  contributes?: {
    views?: Record<string, Array<{ id?: string; type?: string }>>;
    configuration?: { properties?: Record<string, { type?: string; default?: unknown }> };
  };
};

test("declares the ChePrompt router as a webview", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
  ) as ExtensionManifest;
  const views = manifest.contributes?.views?.cheprompt;

  assert.ok(Array.isArray(views), "ChePrompt must contribute its view container");
  const routerView = views.find((view) => view.id === "cheprompt.sidebar");

  assert.ok(routerView, "ChePrompt must contribute cheprompt.sidebar");
  assert.equal(
    routerView.type,
    "webview",
    "VS Code otherwise treats the Router as a TreeView and asks for a data provider",
  );
});

test("executes the chosen route on send by default and lets the user restore review mode", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
  ) as ExtensionManifest;
  const setting = manifest.contributes?.configuration?.properties?.["cheprompt.executeOnSend"];

  assert.equal(setting?.type, "boolean");
  assert.equal(setting?.default, true);
});
