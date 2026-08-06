import { ApifyClient } from 'apify-client';
import { config } from '../config.js';
import { withRetry } from './retry.js';

let client: ApifyClient | null = null;

export function getApify(): ApifyClient {
  if (!config.apifyToken) {
    throw new Error('APIFY_TOKEN is not set');
  }
  if (!client) {
    client = new ApifyClient({ token: config.apifyToken });
  }
  return client;
}

export async function runActor<T = Record<string, unknown>>(
  actorId: string,
  input: Record<string, unknown>,
  opts: { label?: string } = {},
): Promise<T[]> {
  return withRetry(
    async () => {
      const apify = getApify();
      const run = await apify.actor(actorId).call(input, {
        waitSecs: 300,
      });
      if (!run.defaultDatasetId) {
        throw new Error(`Actor ${actorId} finished without a dataset`);
      }
      const { items } = await apify.dataset(run.defaultDatasetId).listItems({ limit: 10000 });
      return items as T[];
    },
    { attempts: 3, baseDelayMs: 2000, label: opts.label ?? actorId },
  );
}
