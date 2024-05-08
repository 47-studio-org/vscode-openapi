import { useEffect, useState } from "react";
import styled from "styled-components";

import { Environment as UnknownEnvironment } from "@xliic/common/env";
import { Playbook, serialize } from "@xliic/scanconf";
import { ThemeColorVariables } from "@xliic/common/theme";

import { DynamicVariableNames } from "../../../core/playbook/builtin-variables";
import { PlaybookEnvStack } from "../../../core/playbook/playbook-env";
import Form from "../../../new-components/Form";
import CollapsibleSection from "../components/CollapsibleSection";
import Execution from "../components/execution/Execution";
import Environment from "../components/scenario/Environment";
import RequestCard from "../components/scenario/RequestCard";
import { saveRequest } from "../slice";
import { useAppDispatch, useAppSelector } from "../store";
import { executeRequest } from "./slice";
import TryAndServerSelector from "../components/TryAndServerSelector";
import { extractScanconf, optionallyReplaceLocalhost } from "../operations/util";
import { makeEnvEnv } from "../../../core/playbook/execute";
import { runScan } from "../actions";
import DescriptionTooltip from "../../../new-components/DescriptionTooltip";

export default function RequestInternal({
  request,
  requestRef,
}: {
  request: Playbook.StageContent;
  requestRef: Playbook.RequestRef;
}) {
  const dispatch = useAppDispatch();

  const { oas, playbook, servers } = useAppSelector((state) => state.scanconf);
  const config = useAppSelector((state) => state.config.data);
  const env = useAppSelector((state) => state.env.data);
  const useGlobalBlocks = useAppSelector((state) => state.prefs.useGlobalBlocks);

  const {
    tryResult,
    mockResult,
    mockMissingVariables: missingVariables,
  } = useAppSelector((state) => state.requests);

  const onRun = (server: string, inputs: UnknownEnvironment) =>
    dispatch(executeRequest({ server, inputs }));

  const onSaveRequest = (stage: Playbook.StageContent) =>
    dispatch(saveRequest({ ref: requestRef, stage }));

  const credentials = playbook.authenticationDetails[0];

  const variables = [
    ...DynamicVariableNames,
    ...getVariableNamesFromEnvStack(mockResult?.[0]?.results?.[0]?.variablesReplaced?.stack || []),
  ];

  const [inputs, setInputs] = useState<UnknownEnvironment>({});

  const {
    simple,
    environment: {
      env: { host },
    },
  } = makeEnvEnv(Playbook.getCurrentEnvironment(playbook), env);

  useEffect(() => {
    const updated = { ...inputs };
    // remove stale variables
    for (const name of Object.keys(updated)) {
      if (!missingVariables.includes(name)) {
        delete updated[name];
      }
    }
    // create new variables
    for (const name of missingVariables) {
      if (updated[name] === undefined) {
        updated[name] = "";
      }
    }
    setInputs(updated);
  }, [missingVariables]);

  return (
    <Container>
      <TryAndServerSelector
        menu={true}
        servers={servers}
        host={host as string | undefined}
        onTry={(server: string) => onRun(server, inputs)}
        onScan={(server: string) => {
          const updatedServer = optionallyReplaceLocalhost(
            server,
            config.scanRuntime,
            config.docker.replaceLocalhost,
            config.platform
          );

          const [serialized, error] = serialize(oas, playbook);
          if (error !== undefined) {
            console.log("failed to serialize", error);
            // FIXME show error when serializing
            return;
          }

          dispatch(
            runScan({
              path: request.request.path,
              method: request.request.method,
              operationId: request.operationId,
              env: {
                SCAN42C_HOST: updatedServer,
                ...simple,
              },
              scanconf: extractScanconf(serialized, request.operationId),
            })
          );
        }}
      />
      <CollapsibleSection title="Request">
        <RequestCard
          defaultCollapsed={false}
          oas={oas}
          credentials={credentials}
          availableVariables={variables}
          requestRef={requestRef}
          stage={request!}
          saveRequest={onSaveRequest}
        />
        <Title>
          Unset variables
          <DescriptionTooltip>
            <h4>Unset variables in the Operation.</h4>
            <p>
              In certain cases, you might want to use variables which do not have a value in a
              context of a specific Operation. These might be useful, for example, when you intend
              to use this Operation in multiple Scenarios, each of which might provide a different
              set of values through its Environment.
            </p>
            <p>
              However, if the Operation contains an unset variable, you cannot use the 'Try' feature
              to test the Operation unless you provide a value for it.
            </p>
            <p>
              These inputs enumerate the unset variables and can be used to provide values for them.
            </p>
            <p>Please note that test inputs are not saved to the scan configuration.</p>
          </DescriptionTooltip>
        </Title>
        <Inputs>
          <Form
            wrapFormData={wrapEnvironment}
            unwrapFormData={unwrapEnvironment}
            data={inputs}
            saveData={(data) => setInputs(data)}
          >
            <Environment name="env" />
          </Form>
        </Inputs>
      </CollapsibleSection>

      {tryResult.length > 0 && (
        <CollapsibleSection title="Result">
          <Execution result={tryResult} collapsible={useGlobalBlocks} />
        </CollapsibleSection>
      )}
    </Container>
  );
}

const Container = styled.div`
  padding: 8px;
`;

function wrapEnvironment(env: UnknownEnvironment) {
  return {
    env: Object.entries(env).map(([key, value]) => ({ key, value, type: typeof value })),
  };
}

function unwrapEnvironment(data: any): UnknownEnvironment {
  const env: UnknownEnvironment = {};
  for (const { key, value, type } of data.env) {
    env[key] = convertToType(value, type);
  }
  return env;
}

function convertToType(value: string, type: string): unknown {
  if (type !== "string") {
    try {
      return JSON.parse(value);
    } catch (e) {
      // failed to convert, return string value
      return value;
    }
  }
  return `${value}`;
}

const Inputs = styled.div`
  border: 1px solid var(${ThemeColorVariables.border});
  background-color: var(${ThemeColorVariables.background});
`;

const Title = styled.div`
  display: flex;
  padding-top: 12px;
  padding-bottom: 12px;
  font-weight: 600;
  gap: 8px;
  cursor: pointer;
  align-items: center;
`;

function getVariableNamesFromEnvStack(env: PlaybookEnvStack): string[] {
  const variables: string[] = [];
  for (const entry of env) {
    for (const name of Object.keys(entry.env)) {
      if (!variables.includes(name)) {
        variables.push(name);
      }
    }
  }
  variables.sort();
  return variables;
}
