import {
  createListenerMiddleware,
  isAnyOf,
  TypedStartListening,
  UnsubscribeListener,
} from "@reduxjs/toolkit";
import { Webapp } from "@xliic/common/webapp/tryit";
import { AppDispatch, RootState } from "./store";
import { sendHttpRequest, createSchema } from "./slice";
import { showEnvWindow } from "../../features/env/slice";
import { setTryitServer, setSecretForSecurity } from "../../features/prefs/slice";
import { startNavigationListening } from "../../features/router/listener";
import { Routes } from "../../features/router/RouterContext";
import { startListeners } from "../webapp";
import {
  addInsecureSslHostname,
  removeInsecureSslHostname,
  saveConfig,
} from "../../features/config/slice";

const listenerMiddleware = createListenerMiddleware();
type AppStartListening = TypedStartListening<RootState, AppDispatch>;
const startAppListening = listenerMiddleware.startListening as AppStartListening;

export function createListener(host: Webapp["host"], routes: Routes) {
  const listeners: Record<keyof Webapp["hostHandlers"], () => UnsubscribeListener> = {
    sendHttpRequest: () =>
      startAppListening({
        actionCreator: sendHttpRequest,
        effect: async (action, listenerApi) => {
          host.postMessage({ command: "sendHttpRequest", payload: action.payload.request });
        },
      }),

    createSchema: () =>
      startAppListening({
        actionCreator: createSchema,
        effect: async (action, listenerApi) => {
          host.postMessage({ command: "createSchema", payload: action.payload.response });
        },
      }),

    savePrefs: () =>
      startAppListening({
        matcher: isAnyOf(setTryitServer, setSecretForSecurity),
        effect: async (action, listenerApi) => {
          const { prefs } = listenerApi.getState();
          host.postMessage({
            command: "savePrefs",
            payload: prefs,
          });
        },
      }),

    showEnvWindow: () =>
      startAppListening({
        actionCreator: showEnvWindow,
        effect: async (action, listenerApi) => {
          host.postMessage({ command: "showEnvWindow", payload: undefined });
        },
      }),

    saveConfig: () =>
      startAppListening({
        matcher: isAnyOf(saveConfig, addInsecureSslHostname, removeInsecureSslHostname),
        effect: async (action, listenerApi) => {
          const {
            config: { data: config },
          } = listenerApi.getState();
          host.postMessage({ command: "saveConfig", payload: config });
        },
      }),
  };

  startNavigationListening(startAppListening, routes);
  startListeners(listeners);

  return listenerMiddleware;
}
