import * as vscode from "vscode";
import { configurePlatformUser, getPlatformCredentials } from "../../credentials";
import { PlatformStore } from "../stores/platform-store";
import { configuration } from "../../configuration";

export default (context: vscode.ExtensionContext, store: PlatformStore) => ({
  copyToClipboard: async (value: string, message: string) => {
    vscode.env.clipboard.writeText(value);
    const disposable = vscode.window.setStatusBarMessage(message);
    setTimeout(() => disposable.dispose(), 2000);
  },

  openInWebUI: async (node: any) => {
    const platformUrl = store.getConnection().platformUrl;
    if ("getApiId" in node) {
      const apiId = node.getApiId();
      const uri = vscode.Uri.parse(platformUrl + `/apis/${apiId}`);
      vscode.env.openExternal(uri);
    } else if ("getCollectionId" in node) {
      const collectionId = node.getCollectionId();
      const uri = vscode.Uri.parse(platformUrl + `/collections/${collectionId}`);
      vscode.env.openExternal(uri);
    }
  },

  updatePlatformCredentials: async () => {
    const success = await configurePlatformUser(configuration, context.secrets);
    if (success) {
      store.setCredentials(await getPlatformCredentials(configuration, context.secrets));
    }
  },
});
