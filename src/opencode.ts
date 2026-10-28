import * as vscode from "vscode";
import { RoutingDecision } from "./types";

export function launchOpenCode(prompt: string, decision: RoutingDecision): void {
  const configuration = vscode.workspace.getConfiguration("cheprompt");
  const executable = configuration.get<string>("opencodePath", "opencode");
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri;
  const title = `ChePrompt: ${prompt.replace(/\s+/g, " ").slice(0, 48)}`;

  const terminal = vscode.window.createTerminal({
    name: `ChePrompt · ${decision.selected.label}`,
    cwd,
    shellPath: executable,
    shellArgs: [
      "run",
      "--model",
      decision.selected.id,
      "--title",
      title,
      prompt,
    ],
    iconPath: new vscode.ThemeIcon("sparkle"),
  });

  terminal.show();
}
