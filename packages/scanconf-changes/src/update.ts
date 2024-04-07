import { BundledSwaggerOrOasSpec, Swagger, OpenApi30, isOpenapi, HttpMethod } from "@xliic/openapi";
import { Scanconf } from "@xliic/scanconf";
import { Change, OperationAdded, OperationRemoved } from "./compare";
import { simpleClone } from "@xliic/preserving-json-yaml-parser";

export function update(
  oas: BundledSwaggerOrOasSpec,
  original: Scanconf.ConfigurationFileBundle,
  updated: Scanconf.ConfigurationFileBundle,
  changes: Change[]
): Scanconf.ConfigurationFileBundle {
  const result = simpleClone(original);
  for (const change of changes) {
    if (change.type === "operation-added") {
      return updateAddOperation(oas, result, updated, change);
    } else if (change.type === "operation-removed") {
      return updateRemoveOperation(oas, result, updated, change);
    }
  }
  return result;
}

export function updateAddOperation(
  oas: BundledSwaggerOrOasSpec,
  target: Scanconf.ConfigurationFileBundle,
  updated: Scanconf.ConfigurationFileBundle,
  change: OperationAdded
): Scanconf.ConfigurationFileBundle {
  const operation = updated.operations![change.operationId];
  target.operations![change.operationId] = operation;
  return target;
}

export function updateRemoveOperation(
  oas: BundledSwaggerOrOasSpec,
  target: Scanconf.ConfigurationFileBundle,
  updated: Scanconf.ConfigurationFileBundle,
  change: OperationRemoved
): Scanconf.ConfigurationFileBundle {
  delete target.operations![change.operationId];
  // FIXME walk all the scenarios and remove the ones that reference this operation
  return target;
}