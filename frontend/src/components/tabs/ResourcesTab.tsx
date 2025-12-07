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

function formatUsageWithPercentage(usage: string, limitValue: number, unit: string): string {
  if (usage === '-') return usage;
  if (limitValue <= 0) return usage; // No limit set, just show the value

  // Parse the usage value
  let usageValue: number;
  if (unit === 'm') {
    usageValue = parseCpuToMillicores(usage);
  } else {
    usageValue = parseMemoryToMi(usage);
  }

  const percentage = Math.round((usageValue / limitValue) * 100);
  return `${usage} (${percentage}%)`;
}

const CHART_HEIGHT = 120;
const CHART_WIDTH = 400;
const MAX_DATA_POINTS = 300; // Keep last 300 data points (5 minutes at 1s intervals)

// localStorage key prefix for persisting metrics
const METRICS_STORAGE_KEY_PREFIX = 'kfp_pod_metrics_';

interface PersistedMetrics {
  history: ContainerMetricsHistory;
  maxCpu: { [containerName: string]: number };
  maxMemory: { [containerName: string]: number };
  lastUpdated: number;
}

function getStorageKey(podName: string, podNamespace: string): string {
  return `${METRICS_STORAGE_KEY_PREFIX}${podNamespace}_${podName}`;
}

function saveMetricsToStorage(
  podName: string,
  podNamespace: string,
  history: ContainerMetricsHistory,
): void {
  try {
    const maxCpu: { [containerName: string]: number } = {};
    const maxMemory: { [containerName: string]: number } = {};

    for (const [containerName, dataPoints] of Object.entries(history)) {
      if (dataPoints.length > 0) {
        maxCpu[containerName] = Math.max(...dataPoints.map(d => d.cpuMillicores));
        maxMemory[containerName] = Math.max(...dataPoints.map(d => d.memoryMi));
      }
    }

    const data: PersistedMetrics = {
      history,
      maxCpu,
      maxMemory,
      lastUpdated: Date.now(),
    };
    localStorage.setItem(getStorageKey(podName, podNamespace), JSON.stringify(data));
  } catch (e) {
    // localStorage might be full or disabled, silently fail
    console.warn('Failed to save metrics to localStorage:', e);
  }
}

function loadMetricsFromStorage(
  podName: string,
  podNamespace: string,
): PersistedMetrics | null {
  try {
    const stored = localStorage.getItem(getStorageKey(podName, podNamespace));
    if (stored) {
      return JSON.parse(stored) as PersistedMetrics;
    }
  } catch (e) {
    console.warn('Failed to load metrics from localStorage:', e);
  }
  return null;
}

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
    // Return an empty chart with a message when there's not enough data
    return (
      <div style={{ marginBottom: 15 }}>
        <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: 5 }}>{title}</div>
          <div style={{
            height: CHART_HEIGHT,
            width: CHART_WIDTH,
            border: '1px solid #e0e0e0',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#fafafa',
            color: '#666',
            fontSize: '12px'
          }}>
          {data.length === 0 ? 'No data available' : 'Collecting data...'}
          </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#666', marginTop: 3 }}>
            <span>Current: -{unit}</span>
            <span>Max: -{unit}</span>
            {limit && <span>Limit: {limit}{unit}</span>}
        </div>
      </div>
    );
  }

  const values = data.map(d => d[valueKey]);
  const maxRecorded = Math.max(...values);
  const currentValue = values[values.length - 1];

  // When a limit is set, always scale the chart relative to the limit
  // This ensures the limit line is always at the top of the chart
  // and usage values are shown as proportions of the limit
  const chartMaxValue = limit && limit > 0 ? limit : maxRecorded;
  const range = chartMaxValue || 1;

  // Chart padding: small margin at top for the limit label
  const TOP_MARGIN = 15; // pixels for limit label
  const CHART_AREA_HEIGHT = CHART_HEIGHT - TOP_MARGIN;

  // Calculate points for the area chart
  // Y coordinate: 0 = top of chart area, CHART_AREA_HEIGHT = bottom (0 value)
  const points = data.map((d, i) => {
    const x = data.length === 1 ? CHART_WIDTH / 2 : (i / (data.length - 1)) * CHART_WIDTH;
    const normalizedValue = d[valueKey] / range;
    // Clamp between 0 and 1
    const clampedValue = Math.max(0, Math.min(normalizedValue, 1));
    // Y goes from bottom (CHART_AREA_HEIGHT) at value 0 to top (0) at value = limit
    const y = TOP_MARGIN + CHART_AREA_HEIGHT * (1 - clampedValue);
    return { x, y };
  });

  // Build the SVG path for the line
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Build the SVG path for the filled area (line + close to bottom)
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${CHART_HEIGHT} L ${points[0].x} ${CHART_HEIGHT} Z`;

  // Limit line Y position (at the top of chart area, representing 100% of limit)
  const limitY = TOP_MARGIN;

  return (
    <div style={{ marginBottom: 15 }}>
      <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: 5 }}>{title}</div>
      <div style={{ border: '1px solid #e0e0e0', borderRadius: 4, background: '#fafafa' }}>
        <svg width={CHART_WIDTH} height={CHART_HEIGHT} style={{ display: 'block' }}>
          {/* Filled area */}
          <path d={areaPath} fill={color} fillOpacity={0.2} />
          {/* Line */}
          <path d={linePath} fill="none" stroke={color} strokeWidth={2} />
          {/* Limit line */}
          {limit && limit > 0 && (
            <>
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
            </>
          )}
        </svg>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#666', marginTop: 3 }}>
        <span>Current: {currentValue}{unit}</span>
        <span>Max: {maxRecorded}{unit}</span>
        {limit && <span>Limit: {limit}{unit}</span>}
      </div>
    </div>
  );
}

// Helper to check if pod is in a terminal state
function isPodFinished(pod: JSONObject | undefined): boolean {
  if (!pod) return false;
  const status = pod.status as JSONObject | undefined;
  if (!status) return false;
  const phase = status.phase as string | undefined;
  return phase === 'Succeeded' || phase === 'Failed' || phase === 'Unknown';
}

// Helper to get pod phase for display
function getPodPhase(pod: JSONObject | undefined): string {
  if (!pod) return 'Unknown';
  const status = pod.status as JSONObject | undefined;
  return (status?.phase as string) || 'Unknown';
}

export function ResourcesTab({ podName, podNamespace }: ResourcesTabProps) {
  const [metricsHistory, setMetricsHistory] = React.useState<ContainerMetricsHistory>({});
  const [cachedMaxCpu, setCachedMaxCpu] = React.useState<{ [containerName: string]: number }>({});
  const [cachedMaxMemory, setCachedMaxMemory] = React.useState<{ [containerName: string]: number }>({});
  const [cachedLastUpdated, setCachedLastUpdated] = React.useState<number | null>(null);
  const [backendSaveScheduled, setBackendSaveScheduled] = React.useState(false);
  const startTimeRef = React.useRef<number>(Date.now());
  const lastBackendSaveRef = React.useRef<number>(0);

  // Load cached metrics on mount - localStorage first (immediate), then try backend
  React.useEffect(() => {
    // First, load from localStorage immediately (this is synchronous and reliable)
    const cached = loadMetricsFromStorage(podName, podNamespace);
    if (cached) {
      setMetricsHistory(cached.history);
      setCachedMaxCpu(cached.maxCpu);
      setCachedMaxMemory(cached.maxMemory);
      setCachedLastUpdated(cached.lastUpdated);
    }

    // Then try to load from backend (might have newer/more complete data)
    async function tryLoadFromBackend() {
      try {
        const backendData = await Apis.getPodMetricsHistory(podName, podNamespace);
        if (backendData) {
          const data = backendData as unknown as PersistedMetrics;
          // Only use backend data if it has history and is newer than localStorage
          if (data.history && Object.keys(data.history).length > 0) {
            const localLastUpdated = cached?.lastUpdated || 0;
            if (data.lastUpdated && data.lastUpdated > localLastUpdated) {
              setMetricsHistory(data.history);
              setCachedMaxCpu(data.maxCpu || {});
              setCachedMaxMemory(data.maxMemory || {});
              setCachedLastUpdated(data.lastUpdated);
              // Update localStorage with backend data
              saveMetricsToStorage(podName, podNamespace, data.history);
            }
          }
        }
      } catch (err) {
        // Backend storage is optional - just log and continue
        console.debug('Backend metrics storage not available:', err);
      }
    }
    tryLoadFromBackend();
  }, [podName, podNamespace]);

  // Save to backend storage periodically (every 30 seconds) and on unmount
  React.useEffect(() => {
    const saveToBackend = async () => {
      if (Object.keys(metricsHistory).length === 0) return;
      // Don't save more frequently than every 30 seconds
      const now = Date.now();
      if (now - lastBackendSaveRef.current < 30000) return;

      const maxCpu: { [containerName: string]: number } = {};
      const maxMemory: { [containerName: string]: number } = {};
      for (const [containerName, dataPoints] of Object.entries(metricsHistory)) {
        if (dataPoints.length > 0) {
          maxCpu[containerName] = Math.max(...dataPoints.map(d => d.cpuMillicores));
          maxMemory[containerName] = Math.max(...dataPoints.map(d => d.memoryMi));
        }
      }

      try {
        await Apis.savePodMetricsHistory(podName, podNamespace, {
          history: metricsHistory,
          maxCpu,
          maxMemory,
          lastUpdated: now,
        } as unknown as JSONObject);
        lastBackendSaveRef.current = now;
        setBackendSaveScheduled(false);
      } catch (err) {
        console.warn('Failed to save metrics to backend:', err);
      }
    };

    // Save on interval if there's new data
    const intervalId = setInterval(() => {
      if (backendSaveScheduled) {
        saveToBackend();
      }
    }, 30000);

    // Save on unmount
    return () => {
      clearInterval(intervalId);
      saveToBackend();
    };
  }, [metricsHistory, podName, podNamespace, backendSaveScheduled]);

  const {
    isLoading: isLoadingPod,
    error: podError,
    data: pod,
  } = useQuery<JSONObject, Error>(
    ['pod_info', { podName, podNamespace }],
    () => Apis.getPodInfo(podName, podNamespace),
    { staleTime: 30000 }, // Cache for 30 seconds
  );

  // Check if pod is finished to avoid unnecessary metrics polling
  const podFinished = isPodFinished(pod);

  const {
    isLoading: isLoadingMetrics,
    error: metricsError,
    data: metrics,
  } = useQuery<JSONObject, Error>(
    ['pod_metrics', { podName, podNamespace }],
    () => Apis.getPodMetrics(podName, podNamespace),
    {
      staleTime: 10,
      refetchInterval: podFinished ? false : 1000, // Poll every 1s for running pods, don't poll for finished
      cacheTime: 30,
      enabled: !podFinished, // Don't even try to fetch if pod is finished
      retry: podFinished ? false : 3, // Don't retry for finished pods
    },
  );

  // Accumulate metrics history and persist to localStorage
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

      // Persist to localStorage
      saveMetricsToStorage(podName, podNamespace, updated);

      return updated;
    });

    // Schedule backend save
    setBackendSaveScheduled(true);
  }, [metrics, podName, podNamespace]);

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

  // Format the cached timestamp for display
  const formatCachedTime = (timestamp: number | null): string => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - timestamp;
    const diffMins = Math.round(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins === 1) return '1 minute ago';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffMins < 120) return '1 hour ago';
    if (diffMins < 1440) return `${Math.round(diffMins / 60)} hours ago`;
    return date.toLocaleString();
  };

  const hasCachedData = Object.keys(metricsHistory).length > 0;
  const podPhase = getPodPhase(pod);

  return (
    <ErrorBoundary>
      <div className={commonCss.page}>
        <div className={padding(20)}>
          {/* Show banner for finished pods */}
          {podFinished && (
            <Banner
              message={
                hasCachedData
                  ? `Pod ${podPhase.toLowerCase()}. Showing cached metrics${cachedLastUpdated ? ` from ${formatCachedTime(cachedLastUpdated)}` : ''}.`
                  : `Pod ${podPhase.toLowerCase()}. No cached metrics available. Metrics are only collected while viewing a running pod.`
              }
              mode='info'
            />
          )}
          {/* Show banner for running pods with metrics errors */}
          {!podFinished && metricsError && (
            <Banner
              message={
                hasCachedData
                  ? 'Unable to fetch live metrics. Showing cached data.'
                  : 'Could not load live metrics. The metrics server may not be available.'
              }
              mode='warning'
              additionalInfo={hasCachedData ? undefined : metricsError.message}
            />
          )}
          {containerResources.map((container, index) => {
            const usage = metricsMap.get(container.containerName);
            const cpuLimitMillicores = parseCpuToMillicores(container.cpuLimit);
            const memoryLimitMi = parseMemoryToMi(container.memoryLimit);
            const history = metricsHistory[container.containerName] || [];

            // Get cached max values for this container
            const maxCpuFromCache = cachedMaxCpu[container.containerName] || 0;
            const maxMemoryFromCache = cachedMaxMemory[container.containerName] || 0;

            // Calculate max from current history if available
            const maxCpuFromHistory = history.length > 0 ? Math.max(...history.map(d => d.cpuMillicores)) : 0;
            const maxMemoryFromHistory = history.length > 0 ? Math.max(...history.map(d => d.memoryMi)) : 0;

            // Use the greater of cached or current history max
            const maxCpu = Math.max(maxCpuFromCache, maxCpuFromHistory);
            const maxMemory = Math.max(maxMemoryFromCache, maxMemoryFromHistory);

            // Format usage with both numerical value and percentage of limit
            const formattedCpuUsage = usage ? formatCpuUsage(usage.cpuUsage) : '-';
            const formattedMemoryUsage = usage ? formatMemoryUsage(usage.memoryUsage) : '-';
            const cpuUsageDisplay = formatUsageWithPercentage(formattedCpuUsage, cpuLimitMillicores, 'm');
            const memoryUsageDisplay = formatUsageWithPercentage(formattedMemoryUsage, memoryLimitMi, 'Mi');

            // Format max values with percentage
            const maxCpuDisplay = maxCpu > 0
              ? formatUsageWithPercentage(`${maxCpu}m`, cpuLimitMillicores, 'm')
              : '-';
            const maxMemoryDisplay = maxMemory > 0
              ? formatUsageWithPercentage(`${maxMemory}Mi`, memoryLimitMi, 'Mi')
              : '-';

            // Determine if we're showing live or cached data
            const isLive = !!usage && !podFinished;

            return (
              <div key={index} style={{ marginBottom: 30 }}>
                <DetailsTable
                  title={`Container: ${container.containerName}`}
                  fields={[
                    ['CPU Request', container.cpuRequest],
                    ['CPU Limit', container.cpuLimit],
                    [isLive ? 'CPU Usage (live)' : 'CPU Usage', isLive ? cpuUsageDisplay : '-'],
                    ['Max CPU Observed', maxCpuDisplay],
                    ['Memory Request', container.memoryRequest],
                    ['Memory Limit', container.memoryLimit],
                    [isLive ? 'Memory Usage (live)' : 'Memory Usage', isLive ? memoryUsageDisplay : '-'],
                    ['Max Memory Observed', maxMemoryDisplay],
                  ]}
                />
                  <div style={{ marginTop: 15 }}>
                    <MetricsChart
                      data={history}
                      valueKey="cpuMillicores"
                      color="#1976d2"
                      title={isLive ? "CPU Usage Over Time" : "CPU Usage Over Time (cached)"}
                      unit="m"
                      limit={cpuLimitMillicores > 0 ? cpuLimitMillicores : undefined}
                    />
                    <MetricsChart
                      data={history}
                      valueKey="memoryMi"
                      color="#388e3c"
                      title={isLive ? "Memory Usage Over Time" : "Memory Usage Over Time (cached)"}
                      unit="Mi"
                      limit={memoryLimitMi > 0 ? memoryLimitMi : undefined}
                    />
                  </div>
              </div>
            );
          })}
          {/* Footer info for running pods with live metrics */}
          {!podFinished && !isLoadingMetrics && !metricsError && metrics && (
            <div style={{ color: '#666', fontSize: '12px', marginTop: 10 }}>
              Live metrics refresh every second • Charts show last {MAX_DATA_POINTS} data points
            </div>
          )}
          {/* Footer info for finished pods with cached data */}
          {podFinished && hasCachedData && (
            <div style={{ color: '#666', fontSize: '12px', marginTop: 10 }}>
              Showing cached metrics • Charts show data collected during pod execution
              {cachedLastUpdated && ` • Last updated: ${new Date(cachedLastUpdated).toLocaleString()}`}
            </div>
          )}
          {/* Footer info for running pods with cached data (metrics error) */}
          {!podFinished && metricsError && hasCachedData && (
            <div style={{ color: '#666', fontSize: '12px', marginTop: 10 }}>
              Showing cached metrics • Data was collected while the pod was running
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
