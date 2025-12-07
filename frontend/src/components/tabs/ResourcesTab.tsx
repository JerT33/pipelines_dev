/*
 * Copyright 2024 The Kubeflow Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as React from 'react';
import { useQuery } from 'react-query';
import { ErrorBoundary } from 'src/atoms/ErrorBoundary';
import { commonCss, padding } from 'src/Css';
import { Apis, JSONObject } from 'src/lib/Apis';
import Banner from '../Banner';
import DetailsTable from '../DetailsTable';
// @ts-ignore
import LineChart from 'react-svg-line-chart';

interface ResourcesTabProps {
  podName: string;
  podNamespace: string;
}

interface ContainerResources {
  containerName: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
}

interface ContainerMetrics {
  containerName: string;
  cpuUsage: string;
  memoryUsage: string;
}

interface MetricsDataPoint {
  timestamp: number;
  cpuMillicores: number;
  memoryMi: number;
}

interface ContainerMetricsHistory {
  [containerName: string]: MetricsDataPoint[];
}

function extractContainerResources(pod: JSONObject): ContainerResources[] {
  const containers: ContainerResources[] = [];

  const spec = pod.spec as JSONObject | undefined;
  if (!spec) return containers;

  const containerSpecs = spec.containers as JSONObject[] | undefined;
  if (!containerSpecs || !Array.isArray(containerSpecs)) return containers;

  for (const container of containerSpecs) {
    const name = (container.name as string) || 'unknown';
    const resources = container.resources as JSONObject | undefined;

    const requests = (resources?.requests as JSONObject) || {};
    const limits = (resources?.limits as JSONObject) || {};

    containers.push({
      containerName: name,
      cpuRequest: (requests.cpu as string) || '-',
      cpuLimit: (limits.cpu as string) || '-',
      memoryRequest: (requests.memory as string) || '-',
      memoryLimit: (limits.memory as string) || '-',
    });
  }

  return containers;
}

function extractContainerMetrics(metrics: JSONObject): ContainerMetrics[] {
  const result: ContainerMetrics[] = [];

  const containers = metrics.containers as JSONObject[] | undefined;
  if (!containers || !Array.isArray(containers)) return result;

  for (const container of containers) {
    const name = (container.name as string) || 'unknown';
    const usage = container.usage as JSONObject | undefined;

    result.push({
      containerName: name,
      cpuUsage: (usage?.cpu as string) || '-',
      memoryUsage: (usage?.memory as string) || '-',
    });
  }

  return result;
}

function parseCpuToMillicores(cpu: string): number {
  if (cpu === '-' || !cpu) return 0;
  if (cpu.endsWith('n')) {
    return Math.round(parseInt(cpu.slice(0, -1), 10) / 1000000);
  }
  if (cpu.endsWith('m')) {
    return parseInt(cpu.slice(0, -1), 10);
  }
  // Assume whole cores
  return parseInt(cpu, 10) * 1000;
}

function parseMemoryToMi(memory: string): number {
  if (memory === '-' || !memory) return 0;
  if (memory.endsWith('Ki')) {
    return Math.round(parseInt(memory.slice(0, -2), 10) / 1024);
  }
  if (memory.endsWith('Mi')) {
    return parseInt(memory.slice(0, -2), 10);
  }
  if (memory.endsWith('Gi')) {
    return parseInt(memory.slice(0, -2), 10) * 1024;
  }
  // Assume bytes
  return Math.round(parseInt(memory, 10) / (1024 * 1024));
}

function formatCpuUsage(cpu: string): string {
  if (cpu === '-') return cpu;
  if (cpu.endsWith('n')) {
    const nanocores = parseInt(cpu.slice(0, -1), 10);
    const millicores = Math.round(nanocores / 1000000);
    return `${millicores}m`;
  }
  return cpu;
}

function formatMemoryUsage(memory: string): string {
  if (memory === '-') return memory;
  if (memory.endsWith('Ki')) {
    const kibibytes = parseInt(memory.slice(0, -2), 10);
    const mebibytes = Math.round(kibibytes / 1024);
    return `${mebibytes}Mi`;
  }
  return memory;
}

const CHART_HEIGHT = 120;
const CHART_WIDTH = 400;
const MAX_DATA_POINTS = 300; // Keep last 300 data points (5 minutes at 1s intervals)

interface MetricsChartProps {
  data: MetricsDataPoint[];
  valueKey: 'cpuMillicores' | 'memoryMi';
  color: string;
  title: string;
  unit: string;
  limit?: number;
}

function MetricsChart({ data, valueKey, color, title, unit, limit }: MetricsChartProps) {
  if (data.length < 2) {
    return (
      <div style={{ padding: '10px', color: '#666', fontSize: '12px' }}>
        Collecting data... ({data.length}/2 points)
      </div>
    );
  }

  const values = data.map(d => d[valueKey]);
  const maxValue = Math.max(...values, limit || 0);
  const minValue = 0;
  const range = maxValue - minValue || 1;

  // Normalize data to fit chart
  const chartData = data.map((d, i) => ({
    x: (i / (data.length - 1)) * CHART_WIDTH,
    y: CHART_HEIGHT - ((d[valueKey] - minValue) / range) * CHART_HEIGHT * 0.8 - CHART_HEIGHT * 0.1,
  }));

  // Create limit line if provided
  const limitY = limit ? CHART_HEIGHT - ((limit - minValue) / range) * CHART_HEIGHT * 0.8 - CHART_HEIGHT * 0.1 : null;

  const currentValue = values[values.length - 1];
  const maxRecorded = Math.max(...values);

  return (
    <div style={{ marginBottom: 15 }}>
      <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: 5 }}>{title}</div>
      <div style={{ position: 'relative', border: '1px solid #e0e0e0', borderRadius: 4, padding: 5, background: '#fafafa' }}>
        <LineChart
          data={chartData}
          areaVisible={true}
          areaColor={color}
          areaOpacity={0.2}
          axisVisible={false}
          gridVisible={false}
          labelsVisible={false}
          pathColor={color}
          pathVisible={true}
          pathWidth={2}
          pathOpacity={1}
          pointsVisible={false}
          viewBoxHeight={CHART_HEIGHT}
          viewBoxWidth={CHART_WIDTH}
          pathSmoothing={0.2}
        />
        {limitY !== null && (
          <svg
            style={{ position: 'absolute', top: 5, left: 5, pointerEvents: 'none' }}
            width={CHART_WIDTH}
            height={CHART_HEIGHT}
          >
            <line
              x1={0}
              y1={limitY}
              x2={CHART_WIDTH}
              y2={limitY}
              stroke="#f44336"
              strokeWidth={1}
              strokeDasharray="4,4"
            />
            <text x={CHART_WIDTH - 5} y={limitY - 3} fontSize={10} fill="#f44336" textAnchor="end">
              limit
            </text>
          </svg>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#666', marginTop: 3 }}>
        <span>Current: {currentValue}{unit}</span>
        <span>Max: {maxRecorded}{unit}</span>
        {limit && <span>Limit: {limit}{unit}</span>}
      </div>
    </div>
  );
}

export function ResourcesTab({ podName, podNamespace }: ResourcesTabProps) {
  const [metricsHistory, setMetricsHistory] = React.useState<ContainerMetricsHistory>({});
  const startTimeRef = React.useRef<number>(Date.now());

  const {
    isLoading: isLoadingPod,
    error: podError,
    data: pod,
  } = useQuery<JSONObject, Error>(
    ['pod_info', { podName, podNamespace }],
    () => Apis.getPodInfo(podName, podNamespace),
    { staleTime: Infinity },
  );

  const {
    isLoading: isLoadingMetrics,
    error: metricsError,
    data: metrics,
  } = useQuery<JSONObject, Error>(
    ['pod_metrics', { podName, podNamespace }],
    () => Apis.getPodMetrics(podName, podNamespace),
    { staleTime: 1000, refetchInterval: 1000, cacheTime: 3000 },
  );

  // Accumulate metrics history
  React.useEffect(() => {
    if (!metrics) return;

    const containerMetrics = extractContainerMetrics(metrics);
    const timestamp = Date.now() - startTimeRef.current;

    setMetricsHistory(prev => {
      const updated = { ...prev };
      for (const cm of containerMetrics) {
        const dataPoint: MetricsDataPoint = {
          timestamp,
          cpuMillicores: parseCpuToMillicores(cm.cpuUsage),
          memoryMi: parseMemoryToMi(cm.memoryUsage),
        };

        if (!updated[cm.containerName]) {
          updated[cm.containerName] = [];
        }

        // Check if this is a new data point (avoid duplicates)
        const lastPoint = updated[cm.containerName][updated[cm.containerName].length - 1];
        if (!lastPoint || lastPoint.timestamp !== timestamp) {
          updated[cm.containerName] = [...updated[cm.containerName], dataPoint].slice(-MAX_DATA_POINTS);
        }
      }
      return updated;
    });
  }, [metrics]);

  if (isLoadingPod) {
    return (
      <div className={commonCss.page}>
        <div className={padding(20)}>
          <Banner message='Loading resource information...' mode='info' />
        </div>
      </div>
    );
  }

  if (podError) {
    return (
      <div className={commonCss.page}>
        <div className={padding(20)}>
          <Banner
            message='Failed to load resource information.'
            mode='error'
            additionalInfo={podError.message}
          />
        </div>
      </div>
    );
  }

  if (!pod) {
    return (
      <div className={commonCss.page}>
        <div className={padding(20)}>
          <Banner message='No pod information available.' mode='warning' />
        </div>
      </div>
    );
  }

  const containerResources = extractContainerResources(pod);
  const containerMetrics = metrics ? extractContainerMetrics(metrics) : [];

  const metricsMap = new Map<string, ContainerMetrics>();
  for (const m of containerMetrics) {
    metricsMap.set(m.containerName, m);
  }

  if (containerResources.length === 0) {
    return (
      <div className={commonCss.page}>
        <div className={padding(20)}>
          <Banner message='No resource information found for this pod.' mode='info' />
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className={commonCss.page}>
        <div className={padding(20)}>
          {metricsError && (
            <Banner
              message='Could not load live metrics. The pod may have completed (metrics are only available for running pods) or the metrics server may not be available.'
              mode='info'
              additionalInfo={metricsError.message}
            />
          )}
          {containerResources.map((container, index) => {
            const usage = metricsMap.get(container.containerName);
            const cpuUsage = usage ? formatCpuUsage(usage.cpuUsage) : '-';
            const memoryUsage = usage ? formatMemoryUsage(usage.memoryUsage) : '-';
            const history = metricsHistory[container.containerName] || [];

            const cpuLimitMillicores = parseCpuToMillicores(container.cpuLimit);
            const memoryLimitMi = parseMemoryToMi(container.memoryLimit);

            return (
              <div key={index} style={{ marginBottom: 30 }}>
                <DetailsTable
                  title={`Container: ${container.containerName}`}
                  fields={[
                    ['CPU Request', container.cpuRequest],
                    ['CPU Limit', container.cpuLimit],
                    ['CPU Usage (live)', cpuUsage],
                    ['Memory Request', container.memoryRequest],
                    ['Memory Limit', container.memoryLimit],
                    ['Memory Usage (live)', memoryUsage],
                  ]}
                />

                {history.length > 0 && (
                  <div style={{ marginTop: 15 }}>
                    <MetricsChart
                      data={history}
                      valueKey="cpuMillicores"
                      color="#1976d2"
                      title="CPU Usage Over Time"
                      unit="m"
                      limit={cpuLimitMillicores > 0 ? cpuLimitMillicores : undefined}
                    />
                    <MetricsChart
                      data={history}
                      valueKey="memoryMi"
                      color="#388e3c"
                      title="Memory Usage Over Time"
                      unit="Mi"
                      limit={memoryLimitMi > 0 ? memoryLimitMi : undefined}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {!isLoadingMetrics && !metricsError && metrics && (
            <div style={{ color: '#666', fontSize: '12px', marginTop: 10 }}>
              Live metrics refresh every 10 seconds • Charts show last {MAX_DATA_POINTS} data points
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
