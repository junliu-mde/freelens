/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "./nodes.scss";

import { formatNodeTaint } from "@freelensapp/kube-object";
import { Icon } from "@freelensapp/icon";
import { Tooltip, TooltipPosition, withTooltip } from "@freelensapp/tooltip";
import { bytesToUnits, interval } from "@freelensapp/utilities";
import { withInjectables } from "@ogre-tools/injectable-react";
import { makeObservable, observable, computed } from "mobx";
import { observer } from "mobx-react";
import React from "react";
import requestAllNodeMetricsInjectable from "../../../common/k8s-api/endpoints/metrics.api/request-metrics-for-all-nodes.injectable";
import { BadgeBoolean } from "../badge";
import eventStoreInjectable from "../events/store.injectable";
import { KubeObjectAge } from "../kube-object/age";
import { KubeObjectConditionsList } from "../kube-object-conditions";
import { KubeObjectListLayout } from "../kube-object-list-layout";
import { TabLayout } from "../layout/tab-layout-2";
import { LineProgress } from "../line-progress";
import { WithTooltip } from "../with-tooltip";
import podStoreInjectable from "../workloads-pods/store.injectable";
import nodeStoreInjectable from "./store.injectable";

import type { Node } from "@freelensapp/kube-object";

import type {
  NodeMetricData,
  RequestAllNodeMetrics,
} from "../../../common/k8s-api/endpoints/metrics.api/request-metrics-for-all-nodes.injectable";
import type { EventStore } from "../events/store";
import type { PodStore } from "../workloads-pods/store";
import type { NodeStore } from "./store";

enum columnId {
  name = "name",
  cpu = "cpu",
  memory = "memory",
  disk = "disk",
  gpu = "gpu",
  taints = "taints",
  roles = "roles",
  version = "version",
  internalIp = "internalIp",
  age = "age",
  schedulable = "schedulable",
  conditions = "condition",
  status = "status",
}

type MetricsTooltipFormatter = (metrics: [number, number]) => string;

interface UsageArgs {
  node: Node;
  title: string;
  metricNames: [keyof NodeMetricData, keyof NodeMetricData];
  formatters: MetricsTooltipFormatter[];
  usageText?: string;
}

const GPU_RESOURCE_KEY = "nvidia.com/gpu";

const GpuCapacityWarningIcon = withTooltip(({ ...elemProps }: React.HTMLAttributes<HTMLDivElement>) => (
  <Icon material="warning_amber" className="warning" {...elemProps} />
));

interface Dependencies {
  requestAllNodeMetrics: RequestAllNodeMetrics;
  nodeStore: NodeStore;
  eventStore: EventStore;
  podStore: PodStore;
}

function bytesToUnitsAligned(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  return bytesToUnits(bytes, { precision: 1 }).replace(/B$/, "");
}

@observer
class NonInjectedNodesRoute extends React.Component<Dependencies> {
  @observable metrics: NodeMetricData | null = null;

  private readonly metricsWatcher = interval(30, () => {
    void this.refreshMetrics();
  });

  constructor(props: Dependencies) {
    super(props);
    makeObservable(this);
  }

  componentDidMount() {
    this.metricsWatcher.start(true);
  }

  componentWillUnmount() {
    this.metricsWatcher.stop();
  }

  private refreshMetrics = async () => {
    const [metricsResult] = await Promise.allSettled([
      this.props.requestAllNodeMetrics(),
      this.props.nodeStore.loadKubeMetrics(),
      this.props.nodeStore.loadAll({}),
      this.props.podStore.loadAll({}),
    ]);

    if (metricsResult.status === "fulfilled") {
      this.metrics = metricsResult.value;
    }
  };

  getLastMetricValues(node: Node, metricNames: (keyof NodeMetricData)[]): number[] {
    if (!this.metrics) {
      return [];
    }

    const nodeName = node.getName();

    return metricNames.map((metricName) => {
      try {
        const metric = this.metrics?.[metricName];
        const result = metric?.data.result.find(
          ({ metric: { node, instance, kubernetes_node } }) =>
            nodeName === node || nodeName === instance || nodeName === kubernetes_node,
        );

        return result ? parseFloat(result.values.slice(-1)[0][1]) : 0;
      } catch (e) {
        return 0;
      }
    });
  }

  getNodeCpuUsage(node: Node) {
    const metrics = this.props.nodeStore.getNodeKubeMetrics(node);

    return bytesToUnitsAligned(metrics.cpu);
  }

  getNodeMemoryUsage(node: Node) {
    const metrics = this.props.nodeStore.getNodeKubeMetrics(node);

    return bytesToUnitsAligned(metrics.memory);
  }

  private renderUsage({ node, title, metricNames, formatters, usageText }: UsageArgs) {
    const metrics = this.getLastMetricValues(node, metricNames);

    if (!metrics || metrics.length < 2 || metrics[1] == 0) {
      return <span className="usageText">{usageText ?? "N/A"}</span>;
    }

    const [usage, capacity] = metrics;

    return (
      <LineProgress
        max={capacity}
        value={usage}
        tooltip={{
          preferredPositions: TooltipPosition.BOTTOM,
          children: `${title}: ${(title === "CPU" && usageText ? [usageText] : [])
            .concat(formatters.map((formatter) => formatter([usage, capacity])))
            .join(", ")}`,
        }}
      />
    );
  }

  renderCpuUsage(node: Node) {
    return this.renderUsage({
      node,
      title: "CPU",
      metricNames: ["cpuUsage", "cpuCapacity"],
      formatters: [([usage, capacity]) => `${((usage * 100) / capacity).toFixed(2)}%`, ([, cap]) => `cores: ${cap}`],
      usageText: this.getNodeCpuUsage(node),
    });
  }

  renderMemoryUsage(node: Node) {
    return this.renderUsage({
      node,
      title: "Memory",
      metricNames: ["workloadMemoryUsage", "memoryAllocatableCapacity"],
      formatters: [
        ([usage, capacity]) => `${((usage * 100) / capacity).toFixed(2)}%`,
        ([usage]) => bytesToUnits(usage, { precision: 3 }),
      ],
      usageText: this.getNodeMemoryUsage(node),
    });
  }

  renderDiskUsage(node: Node) {
    return this.renderUsage({
      node,
      title: "Disk",
      metricNames: ["fsUsage", "fsSize"],
      formatters: [
        ([usage, capacity]) => `${((usage * 100) / capacity).toFixed(2)}%`,
        ([usage]) => bytesToUnits(usage, { precision: 3 }),
      ],
    });
  }

  @computed
  private get gpuAllocatedByNode(): Map<string, number> {
    const result = new Map<string, number>();
    const pods = this.props.podStore.items;

    for (const pod of pods) {
      const phase = pod.getStatusPhase();

      if (phase !== "Running") {
        continue;
      }

      const nodeName = pod.getNodeName();

      if (!nodeName) {
        continue;
      }

      for (const container of pod.getContainers()) {
        const gpuRequest = container.resources?.requests?.[GPU_RESOURCE_KEY];

        if (gpuRequest) {
          result.set(nodeName, (result.get(nodeName) ?? 0) + (parseInt(gpuRequest, 10) || 0));
        }
      }
    }

    return result;
  }

  private getNodeGpuAllocated(node: Node): number {
    return this.gpuAllocatedByNode.get(node.getName()) ?? 0;
  }

  renderGpuUsage(node: Node) {
    const allocatable = node.status?.allocatable?.[GPU_RESOURCE_KEY];

    if (!allocatable) {
      return <span>-</span>;
    }

    const capacity = parseInt(allocatable, 10) || 0;

    if (capacity === 0) {
      return <span>-</span>;
    }

    const allocated = this.getNodeGpuAllocated(node);
    const isFullyFree = allocated === 0;
    const hasCapacityWarning = capacity !== 8;

    return (
      <span className="flex gaps align-center">
        <span className={isFullyFree ? "gpu-free" : undefined}>{`${allocated}/${capacity}`}</span>
        {hasCapacityWarning && (
          <GpuCapacityWarningIcon
            tooltip={{
              formatters: { nowrap: true },
              children: <div>GPU capacity is {capacity}, expected 8</div>,
            }}
          />
        )}
      </span>
    );
  }

  render() {
    const { nodeStore, eventStore, podStore } = this.props;

    return (
      <TabLayout>
        <KubeObjectListLayout
          isConfigurable
          tableId="nodes"
          className="Nodes"
          store={nodeStore}
          isReady={nodeStore.isLoaded}
          dependentStores={[eventStore, podStore]}
          isSelectable={false}
          sortingCallbacks={{
            [columnId.name]: (node) => node.getName(),
            [columnId.cpu]: (node) => this.getLastMetricValues(node, ["cpuUsage"]),
            [columnId.memory]: (node) => this.getLastMetricValues(node, ["memoryUsage"]),
            [columnId.disk]: (node) => this.getLastMetricValues(node, ["fsUsage"]),
            [columnId.gpu]: (node) => this.getNodeGpuAllocated(node),
            [columnId.taints]: (node) => node.getTaints().length,
            [columnId.roles]: (node) => node.getRoleLabels(),
            [columnId.version]: (node) => node.getKubeletVersion(),
            [columnId.internalIp]: (node) => node.getInternalIP(),
            [columnId.age]: (node) => -node.getCreationTimestamp(),
            [columnId.schedulable]: (node) => (node.isUnschedulable() ? "False" : "True"),
            [columnId.conditions]: (node) => node.getNodeConditionText(),
          }}
          searchFilters={[
            (node) => node.getSearchFields(),
            (node) => node.getRoleLabels(),
            (node) => node.getKubeletVersion(),
            (node) => node.getNodeConditionText(),
            (node) => node.getInternalIP(),
            (node) => node.getExternalIP(),
          ]}
          renderHeaderTitle="Nodes"
          renderTableHeader={[
            { title: "Name", className: "name", sortBy: columnId.name, id: columnId.name },
            { title: "CPU", className: "cpu", sortBy: columnId.cpu, id: columnId.cpu },
            { title: "Memory", className: "memory", sortBy: columnId.memory, id: columnId.memory },
            { title: "Disk", className: "disk", sortBy: columnId.disk, id: columnId.disk },
            { title: "GPU", className: "gpu", sortBy: columnId.gpu, id: columnId.gpu },
            { title: "Roles", className: "roles", sortBy: columnId.roles, id: columnId.roles },
            { title: "Taints", className: "taints", sortBy: columnId.taints, id: columnId.taints },
            { title: "Version", className: "version", sortBy: columnId.version, id: columnId.version },
            { title: "Internal IP", className: "internalIp", sortBy: columnId.internalIp, id: columnId.internalIp },
            { title: "Age", className: "age", sortBy: columnId.age, id: columnId.age },
            { title: "Schedulable", className: "schedulable", sortBy: columnId.schedulable, id: columnId.schedulable },
            {
              title: "Conditions",
              className: "conditions scrollable",
              sortBy: columnId.conditions,
              id: columnId.conditions,
            },
          ]}
          renderTableContents={(node) => {
            const tooltipId = `node-taints-${node.getId()}`;
            const taints = node.getTaints();

            return [
              <WithTooltip>{node.getName()}</WithTooltip>,
              this.renderCpuUsage(node),
              this.renderMemoryUsage(node),
              this.renderDiskUsage(node),
              this.renderGpuUsage(node),
              <WithTooltip>{node.getRoleLabels()}</WithTooltip>,
              <>
                <span id={tooltipId}>{taints.length}</span>
                <Tooltip targetId={tooltipId} tooltipOnParentHover={true} style={{ whiteSpace: "pre-line" }}>
                  {taints.map(formatNodeTaint).join("\n")}
                </Tooltip>
              </>,
              <WithTooltip>{node.getKubeletVersion()}</WithTooltip>,
              <WithTooltip>{node.getInternalIP()}</WithTooltip>,
              <KubeObjectAge key="age" object={node} />,
              <BadgeBoolean value={!node.isUnschedulable()} />,
              <KubeObjectConditionsList key="conditions" object={node} />,
            ];
          }}
        />
      </TabLayout>
    );
  }
}

export const NodesRoute = withInjectables<Dependencies>(NonInjectedNodesRoute, {
  getProps: (di, props) => ({
    ...props,
    nodeStore: di.inject(nodeStoreInjectable),
    eventStore: di.inject(eventStoreInjectable),
    requestAllNodeMetrics: di.inject(requestAllNodeMetricsInjectable),
    podStore: di.inject(podStoreInjectable),
  }),
});
