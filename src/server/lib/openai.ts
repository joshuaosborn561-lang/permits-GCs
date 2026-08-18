import OpenAI from 'openai';
import { config } from '../config.js';
import { getSupabase, hasSupabase, ingestSecret } from './supabase.js';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }
  if (!client) {
    client = new OpenAI({
      apiKey: config.openaiApiKey,
      ...(config.openaiBaseUrl ? { baseURL: config.openaiBaseUrl } : {}),
    });
  }
  return client;
}

export async function structuredExtract<T>(opts: {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  runId?: string;
  propertyId?: string;
  step: string;
}): Promise<T> {
  if (config.demoMode || !config.openaiApiKey) {
    throw new Error('OPENAI_UNAVAILABLE');
  }

  const openai = getClient();
  const response = await openai.chat.completions.create({
    model: config.openaiModel,
    temperature: 0,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: opts.schemaName,
        strict: true,
        schema: opts.schema,
      },
    },
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? '{}';
  await logOpenAiCall({
    runId: opts.runId,
    propertyId: opts.propertyId,
    step: opts.step,
    rawInput: opts.user,
    rawOutput: raw,
  });

  return JSON.parse(raw) as T;
}

export async function logOpenAiCall(opts: {
  runId?: string;
  propertyId?: string;
  step: string;
  rawInput: string;
  rawOutput: string;
}): Promise<void> {
  if (!hasSupabase() || !opts.runId) return;
  try {
    const { error } = await getSupabase().rpc('log_pmf_openai', {
      p_secret: ingestSecret(),
      p_row: {
        run_id: opts.runId,
        property_id: opts.propertyId ?? null,
        step: opts.step,
        model: config.openaiModel,
        raw_input: opts.rawInput.slice(0, 20000),
        raw_output: opts.rawOutput.slice(0, 20000),
      },
    });
    if (error) console.warn('[openai] log_pmf_openai', error.message);
  } catch (err) {
    console.warn('[openai] failed to persist debug log', err);
  }
}
