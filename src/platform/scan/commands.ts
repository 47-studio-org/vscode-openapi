/*
 Copyright (c) 42Crunch Ltd. All rights reserved.
 Licensed under the GNU Affero General Public License version 3. See LICENSE.txt in the project root for license information.
*/

import * as vscode from "vscode";

import { HttpMethod } from "@xliic/openapi";
import { stringify } from "@xliic/preserving-json-yaml-parser";

import { Cache } from "../../cache";
import { Configuration } from "../../configuration";
import { ensureHasCredentials } from "../../credentials";
import { OperationIdNode } from "../../outlines/nodes/operation-ids";
import { OperationNode } from "../../outlines/nodes/paths";
import { TagChildNode } from "../../outlines/nodes/tags";
import { getPathAndMethod } from "../../outlines/util";
import {
  createScanConfigWithCliBinary,
  ensureCliDownloaded,
  runAuditWithCliBinary,
} from "../cli-ast";
import { PlatformStore } from "../stores/platform-store";
import { Logger, PlatformContext } from "../types";
import { offerUpgrade } from "../upgrade";
import { getOrCreateScanconfUri, getScanconfUri } from "./config";
import { createScanConfigWithPlatform } from "./runtime/platform";
import { ScanWebView } from "./view";
import { formatException } from "../util";
import { loadConfig } from "../../util/config";

export default (
  cache: Cache,
  platformContext: PlatformContext,
  store: PlatformStore,
  configuration: Configuration,
  secrets: vscode.SecretStorage,
  getScanView: (uri: vscode.Uri) => ScanWebView
) => {
  vscode.commands.registerTextEditorCommand(
    "openapi.platform.editorRunSingleOperationScan",
    async (
      editor: vscode.TextEditor,
      edit: vscode.TextEditorEdit,
      uri: string,
      path: string,
      method: HttpMethod
    ): Promise<void> => {
      try {
        await editorRunSingleOperationScan(
          editor,
          cache,
          store,
          configuration,
          secrets,
          getScanView,
          path,
          method
        );
      } catch (ex: any) {
        if (
          ex?.response?.statusCode === 409 &&
          ex?.response?.body?.code === 109 &&
          ex?.response?.body?.message === "limit reached"
        ) {
          vscode.window.showErrorMessage(
            "You have reached your maximum number of APIs. Please contact support@42crunch.com to upgrade your account."
          );
        } else {
          vscode.window.showErrorMessage(formatException("Failed to scan:", ex));
        }
      }
    }
  );

  vscode.commands.registerCommand(
    "openapi.outlineSingleOperationScan",
    async (node: OperationNode | TagChildNode | OperationIdNode): Promise<void> => {
      if (!vscode.window.activeTextEditor) {
        vscode.window.showErrorMessage("No active editor");
        return;
      }

      const { path, method } = getPathAndMethod(node);

      try {
        await editorRunSingleOperationScan(
          vscode.window.activeTextEditor,
          cache,
          store,
          configuration,
          secrets,
          getScanView,
          path,
          method
        );
      } catch (ex: any) {
        if (
          ex?.response?.statusCode === 409 &&
          ex?.response?.body?.code === 109 &&
          ex?.response?.body?.message === "limit reached"
        ) {
          vscode.window.showErrorMessage(
            "You have reached your maximum number of APIs. Please contact support@42crunch.com to upgrade your account."
          );
        } else {
          vscode.window.showErrorMessage(formatException("Failed to scan:", ex));
        }
      }
    }
  );

  vscode.commands.registerTextEditorCommand(
    "openapi.platform.editorOpenScanconfig",
    async (editor: vscode.TextEditor, edit: vscode.TextEditorEdit): Promise<void> => {
      await editorOpenScanconfig(editor);
    }
  );
};

async function editorRunSingleOperationScan(
  editor: vscode.TextEditor,
  cache: Cache,
  store: PlatformStore,
  configuration: Configuration,
  secrets: vscode.SecretStorage,
  getScanView: (uri: vscode.Uri) => ScanWebView,
  path: string,
  method: HttpMethod
): Promise<void> {
  if (!(await ensureHasCredentials(configuration, secrets))) {
    return;
  }

  // run single operation scan creates the scan config and displays the scan view
  // actual execution of the scan triggered from the scan view

  const config = await loadConfig(configuration, secrets);

  // free users must have CLI available, platform users always use platform for scan config generation
  // so there is no need to check for CLI availability for platform users
  if (
    config.platformAuthType === "anond-token" &&
    !(await ensureCliDownloaded(configuration, secrets))
  ) {
    // cli is not available and user chose to cancel download
    return;
  }

  const bundle = await cache.getDocumentBundle(editor.document);

  if (!bundle || "errors" in bundle) {
    vscode.commands.executeCommand("workbench.action.problems.focus");
    vscode.window.showErrorMessage("Failed to bundle, check OpenAPI file for errors.");
    return;
  }

  const title = bundle?.value?.info?.title || "OpenAPI";
  const scanconfUri = getOrCreateScanconfUri(editor.document.uri, title);

  if (
    (scanconfUri === undefined || !(await exists(scanconfUri))) &&
    !(await createDefaultScanConfig(
      store,
      configuration,
      secrets,
      config.platformAuthType,
      scanconfUri,
      stringify(bundle.value)
    ))
  ) {
    return;
  }

  const view = getScanView(editor.document.uri);
  await view.show();
  await view.sendColorTheme(vscode.window.activeColorTheme);
  return view.sendScanOperation(bundle, editor.document, scanconfUri, path, method);
}

async function createDefaultScanConfig(
  store: PlatformStore,
  configuration: Configuration,
  secrets: vscode.SecretStorage,
  platformAuthType: "api-token" | "anond-token",
  scanconfUri: vscode.Uri,
  oas: string
): Promise<boolean> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Creating scan configuration...",
      cancellable: false,
    },
    async (progress, cancellationToken): Promise<boolean> => {
      try {
        if (platformAuthType === "anond-token") {
          // free users must use CLI for scan, there is no need to fallback to anond for initial audit
          // if there is no CLI available, they will not be able to run scan or create a scan config in any case
          const [report, reportError] = await runAuditWithCliBinary(
            secrets,
            emptyLogger,
            oas,
            false
          );
          if (reportError !== undefined) {
            if (reportError.statusCode === 3 && reportError.statusMessage === "limits_reached") {
              await offerUpgrade();
              return false;
            } else {
              throw new Error(
                reportError.statusMessage ? reportError.statusMessage : JSON.stringify(reportError)
              );
            }
          }
          if ((report.audit as any).openapiState !== "valid") {
            throw new Error(
              "Your API has structural or semantic issues in its OpenAPI format. Run Security Audit on this file and fix these issues first."
            );
          }
          await createScanConfigWithCliBinary(scanconfUri, oas);
        } else {
          // paid users create scan configs using the platform, this includes running an initial audit
          await createScanConfigWithPlatform(store, scanconfUri, oas);
        }
        vscode.window.showInformationMessage(
          `Saved Conformance Scan configuration to: ${scanconfUri.toString()}`
        );
        return true;
      } catch (e: any) {
        vscode.window.showErrorMessage(
          "Failed to create default config: " + ("message" in e ? e.message : e.toString())
        );
        return false;
      }
    }
  );
}

async function editorOpenScanconfig(editor: vscode.TextEditor): Promise<void> {
  const scanconfUri = getScanconfUri(editor.document.uri);
  if (scanconfUri === undefined || !exists(scanconfUri)) {
    await vscode.window.showErrorMessage(
      "No scan configuration found for the current document. Please create one first by running a scan.",
      { modal: true }
    );
    return undefined;
  }

  await vscode.window.showTextDocument(scanconfUri);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return true;
  } catch (e) {
    return false;
  }
}

const emptyLogger: Logger = {
  fatal: function (message: string): void {},
  error: function (message: string): void {},
  warning: function (message: string): void {},
  info: function (message: string): void {},
  debug: function (message: string): void {},
};
