import * as playbook from "@xliic/common/playbook";
import { assert, expect } from "vitest";
import { executeAllPlaybooks } from "../execute";
import { PlaybookExecutorStep } from "../playbook";
import { PlaybookEnv } from "../playbook-env";
import { parse } from "../scanconf-parser";
import * as scan from "../scanconfig";
import { httpClient } from "./httpclient";

export function makeStepAssert(steps: PlaybookExecutorStep[]) {
  return (obj: any) => expect(steps.shift()).toMatchObject(obj);
}

export function parseScenario(oas: any, scenario: scan.ConfigurationFileBundle) {
  const [file, error] = parse(oas, scenario);

  if (error !== undefined) {
    assert.fail("Error parsing config: " + JSON.stringify(error));
  }

  return file;
}

export async function runScenario(
  oas: any,
  file: playbook.PlaybookBundle,
  name: string,
  vars?: PlaybookEnv
): Promise<PlaybookExecutorStep[]> {
  const steps = [];
  const env = [];

  if (vars) {
    env.push(vars);
  }

  for await (const step of executeAllPlaybooks(
    httpClient,
    oas,
    "http://localhost:8090",
    file,
    [{ name: "test", requests: file.operations[name].scenarios[0].requests }],
    { default: {}, secrets: {} },
    env
  )) {
    steps.push(step);
  }

  return steps;
}