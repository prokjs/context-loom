export const languages = Object.freeze({ en: 'English', ko: '한국어', 'zh-CN': '简体中文', ja: '日本語', es: 'Español', fr: 'Français', de: 'Deutsch', ru: 'Русский', pt: 'Português' });
export const answerLanguages = ['auto', ...Object.keys(languages)];
let current = 'en';
let messages = {};
let contract = null;
let sequence = 0;
const cache = new Map();
const placeholders = (text) => [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]).sort().join(',');
export const locale = () => current;
export function t(key, values = {}) {
  if (!Object.hasOwn(messages, key)) throw new Error(`Missing locale key: ${key}`);
  return messages[key].replace(/\{([A-Za-z0-9_]+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
}
async function fetchMessages(code) {
  if (cache.has(code)) return cache.get(code);
  const response = await fetch(`/locales/${code}.json`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Locale ${code}: HTTP ${response.status}`);
  const value = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some((text) => typeof text !== 'string' || !text.trim())) throw new Error(`Invalid locale: ${code}`);
  if (code === 'en') contract = value;
  else if (!contract || Object.keys(value).length !== Object.keys(contract).length || Object.keys(contract).some((key) => !Object.hasOwn(value, key) || placeholders(value[key]) !== placeholders(contract[key]))) throw new Error(`Locale contract mismatch: ${code}`);
  cache.set(code, value);
  return value;
}
export async function setLocale(code) {
  const request = ++sequence;
  if (!Object.hasOwn(languages, code)) throw new Error(`Unsupported locale: ${code}`);
  if (!contract) await fetchMessages('en');
  const value = await fetchMessages(code);
  if (request !== sequence) return false;
  messages = value;
  current = code;
  document.documentElement.lang = code;
  document.title = t('app.title');
  return true;
}
export function translateMarkup(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const [attribute, binding] of [['placeholder', 'i18nPlaceholder'], ['aria-label', 'i18nAriaLabel']]) {
    const selector = attribute === 'placeholder' ? '[data-i18n-placeholder]' : '[data-i18n-aria-label]';
    for (const node of root.querySelectorAll(selector)) node.setAttribute(attribute, t(node.dataset[binding]));
  }
}
