/*
 Copyright (c) 42Crunch Ltd. All rights reserved.
 Licensed under the GNU Affero General Public License version 3. See LICENSE.txt in the project root for license information.
*/

import * as path from "path";
import * as vscode from "vscode";
import { AbstractWebapp } from "@xliic/common/message";
import {
  VsCodeColorMap,
  ThemeColorName,
  ThemeColorNames,
  ThemeColorVariables,
} from "@xliic/common/theme";

export type WebViewResponseHandler<A extends AbstractWebapp> =
  | Record<A["response"]["command"], (response: any) => Promise<A["request"] | void>>
  | { [key: string]: never };

export abstract class WebView<A extends AbstractWebapp> {
  private panel?: vscode.WebviewPanel;

  abstract responseHandlers: WebViewResponseHandler<A>;

  constructor(
    private extensionPath: string,
    private viewId: string,
    private viewTitle: string,
    private column: vscode.ViewColumn
  ) {}

  isActive(): boolean {
    return this.panel !== undefined;
  }

  protected async sendRequest(request: A["request"]): Promise<void> {
    if (this.panel) {
      await this.panel!.webview.postMessage(request);
    } else {
      throw new Error(`Can't send message to ${this.viewId}, webview not initialized`);
    }
  }

  async handleResponse(response: A["response"]): Promise<void> {
    const handler = this.responseHandlers[response.command as A["response"]["command"]];

    if (handler) {
      const request = await handler(response.payload);
      if (request !== undefined) {
        this.sendRequest(request);
      }
    } else {
      throw new Error(
        `Unable to find response handler for command: ${response.command} in ${this.viewId} webview`
      );
    }
  }

  async show(): Promise<void> {
    if (!this.panel) {
      const panel = await this.createPanel();
      panel.onDidDispose(() => (this.panel = undefined));
      panel.webview.onDidReceiveMessage(async (message) => {
        this.handleResponse(message as A["response"]);
      });
      this.panel = panel;
    } else if (!this.panel.visible) {
      this.panel.reveal();
    }
  }

  createPanel(): Promise<vscode.WebviewPanel> {
    const panel = vscode.window.createWebviewPanel(
      this.viewId,
      this.viewTitle,
      {
        viewColumn: this.column,
        preserveFocus: true,
      },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    if (process.env["XLIIC_WEB_VIEW_DEV_MODE"] === "true") {
      panel.webview.html = this.getDevHtml(panel);
    } else {
      panel.webview.html = this.getProdHtml(panel);
    }

    return new Promise((resolve, reject) => {
      panel.webview.onDidReceiveMessage((message: any) => {
        if (message.command === "started") {
          resolve(panel);
        }
      });
    });
  }

  private getDevHtml(panel: vscode.WebviewPanel): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy"  content="default-src 'none';  img-src https: data: http://localhost:3000/; script-src http://localhost:3000/ 'unsafe-inline'; style-src http://localhost:3000/ 'unsafe-inline'; connect-src http: https: ws:">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <base href="http://localhost:3000/">
      <script type="module">
      import RefreshRuntime from "/@react-refresh"
      RefreshRuntime.injectIntoGlobalHook(window)
      window.$RefreshReg$ = () => {}
      window.$RefreshSig$ = () => (type) => type
      window.__vite_plugin_react_preamble_installed__ = true
      </script>
      <script type="module" src="/@vite/client"></script>
      <style>
        ${customCssProperties()}
      </style>
    </head>
    <body>
    <div id="root"></div>
    <script type="module" src="/src/app/${this.viewId}/index.tsx"></script>
    <script>
      window.addEventListener("DOMContentLoaded", (event) => {
        const vscode = acquireVsCodeApi();
        window.renderWebView(vscode);
        vscode.postMessage({command: "started"});
      });
    </script>
    </body>
    </html>`;
  }

  private getProdHtml(panel: vscode.WebviewPanel): string {
    const cspSource = panel.webview.cspSource;
    const script = panel.webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.extensionPath, "webview", "generated", "web", `${this.viewId}.js`)
      )
    );
    const style = panel.webview.asWebviewUri(
      vscode.Uri.file(path.join(this.extensionPath, "webview", "generated", "web", "style.css"))
    );
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy"  content="default-src 'none';  img-src ${cspSource} https: data:; script-src ${cspSource} 'unsafe-inline'; style-src ${cspSource}  'unsafe-inline'; connect-src http: https:">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link href="${style}" rel="stylesheet">
      <style type="text/css">
        ${customCssProperties()}
      </style>
    </head>
    <body>
    <div id="root"></div>  
    <script type="module" src="${script}"></script>
    <script>
      window.addEventListener("DOMContentLoaded", (event) => {
        const vscode = acquireVsCodeApi();
        window.renderWebView(vscode);
        vscode.postMessage({command: "started"});
      });
    </script>
    </body>
    </html>`;
  }
}

function customCssProperties(): string {
  const vscodeColorMap: VsCodeColorMap = {
    foreground: "--vscode-foreground",
    background: "--vscode-editor-background",
    disabledForeground: "--vscode-disabledForeground",
    border: "--vscode-editorGroup-border",
    focusBorder: "--vscode-focusBorder",
    buttonBorder: "--vscode-button-border",
    buttonBackground: "--vscode-button-background",
    buttonForeground: "--vscode-button-foreground",
    buttonHoverBackground: "--vscode-button-hoverBackground",
    buttonSecondaryBackground: "--vscode-button-secondaryBackground",
    buttonSecondaryForeground: "--vscode-button-secondaryForeground",
    buttonSecondaryHoverBackground: "--vscode-button-secondaryHoverBackground",
    inputBackground: "--vscode-input-background",
    inputForeground: "--vscode-input-foreground",
    inputBorder: "--vscode-input-border",
    tabBorder: "--vscode-tab-border",
    tabActiveBackground: "--vscode-tab-activeBackground",
    tabActiveForeground: "--vscode-tab-activeForeground",
    tabInactiveBackground: "--vscode-tab-inactiveBackground",
    tabInactiveForeground: "--vscode-tab-inactiveForeground",
    dropdownBackground: "--vscode-dropdown-background",
    dropdownBorder: "--vscode-dropdown-border",
    dropdownForeground: "--vscode-dropdown-foreground",
    checkboxBackground: "--vscode-checkbox-background",
    checkboxBorder: "--vscode-checkbox-border",
    checkboxForeground: "--vscode-checkbox-foreground",
    errorForeground: "--vscode-errorForeground",
    errorBackground: "--vscode-inputValidation-errorBackground",
    errorBorder: "--vscode-inputValidation-errorBorder",
    sidebarBackground: "--vscode-sideBar-background",
    listActiveSelectionBackground: "--vscode-list-activeSelectionBackground",
    listActiveSelectionForeground: "--vscode-list-activeSelectionForeground",
    listHoverBackground: "--vscode-list-hoverBackground",
    contrastActiveBorder: "--vscode-contrastActiveBorder",
  };

  const props = ThemeColorNames.map((name) => createColorProperty(name, vscodeColorMap[name])).join(
    "\n"
  );

  return `:root { ${props} }`;
}

function createColorProperty(name: ThemeColorName, vsCodeVariable: string): string {
  const variable = ThemeColorVariables[name];
  const customVariable = ThemeColorVariables[name] + "-custom";
  return `${variable}: var(${customVariable}, var(${vsCodeVariable}));`;
}
