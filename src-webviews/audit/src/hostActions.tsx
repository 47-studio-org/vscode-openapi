import { createAsyncThunk } from "@reduxjs/toolkit";
import { HostApplication } from "./types";

export const goToLine = createAsyncThunk(
  "host/goToLine",
  async ({ uri, line, pointer }: { uri: string; line: number; pointer: string }, thunkAPI) => {
    const host = thunkAPI.extra as HostApplication;
    host.postMessage({ command: "goToLine", uri, line, pointer });
  }
);

export const copyIssueId = createAsyncThunk("host/copyIssueId", async (id: string, thunkAPI) => {
  const host = thunkAPI.extra as HostApplication;
  host.postMessage({ command: "copyIssueId", id });
});
