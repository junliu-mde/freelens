import moment from "moment-timezone";

import type { Condition } from "@freelensapp/kube-object/dist";

function timeToUnix(dateStr?: string): number {
  const m = moment(dateStr);
  return m.isValid() ? m.unix() : 0;
}

/**
 * Higher priority: first on the list if the timestamp is the same.
 */
const defaultConditionTypePriorities: Record<string, number> = {
  PodScheduled: 1,
  PodReadyToStartContainers: 2,
  ContainersReady: 3,
  ArtifactInStorage: 3,
  Released: 3,
  Initialized: 4,
  Ready: 5,
  Synced: 6,
  Available: 7,
  Progressing: 8,
};

/**
 * Sort conditions (the newer first) using heuristic: first sorts fields by
 * date and if the date is the same then checks priority from the object.
 */
export function sortConditions(
  conditions: Condition[],
  conditionTypePriorities: Record<string, number> = defaultConditionTypePriorities,
): Condition[] | undefined {
  return conditions?.sort(
    (a, b) =>
      timeToUnix(b.lastTransitionTime) - timeToUnix(a.lastTransitionTime) ||
      (conditionTypePriorities[b.type] ?? 0) - (conditionTypePriorities[a.type] ?? 0),
  );
}

const deploymentListConditionOrder = ["Available", "Progressing"] as const;

/**
 * Pick the single deployment condition to show in list views.
 * Prefer Available when healthy; otherwise show Progressing or the first failing condition.
 */
export function pickDeploymentListCondition(conditions: Condition[]): Condition | undefined {
  if (!conditions.length) {
    return undefined;
  }

  const byType = Object.fromEntries(conditions.map((condition) => [condition.type, condition]));
  const available = byType.Available;
  const progressing = byType.Progressing;

  if (available?.status === "True") {
    return available;
  }

  if (progressing?.status === "True") {
    return progressing;
  }

  for (const type of deploymentListConditionOrder) {
    const condition = byType[type];

    if (condition) {
      return condition;
    }
  }

  return conditions[0];
}
