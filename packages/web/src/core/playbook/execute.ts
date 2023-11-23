import { EnvData, SimpleEnvironment } from "@xliic/common/env";
import { HttpClient } from "@xliic/common/http";
import { BundledSwaggerOrOasSpec, getOperationById } from "@xliic/common/openapi";
import * as playbook from "@xliic/common/playbook";

import { makeExternalHttpRequest, makeHttpRequest } from "./http";
import { MockHttpClient, MockHttpResponse } from "./mock-http";
import { AuthResult, PlaybookExecutorStep } from "./playbook";
import { PlaybookEnv, PlaybookEnvStack } from "./playbook-env";
import { assignVariables, getHttpStatusCategory } from "./variable-assignments";
import {
  getMissingVariableNames,
  replaceCredentialVariables,
  replaceEnvironmentVariables,
  replaceRequestVariables,
} from "./variables";
import { createAuthCache, getAuthEntry, setAuthEntry, AuthCache } from "./auth-cache";

export type PlaybookList = { name: string; requests: playbook.Stage[] }[];

export async function* executeAllPlaybooks(
  client: HttpClient | MockHttpClient,
  oas: BundledSwaggerOrOasSpec,
  server: string,
  file: playbook.PlaybookBundle,
  playbooks: PlaybookList,
  envenv: EnvData,
  extraEnv: PlaybookEnvStack = []
): AsyncGenerator<PlaybookExecutorStep> {
  const cache = createAuthCache();
  const env: PlaybookEnvStack = [getExternalEnvironment(file, envenv)];
  const result: PlaybookEnvStack = [];
  for (const { name, requests } of playbooks) {
    const playbookResult: PlaybookEnvStack | undefined = yield* executePlaybook(
      name,
      cache,
      client,
      oas,
      server,
      file,
      requests,
      [...env, ...extraEnv, ...result],
      0
    );

    if (playbookResult === undefined) {
      // playbook failed, bail
      break;
    } else {
      result.push(...playbookResult);
    }
  }

  return result;
}

async function* executePlaybook(
  name: string,
  cache: AuthCache,
  client: HttpClient | MockHttpClient,
  oas: BundledSwaggerOrOasSpec,
  server: string,
  file: playbook.PlaybookBundle,
  requests: playbook.Stage[],
  env: PlaybookEnvStack,
  depth: number
): AsyncGenerator<PlaybookExecutorStep, PlaybookEnvStack | undefined> {
  const result: PlaybookEnvStack = [];

  yield { event: "playbook-started", name };

  if (depth >= 5) {
    yield {
      event: "playbook-aborted",
      error: "Maximum playbook execution depth is reached",
    };
    return;
  }

  for (let i = 0; i < requests.length; i++) {
    const step = requests[i];

    if (step.ref === undefined) {
      yield {
        event: "playbook-aborted",
        error: "non-reference requests are not supported",
      };
      return;
    }

    const request = getRequestByRef(file, step.ref);

    if (request === undefined) {
      yield {
        event: "playbook-aborted",
        error: `request not found: ${step.ref.type}/${step.ref.id}`,
      };
      return;
    }

    yield { event: "request-started", ref: step.ref };

    // skip auth for external requests
    const auth = request.operationId === undefined ? undefined : request.auth;
    const security = yield* executeAuth(
      cache,
      client,
      oas,
      server,
      file,
      auth,
      [...env, ...result],
      depth
    );

    if (security === undefined) {
      yield {
        event: "http-request-prepare-error",
        error: `Failed to retrieve credentials`,
      };
      return;
    }

    const replacedStageEnv = replaceEnvironmentVariables(step.environment || {}, [
      ...env,
      ...result,
    ]);

    const stageEnv: PlaybookEnv = {
      id: "stage-environment",
      env: replacedStageEnv.value,
      // FIXME can we make replaceEnvVariables return assignments?
      assignments: [],
    };

    const requestEnvStack: PlaybookEnvStack = [...env, ...result, stageEnv];

    const replacedRequestEnv = replaceEnvironmentVariables(
      request.environment || {},
      requestEnvStack
    );

    const requestEnv: PlaybookEnv = {
      id: "request-environment",
      env: replacedRequestEnv.value,
      assignments: [],
    };

    const operation =
      request.operationId !== undefined
        ? getOperationById(oas, request.operationId)?.operation
        : undefined;

    const replacements = replaceRequestVariables(oas, request.request, operation, [
      ...env,
      ...result,
      requestEnv,
      stageEnv,
    ]);

    const missing = [
      ...replacedRequestEnv.missing,
      ...replacedStageEnv.missing,
      ...replacements.missing,
    ];

    yield {
      event: "payload-variables-substituted",
      stack: [...requestEnvStack, requestEnv],
      found: [...replacedRequestEnv.found, ...replacedStageEnv.found, ...replacements.found],
      missing,
    };

    if (missing.length > 0) {
      yield {
        event: "http-request-prepare-error",
        error: `failed to replace request variables: ${getMissingVariableNames(missing)}`,
      };
      return;
    }

    const [httpRequest, requestError] =
      "operationId" in replacements.value
        ? await makeHttpRequest(oas, server, request.operationId, replacements.value, security)
        : await makeExternalHttpRequest(replacements.value);

    if (requestError !== undefined) {
      yield { event: "http-request-prepare-error", error: requestError };
      return;
    }

    yield {
      event: "http-request-prepared",
      request: httpRequest,
      operationId: request.operationId,
    };

    const [response, error2] = await client(httpRequest);

    if (error2 !== undefined) {
      yield { event: "http-error-received", error: error2 };
      return;
    }

    yield { event: "http-response-received", response };

    if (response !== MockHttpResponse) {
      if (step.expectedResponse !== undefined) {
        // check stage expected response
        if (
          String(response?.statusCode) !== step.expectedResponse &&
          getHttpStatusCategory(response!.statusCode) !== step.expectedResponse
        ) {
          yield {
            event: "response-processing-error",
            error: `HTTP response code "${response?.statusCode}" does not match expected stage response code "${step.expectedResponse}"`,
          };
          return;
        }
      } else {
        // check request default response
        if (
          String(response?.statusCode) !== request.defaultResponse &&
          getHttpStatusCategory(response!.statusCode) !== request.defaultResponse
        ) {
          yield {
            event: "response-processing-error",
            error: `HTTP response code "${response?.statusCode}" does not match default response code "${request.defaultResponse}"`,
          };
          return;
        }
      }
    }

    const [requestAssignments, requestAssignmentsError] = assignVariables(
      `playbook-${name}-step-${i}-request`,
      request.responses,
      httpRequest,
      response
    );

    if (requestAssignmentsError !== undefined) {
      yield {
        event: "response-processing-error",
        error: requestAssignmentsError,
      };
      return;
    }

    result.push(...requestAssignments);

    yield { event: "variables-assigned", assignments: requestAssignments };

    const [stepAssignments, stepAssignmentsError] = assignVariables(
      `playbook-${name}-step-${i}`,
      step.responses,
      httpRequest,
      response
    );

    if (stepAssignmentsError !== undefined) {
      yield {
        event: "response-processing-error",
        error: stepAssignmentsError,
      };
      return;
    }

    yield { event: "variables-assigned", assignments: stepAssignments };

    result.push(...stepAssignments);
  }

  yield { event: "playbook-finished" };

  return result;
}

export async function* executeAuth(
  cache: AuthCache,
  client: HttpClient | MockHttpClient,
  oas: BundledSwaggerOrOasSpec,
  server: string,
  file: playbook.PlaybookBundle,
  auth: string[] | undefined,
  env: PlaybookEnvStack,
  depth: number
): AsyncGenerator<PlaybookExecutorStep, AuthResult | undefined> {
  const result: AuthResult = {};
  if (auth === undefined) {
    return result;
  }

  for (const authName of auth) {
    yield { event: "auth-started", name: authName };
    const [credentialName, methodName] = authName.split("/");
    const credential = file.authenticationDetails[0][credentialName];

    if (credential === undefined) {
      yield { event: "auth-aborted", error: `credential: "${credentialName}" is not found` };
      return;
    }

    const effectiveMethodName = methodName === undefined ? credential.default : methodName;

    const method = credential.methods[effectiveMethodName];

    if (method === undefined) {
      yield {
        event: "auth-aborted",
        error: `credential value: "${credentialName}/${effectiveMethodName}" is not found`,
      };
      return;
    }

    if (credential === undefined) {
      yield { event: "auth-aborted", error: `credential: "${credentialName}" is not found` };
      return;
    }

    // check cache or get credential value
    const cached = getAuthEntry(cache, credential, effectiveMethodName);
    if (cached !== undefined) {
      yield {
        event: "credential-retrieved-from-cache",
        name: authName,
        result: cached,
      };
      result[authName] = { credential, value: cached };
    } else {
      const value: string | undefined = yield* executeGetCredentialValue(
        cache,
        client,
        oas,
        server,
        file,
        authName,
        method,
        env,
        depth
      );

      if (value === undefined) {
        yield {
          event: "auth-aborted",
          error: `Failed to get value for the credential: "${credentialName}"`,
        };
        return;
      }

      setAuthEntry(cache, credential, effectiveMethodName, value);
      result[authName] = { credential, value };
    }

    yield { event: "auth-finished" };
  }

  return result;
}

async function* executeGetCredentialValue(
  cache: AuthCache,
  client: HttpClient | MockHttpClient,
  oas: BundledSwaggerOrOasSpec,
  server: string,
  file: playbook.PlaybookBundle,
  authName: string,
  method: playbook.CredentialMethod,
  env: PlaybookEnvStack,
  depth: number
): AsyncGenerator<PlaybookExecutorStep, string | undefined> {
  const credentialEnvStack = [...env];

  if (method.requests !== undefined) {
    const result = yield* executePlaybook(
      authName,
      cache,
      client,
      oas,
      server,
      file,
      method.requests,
      env,
      depth + 1
    );

    if (result === undefined) {
      // failed to execute playbook, exiting
      return undefined;
    }

    credentialEnvStack.push(...result);
  }

  const replacements = replaceCredentialVariables(method.credential, credentialEnvStack);

  if (replacements.missing.length !== 0) {
    // FIXME something is not found, err
  }

  yield {
    event: "credential-variables-substituted",
    name: authName,
    result: replacements.value as string,
    stack: credentialEnvStack,
    found: replacements.found,
    missing: replacements.missing,
  };

  return replacements.value;
}

export function makeEnvEnv(
  environment: playbook.PlaybookEnvironment,
  env: EnvData
): { environment: PlaybookEnv; simple: SimpleEnvironment; missing: string[] } {
  const result: playbook.Environment = {};
  const simple: SimpleEnvironment = {};
  const missing: string[] = [];
  for (const [name, variable] of Object.entries(environment.variables)) {
    if (env.secrets.hasOwnProperty(variable.name)) {
      result[name] = env.secrets[variable.name];
      simple[variable.name] = env.secrets[variable.name];
    } else if (env.default.hasOwnProperty(variable.name)) {
      result[name] = env.default[variable.name];
      simple[variable.name] = env.default[variable.name];
    } else if (!variable.required && variable.default !== undefined) {
      // required variables must always come from the environment, no default
      // values is used for these
      result[name] = variable.default;
    } else if (variable.required) {
      missing.push(variable.name);
    }
  }

  return {
    environment: { id: "environment", assignments: [], env: result },
    simple,
    missing,
  };
}

export function getExternalEnvironment(
  file: playbook.PlaybookBundle,
  envenv: EnvData
): PlaybookEnv {
  const environmentName = file.runtimeConfiguration?.environment || "default";
  const { environment } = makeEnvEnv(
    file?.environments?.[environmentName] || { variables: {} },
    envenv
  );
  return environment;
}

function getRequestByRef(file: playbook.PlaybookBundle, ref: playbook.RequestRef) {
  return ref.type === "operation" ? file.operations[ref.id]?.request : file.requests?.[ref.id];
}