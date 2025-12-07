// Copyright 2024 The Kubeflow Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Handler } from 'express';
import { Client as MinioClient } from 'minio';
import { MinioConfigs, AWSConfigs } from '../configs';
import { createMinioClient } from '../minio-helper';
import { Readable } from 'stream';

interface MetricsDataPoint {
  timestamp: number;
  cpuMillicores: number;
  memoryMi: number;
}

interface ContainerMetricsHistory {
  [containerName: string]: MetricsDataPoint[];
}

interface StoredMetrics {
  history: ContainerMetricsHistory;
  maxCpu: { [containerName: string]: number };
  maxMemory: { [containerName: string]: number };
  lastUpdated: number;
}

// Generate the storage key for metrics
function getMetricsKey(podNamespace: string, podName: string): string {
  return `metrics/${podNamespace}/${podName}/metrics-history.json`;
}

/**
 * Creates handlers for storing and retrieving pod metrics history.
 * Uses the same minio/s3 storage as log archival.
 */
export function createPodMetricsHistoryHandlers(
  artifactoryType: string,
  bucketName: string,
  artifactsOptions: {
    minio: MinioConfigs;
    aws: AWSConfigs;
  },
): { getHandler: Handler; saveHandler: Handler } {
  let minioClient: MinioClient | null = null;

  // Lazy initialization of minio client
  async function getClient(): Promise<MinioClient> {
    if (minioClient) return minioClient;

    const config = artifactoryType === 'minio' ? artifactsOptions.minio : artifactsOptions.aws;
    minioClient = await createMinioClient(
      {
        endPoint: config.endPoint,
        port: 'port' in config ? config.port : undefined,
        useSSL: config.useSSL,
        accessKey: config.accessKey,
        secretKey: config.secretKey,
      },
      artifactoryType,
    );
    return minioClient;
  }

  /**
   * GET handler to retrieve stored metrics history for a pod
   */
  const getHandler: Handler = async (req, res) => {
    const { podname, podnamespace } = req.query;

    if (!podname) {
      res.status(422).send('podname argument is required');
      return;
    }
    if (!podnamespace) {
      res.status(422).send('podnamespace argument is required');
      return;
    }

    const podName = decodeURIComponent(podname as string);
    const podNamespace = decodeURIComponent(podnamespace as string);
    const key = getMetricsKey(podNamespace, podName);

    try {
      const client = await getClient();
      const stream = await client.getObject(bucketName, key);

      // Collect stream data
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf-8');
        res.status(200).json(JSON.parse(data));
      });
      stream.on('error', (err: Error) => {
        // Object not found is expected for pods that haven't had metrics stored
        if ((err as any).code === 'NoSuchKey') {
          res.status(404).send('No stored metrics found for this pod');
        } else {
          console.error('Error retrieving metrics:', err);
          res.status(500).send('Failed to retrieve metrics history');
        }
      });
    } catch (err) {
      const error = err as { code?: string; message?: string };
      if (error.code === 'NoSuchKey') {
        res.status(404).send('No stored metrics found for this pod');
      } else {
        console.error('Error retrieving metrics:', err);
        res.status(500).send('Failed to retrieve metrics history: ' + (error.message || 'Unknown error'));
      }
    }
  };

  /**
   * POST handler to save metrics history for a pod
   */
  const saveHandler: Handler = async (req, res) => {
    const { podname, podnamespace } = req.query;

    if (!podname) {
      res.status(422).send('podname argument is required');
      return;
    }
    if (!podnamespace) {
      res.status(422).send('podnamespace argument is required');
      return;
    }

    const podName = decodeURIComponent(podname as string);
    const podNamespace = decodeURIComponent(podnamespace as string);
    const key = getMetricsKey(podNamespace, podName);

    const metricsData: StoredMetrics = req.body;

    if (!metricsData || !metricsData.history) {
      res.status(400).send('Invalid metrics data');
      return;
    }

    try {
      const client = await getClient();
      const data = JSON.stringify(metricsData);
      const buffer = Buffer.from(data, 'utf-8');

      await client.putObject(bucketName, key, buffer, buffer.length, {
        'Content-Type': 'application/json',
      });

      res.status(200).send('Metrics saved successfully');
    } catch (err) {
      const error = err as { message?: string };
      console.error('Error saving metrics:', err);
      res.status(500).send('Failed to save metrics history: ' + (error.message || 'Unknown error'));
    }
  };

  return { getHandler, saveHandler };
}
