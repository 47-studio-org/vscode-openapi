import {
  configureStore,
  ListenerMiddlewareInstance,
  StateFromReducersMapObject,
} from "@reduxjs/toolkit";
import logger from "redux-logger";

import { createListenerMiddleware, isAnyOf, TypedStartListening } from "@reduxjs/toolkit";
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";

import { Webapp } from "@xliic/common/webapp/scan";

import theme, { ThemeState } from "../../features/theme/slice";
import router from "../../features/router/slice";

import scan, { runScan, sendScanRequest, sendCurlRequest } from "./slice";
import env, { saveEnv } from "../../features/env/slice";
import prefs, { setScanServer, setSecretForSecurity } from "../../features/prefs/slice";
import { Routes } from "../../features/router/RouterContext";
import { startNavigationListening } from "../../features/router/listener";

const reducer = {
  theme,
  scan,
  router,
  env,
  prefs,
};

export const initStore = (listenerMiddleware: ListenerMiddlewareInstance, theme: ThemeState) =>
  configureStore({
    reducer,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().prepend(listenerMiddleware.middleware).concat(logger),
    preloadedState: {
      theme,
    },
  });

export type RootState = StateFromReducersMapObject<typeof reducer>;
export type AppDispatch = ReturnType<typeof initStore>["dispatch"];

const listenerMiddleware = createListenerMiddleware();
type AppStartListening = TypedStartListening<RootState, AppDispatch>;
const startAppListening = listenerMiddleware.startListening as AppStartListening;

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

export function createListener(host: Webapp["host"], routes: Routes) {
  startNavigationListening(startAppListening, routes);

  startAppListening({
    actionCreator: runScan,
    effect: async (action, listenerApi) => {
      host.postMessage({
        command: "runScan",
        payload: {
          config: action.payload.scanConfigRaw,
          env: action.payload.env,
          rawOas: action.payload.rawOas,
        },
      });
    },
  });

  startAppListening({
    actionCreator: saveEnv,
    effect: async (action, listenerApi) => {
      host.postMessage({
        command: "saveEnv",
        payload: action.payload,
      });
    },
  });

  startAppListening({
    actionCreator: sendScanRequest,
    effect: async (action, listenerApi) => {
      host.postMessage({
        command: "sendScanRequest",
        payload: action.payload,
      });
    },
  });

  startAppListening({
    actionCreator: sendCurlRequest,
    effect: async (action, listenerApi) => {
      host.postMessage({
        command: "sendCurlRequest",
        payload: action.payload,
      });
    },
  });

  startAppListening({
    matcher: isAnyOf(setScanServer, setSecretForSecurity),
    effect: async (action, listenerApi) => {
      const { prefs } = listenerApi.getState();
      host.postMessage({
        command: "savePrefs",
        payload: prefs,
      });
    },
  });

  return listenerMiddleware;
}