/**
 * One AI interface, either provider.
 *
 * A client supplies whichever key they already have — Anthropic or OpenAI — and
 * everything downstream (review sentiment scoring, the written analysis) works
 * the same way. The provider is inferred from the key itself rather than asked
 * for separately: Anthropic keys start `sk-ant-`, OpenAI's start `sk-` and are
 * the fallback. One less field to get wrong, and a pasted key cannot be
 * mislabelled.
 *
 * Both are called over plain fetch. Neither SDK is a dependency, so adding a
 * provider costs nothing at install time.
 */

export type AiProvider = 'anthropic' | 'openai';

export interface AiKeyInfo {
  provider: AiProvider;
  key: string;
  model: string;
}

export interface AiCallResult {
  text: string;
  provider: AiProvider;
  model: string;
}

/** Problems the client can act on, kept distinct from a transient failure. */
export type AiKeyProblemKind = 'missing' | 'invalid' | 'no_credit' | 'rate_limited' | 'no_access';

export class AiKeyProblem extends Error {
  constructor(message: string, readonly kind: AiKeyProblemKind, readonly provider?: AiProvider) {
    super(message);
  }
}

const DEFAULT_MODELS: Record<AiProvider, string> = {
  // Cheap and fast; both are used in tight loops over thousands of reviews.
  anthropic: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
  openai:    process.env.OPENAI_MODEL    || 'gpt-4o-mini',
};

/**
 * Work out which provider a key belongs to.
 *
 * Order matters: every Anthropic key also satisfies the OpenAI `sk-` prefix, so
 * the more specific test has to come first.
 */
export function detectProvider(key: string): AiProvider | null {
  const k = (key || '').trim();
  if (!k) return null;
  if (k.startsWith('sk-ant-')) return 'anthropic';
  if (k.startsWith('sk-') || k.startsWith('sess-')) return 'openai';
  return null;
}

export function describeKey(key: string | null | undefined): AiKeyInfo | null {
  const k = (key || '').trim();
  const provider = detectProvider(k);
  if (!provider) return null;
  return { provider, key: k, model: DEFAULT_MODELS[provider] };
}

/** Turn a provider's error response into something the client can fix. */
function classify(provider: AiProvider, status: number, body: string): AiKeyProblem | null {
  const b = (body || '').toLowerCase();

  if (status === 401 || /invalid[_ -]?api[_ -]?key|authentication_error|incorrect api key/.test(b)) {
    return new AiKeyProblem(
      provider === 'anthropic'
        ? 'Your Claude API key was rejected. Add a new key and try again.'
        : 'Your OpenAI API key was rejected. Add a new key and try again.',
      'invalid', provider);
  }
  if (/credit balance|insufficient_quota|exceeded your current quota|billing/.test(b)) {
    return new AiKeyProblem(
      provider === 'anthropic'
        ? 'Your Claude API key has no credit left. Top it up or add a different key.'
        : 'Your OpenAI account is out of quota. Add credit or use a different key.',
      'no_credit', provider);
  }
  if (status === 403 || /does not have access|model_not_found|not allowed/.test(b)) {
    return new AiKeyProblem(
      `That key cannot use the model this feature needs (${DEFAULT_MODELS[provider]}).`,
      'no_access', provider);
  }
  if (status === 429) {
    return new AiKeyProblem('The provider is rate limiting this key. It will retry.', 'rate_limited', provider);
  }
  return null;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function callAnthropic(info: AiKeyInfo, system: string, user: string, maxTokens: number, attempt = 1): Promise<AiCallResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': info.key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: info.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });

  if (!res.ok) {
    const body = await res.text();
    const problem = classify('anthropic', res.status, body);
    // A bad key will never succeed; a rate limit or a server blip might.
    if (problem && problem.kind !== 'rate_limited') throw problem;
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(2000 * attempt);
      return callAnthropic(info, system, user, maxTokens, attempt + 1);
    }
    throw problem || new Error(`Anthropic ${res.status}: ${body.slice(0, 200)}`);
  }

  const body = await res.json();
  return { text: body.content?.[0]?.text || '', provider: 'anthropic', model: info.model };
}

async function callOpenAI(info: AiKeyInfo, system: string, user: string, maxTokens: number, attempt = 1): Promise<AiCallResult> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${info.key}` },
    body: JSON.stringify({
      model: info.model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    const problem = classify('openai', res.status, body);
    if (problem && problem.kind !== 'rate_limited') throw problem;
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(2000 * attempt);
      return callOpenAI(info, system, user, maxTokens, attempt + 1);
    }
    throw problem || new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
  }

  const body = await res.json();
  return { text: body.choices?.[0]?.message?.content || '', provider: 'openai', model: info.model };
}

/**
 * Send one prompt, whichever provider the key belongs to.
 * Throws AiKeyProblem for anything the client needs to fix.
 */
export async function aiComplete(opts: {
  key: string | null | undefined;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<AiCallResult> {
  const info = describeKey(opts.key);
  if (!info) {
    throw new AiKeyProblem(
      'No AI key is set for your account. Add a Claude or OpenAI key to enable AI analysis.',
      'missing');
  }
  const maxTokens = opts.maxTokens ?? 2048;
  return info.provider === 'anthropic'
    ? callAnthropic(info, opts.system, opts.user, maxTokens)
    : callOpenAI(info, opts.system, opts.user, maxTokens);
}

/**
 * Extract the first JSON value from a model reply.
 *
 * Both providers wrap JSON in prose or fences depending on mood, even when told
 * not to, so this is shared rather than repeated per call site.
 */
export function parseJsonReply<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1]
    : (text.match(/[[{][\s\S]*[\]}]/) || [text])[0];

  const raw = candidate.trim();
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    // Models occasionally leave a trailing comma before a closing bracket. It
    // is the single most common way an otherwise perfect reply fails to parse,
    // and throwing means paying for the batch again, so repair that one case
    // rather than retrying. Anything else still throws.
    const repaired = raw.replace(/,\s*([\]}])/g, '$1');
    if (repaired !== raw) return JSON.parse(repaired) as T;
    throw err;
  }
}

/** A cheap round trip, so the UI can tell the client their key works. */
export async function verifyKey(key: string): Promise<{ ok: true; provider: AiProvider; model: string } | { ok: false; error: string }> {
  const info = describeKey(key);
  if (!info) return { ok: false, error: 'That does not look like a Claude or OpenAI key.' };
  try {
    await aiComplete({ key, system: 'Reply with the single word: ok', user: 'ping', maxTokens: 8 });
    return { ok: true, provider: info.provider, model: info.model };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'The key could not be verified.' };
  }
}
