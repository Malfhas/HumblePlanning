/** Usual casing that the identifier alone cannot guess. */
const ACRONYMS: Record<string, string> = {
  ai: 'AI',
  deepseek: 'DeepSeek',
  gpt: 'GPT',
  openai: 'OpenAI',
  qwen: 'Qwen',
  vl: 'VL',
  xai: 'xAI',
};

/**
 * Display name of a model. OpenRouter publishes the commercial name - it is
 * used whenever available; otherwise the identifier is prettified, which stays readable:
 * "deepseek/deepseek-v4-flash" → "DeepSeek V4 Flash".
 */
export const modelLabel = (model: string, labels?: Record<string, string>) =>
  labels?.[model] ??
  (model.split('/').pop() ?? model)
    .split('-')
    .map((word) => ACRONYMS[word] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/**
 * Provider logo of a model, served from `public/modeles/` (MIT
 * "lobe-icons" set, see the license next to the files). The key is the
 * OpenRouter prefix (`deepseek/deepseek-v4-flash`); failing that, the model name is
 * often enough (`gemini-3.7-flash` at Google directly). `mono` flags a logo
 * drawn in black, to invert in dark theme.
 */
const PROVIDERS: Record<string, { file: string; mono?: boolean }> = {
  anthropic: { file: 'claude' },
  google: { file: 'gemini' },
  openai: { file: 'openai', mono: true },
  deepseek: { file: 'deepseek' },
  'x-ai': { file: 'grok', mono: true },
  'meta-llama': { file: 'meta' },
  moonshotai: { file: 'kimi' },
  perplexity: { file: 'perplexity' },
  qwen: { file: 'qwen' },
  'z-ai': { file: 'zhipu' },
  thudm: { file: 'zhipu' },
  mistralai: { file: 'mistral' },
  microsoft: { file: 'microsoft' },
  cohere: { file: 'cohere' },
  nvidia: { file: 'nvidia' },
  amazon: { file: 'aws', mono: true },
  minimax: { file: 'minimax' },
  baidu: { file: 'baidu' },
  inception: { file: 'inception', mono: true },
  nousresearch: { file: 'nousresearch', mono: true },
  ai21: { file: 'ai21', mono: true },
  stepfun: { file: 'stepfun' },
  tencent: { file: 'hunyuan' },
  bytedance: { file: 'doubao' },
  liquid: { file: 'liquid', mono: true },
  '01-ai': { file: 'yi', mono: true },
  'arcee-ai': { file: 'arcee' },
  openrouter: { file: 'openrouter' },
};

/** When the prefix says nothing: the family is recognised by name. */
const BY_NAME: [RegExp, string][] = [
  [/gpt|codex|\bo[1-9]-/, 'openai'],
  [/claude/, 'anthropic'],
  [/gemini|gemma/, 'google'],
  [/deepseek/, 'deepseek'],
  [/llama/, 'meta-llama'],
  [/kimi|moonshot/, 'moonshotai'],
  [/qwen|qwq/, 'qwen'],
  [/glm/, 'z-ai'],
  [/mistral|mixtral|magistral|devstral|codestral|ministral/, 'mistralai'],
  [/grok/, 'x-ai'],
  [/sonar/, 'perplexity'],
  [/phi-/, 'microsoft'],
  [/command/, 'cohere'],
];

export function modelLogo(model: string): { src: string; mono: boolean } | null {
  const id = model.toLowerCase();
  const slash = id.indexOf('/');
  const prefix = slash > 0 ? id.slice(0, slash) : null;
  const name = slash > 0 ? id.slice(slash + 1) : id;
  const key =
    (prefix && PROVIDERS[prefix] ? prefix : null) ??
    BY_NAME.find(([pattern]) => pattern.test(name))?.[1] ??
    null;
  const entry = key ? PROVIDERS[key] : undefined;
  // i18n-ignore path of a static file (public/modeles)
  return entry ? { src: `/modeles/${entry.file}.svg`, mono: Boolean(entry.mono) } : null;
}
