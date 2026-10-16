import { createHash } from 'node:crypto';

// AI-similarity checking for assignment uploads. The score is advisory and provider-dependent: the same text can
// score differently between runs, so callers record every result with its provider, version and threshold.
export const aiCheckableTypes = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain'
};
export const aiCheckDailyLimit = 10;
const gptzeroEndpoint = 'https://api.gptzero.me/v2/predict/files';

export function loadAiCheckConfig(env = process.env) {
  const provider = env.SVU_AI_CHECK_PROVIDER || 'disabled';
  if (!['disabled', 'gptzero', 'simulated'].includes(provider)) throw new Error('SVU_AI_CHECK_PROVIDER must be disabled, gptzero or simulated.');
  const runtimeEnv = env.SVU_ENV || env.NODE_ENV || 'development';
  if (provider === 'simulated' && runtimeEnv !== 'development') throw new Error('The simulated AI checker is only available in development.');
  const threshold = env.SVU_AI_CHECK_THRESHOLD === undefined ? 20 : Number(env.SVU_AI_CHECK_THRESHOLD);
  if (!validThreshold(threshold)) throw new Error('SVU_AI_CHECK_THRESHOLD must be a percentage from 0 to 100 with up to two decimals.');
  if (provider === 'gptzero') {
    const apiKey = env.SVU_GPTZERO_API_KEY;
    if (!apiKey || /\s/.test(apiKey) || apiKey.length > 200) throw new Error('The GPTZero AI checker requires SVU_GPTZERO_API_KEY.');
    return { provider, apiKey, threshold };
  }
  return { provider, threshold };
}

export function validThreshold(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
}

export function aiCheckable(fileName) {
  return Object.hasOwn(aiCheckableTypes, String(fileName).split('.').at(-1).toLowerCase());
}

// A score strictly above the allowable percentage is over the threshold.
export function aiVerdict(score, threshold) {
  return { aboveThreshold: score > threshold };
}

const probability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const percent = value => Math.round(value * 10000) / 100;

// GPTZero document predictions: class_probabilities { ai, human, mixed } and predicted_class.
export function parseGptzeroResponse(data) {
  const document = Array.isArray(data?.documents) ? data.documents[0] : null;
  const classes = document?.class_probabilities;
  if (!classes || !probability(classes.ai) || !probability(classes.human) || !probability(classes.mixed)) throw Object.assign(new Error('AI checker response invalid'), { aiCode: 'INVALID_RESPONSE' });
  const predictedClass = ['ai', 'human', 'mixed'].includes(document.predicted_class) ? document.predicted_class : null;
  const version = typeof data.version === 'string' && /^[\w.:-]{1,64}$/.test(data.version) ? data.version : null;
  return { aiScore: percent(classes.ai), mixedScore: percent(classes.mixed), humanScore: percent(classes.human), predictedClass, providerVersion: version };
}

// The endpoint is fixed; request data cannot choose where student work is sent.
export function gptzeroAdapter(config, { fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  return async ({ bytes, fileName, contentType }) => {
    const form = new FormData();
    form.append('files', new Blob([bytes], { type: contentType }), fileName);
    let response;
    try {
      response = await fetchImpl(gptzeroEndpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { 'x-api-key': config.apiKey, Accept: 'application/json' }, body: form });
    } catch { throw Object.assign(new Error('AI checker unavailable'), { aiCode: 'PROVIDER_UNAVAILABLE' }); }
    let data;
    try { data = await response.json(); } catch { throw Object.assign(new Error('AI checker response invalid'), { aiCode: 'INVALID_RESPONSE' }); }
    if (!response.ok) throw Object.assign(new Error('AI checker refused the file'), { aiCode: `PROVIDER_HTTP_${response.status}` });
    return parseGptzeroResponse(data);
  };
}

// Development only: a deterministic stand-in so the flow can be exercised without sending work anywhere. A text
// file containing "[[ai-score:NN]]" scores NN; anything else scores from its checksum.
export function simulatedAdapter() {
  return async ({ bytes }) => {
    const marker = bytes.toString('utf8').match(/\[\[ai-score:(\d{1,3}(?:\.\d{1,2})?)\]\]/);
    const score = marker ? Math.min(100, Number(marker[1])) : createHash('sha256').update(bytes).digest()[0] % 101;
    const rest = Math.round((100 - score) * 100) / 100;
    return { aiScore: score, mixedScore: 0, humanScore: rest, predictedClass: score >= 50 ? 'ai' : 'human', providerVersion: 'simulated-1' };
  };
}

export function createAiChecker(config) {
  if (!config || config.provider === 'disabled') return null;
  return config.provider === 'gptzero' ? gptzeroAdapter(config) : simulatedAdapter();
}
