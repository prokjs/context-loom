import { languages, answerLanguages, locale, t, setLocale, translateMarkup } from './i18n.mjs';
const $ = (id) => document.getElementById(id);
const limits = { projects: 100, memories: 500, name: 120, field: 12000, tags: 500, task: 24000 };
const model = 'gpt-6-luna';
let state = { projects: [], activeProjectId: null, usage: [], uiLanguage: 'en' };
let loaded = false;
let revision = 0;
let preview = null;
let previewRevision = -1;
let compileSequence = 0;
let compiling = false;
let running = false;
let editingProjectId = null;
let editingMemoryId = null;
let answerProjectId = null;
let saveChain = Promise.resolve();
let saveError = null;
let pendingSaves = 0;
const drafts = new Map();
const activeProject = () => state.projects.find((p) => p.id === state.activeProjectId);
const id = () => crypto.randomUUID();
const money = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? t('money.unavailable') : `${new Intl.NumberFormat(locale(), { minimumFractionDigits: 6, maximumFractionDigits: 6 }).format(Number(value))} USD`;
const count = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : new Intl.NumberFormat(locale()).format(Number(value));
const dateText = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};
const statusText = (value) => ['completed', 'incomplete', 'failed', 'unknown', 'cancelled', 'in_progress', 'queued', 'refused', 'unrecorded'].includes(value) ? t(`status.${value}`) : t('status.technical', { status: value });
const bindings = new Map();
let visibleError = null;
let lastAnswer = null;
let localeRequest = 0;
function message(target, key, values = {}) {
  const node = $(target);
  delete node.dataset.i18n;
  bindings.set(target, { key, values });
  node.textContent = key ? t(key, typeof values === 'function' ? values() : values) : '';
}
class UiError extends Error {
  constructor(key, values = {}, cause = null) {
    super(key);
    this.key = key;
    this.values = values;
    this.cause = cause;
  }
}
const problem = (key, values = {}, cause = null) => new UiError(key, values, cause);
function errorText(error) {
  if (error instanceof UiError) {
    const text = t(error.key, typeof error.values === 'function' ? error.values() : error.values);
    return error.cause ? `${text}\n${errorText(error.cause)}` : text;
  }
  return `${t('error.generic')}\n${t('error.technical', { details: error instanceof Error ? error.message : String(error) })}`;
}
function renderError() {
  if (!visibleError) return;
  $('global-error').textContent = errorText(visibleError);
  if (!loaded) {
    const retry = element('button', t('error.retry'));
    retry.type = 'button';
    retry.addEventListener('click', () => { retry.disabled = true; load(); });
    $('global-error').append(document.createTextNode(' '), retry);
  }
}
function syncLanguageSelectors() {
  $('ui-language').value = locale();
  $('dialog-ui-language').value = locale();
}
function refreshLanguage() {
  translateMarkup();
  $('project-answer-language').options[0].textContent = t('language.auto');
  for (const [target, binding] of bindings) message(target, binding.key, binding.values);
  syncLanguageSelectors();
  if (loaded) renderWorkspace();
  if (preview) renderPreview(false);
  if (lastAnswer) renderAnswer();
  renderError();
  refreshValidation();
  refreshActions();
}
async function changeLanguage(code) {
  const request = ++localeRequest;
  $('api-consent').checked = false;
  refreshActions();
  try {
    if (!await setLocale(code) || request !== localeRequest) return;
    $('api-consent').checked = false;
    state.uiLanguage = code;
    refreshLanguage();
    scheduleSave();
  } catch (error) {
    if (request !== localeRequest) return;
    syncLanguageSelectors();
    showError(problem('language.failure', {}, error));
  }
}
function refreshValidation() {
  for (const field of document.querySelectorAll('input, textarea, select')) {
    field.setCustomValidity('');
    const validity = field.validity;
    if (validity.valueMissing) field.setCustomValidity(t('validation.required'));
    else if (validity.tooLong) field.setCustomValidity(t('validation.length', { limit: count(field.maxLength) }));
    else if (validity.badInput || validity.rangeOverflow || validity.rangeUnderflow || validity.stepMismatch) field.setCustomValidity(t('validation.number'));
  }
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function showError(error) {
  visibleError = error;
  renderError();
  $('global-error').hidden = false;
}
function clearError() { visibleError = null; $('global-error').hidden = true; }
function handle(action) {
  return (event) => {
    try { Promise.resolve(action(event)).catch(showError); }
    catch (error) { showError(error); }
  };
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  let data;
  try { data = await response.json(); } catch { throw problem('error.unreadable', { status: response.status }); }
  if (!response.ok) throw data.error ? new Error(data.error) : problem('error.request', { status: response.status });
  return data;
}
function scheduleSave() {
  if (!loaded) return;
  const snapshot = structuredClone({ projects: state.projects, activeProjectId: state.activeProjectId, uiLanguage: state.uiLanguage });
  pendingSaves++;
  message('save-status', 'save.saving');
  saveChain = saveChain.then(async () => {
    try {
      await api('/api/state', { method: 'PUT', body: JSON.stringify(snapshot) });
      saveError = null;
    } catch (error) {
      saveError = error;
      showError(problem('error.save', {}, error));
    } finally {
      pendingSaves--;
      if (!pendingSaves) message('save-status', saveError ? 'save.failed' : 'save.saved');
    }
  });
}
async function flushSaves() {
  let current;
  do { current = saveChain; await current; } while (current !== saveChain);
  if (saveError) throw problem('error.unsaved', {}, saveError);
}
function invalidatePreview(key = 'compile.changed') {
  revision++;
  $('api-consent').checked = false;
  if (preview) {
    message('preview-state', 'preview.stale');
    message('compile-status', key);
  }
  refreshActions();
}
function freshPreview() { return Boolean(preview && previewRevision === revision); }
function clearProjectResults() {
  preview = null;
  previewRevision = -1;
  answerProjectId = null;
  lastAnswer = null;
  $('preview').hidden = true;
  $('prompt-preview').value = '';
  $('estimate').hidden = true;
  message('pricing-info', 'api.pricingEmpty');
  $('answer-section').hidden = true;
  $('answer-text').textContent = '';
  message('compile-status', 'compile.local');
}
function refreshActions() {
  const fresh = freshPreview();
  $('project-select').disabled = !loaded || !state.projects.length || running;
  $('new-project').disabled = !loaded || state.projects.length >= limits.projects || running;
  $('compile-button').disabled = !loaded || !activeProject() || compiling || running;
  $('copy-prompt').disabled = !fresh || compiling;
  $('download-prompt').disabled = !fresh || compiling;
  $('api-consent').disabled = !fresh || running || compiling;
  $('run-button').disabled = !fresh || running || compiling || !$('api-consent').checked || !$('api-key').value.trim();
  message('run-button', running ? 'api.running' : 'api.run');
  message('consent-label', fresh ? 'api.consent' : 'api.consentEmpty', () => fresh ? { model, cost: money(preview.estimate.totalUSD) } : {});
}
function renderProjectSelect() {
  $('project-select').replaceChildren();
  if (!state.projects.length) {
    $('project-select').append(new Option(t('project.none'), ''));
  } else {
    for (const project of state.projects) $('project-select').append(new Option(project.name, project.id));
    $('project-select').value = state.activeProjectId;
  }
  $('project-select').disabled = !state.projects.length || running;
  $('new-project').disabled = state.projects.length >= limits.projects || running;
}
function renderWorkspace() {
  const project = activeProject();
  $('workspace').hidden = !project;
  $('empty-workspace').hidden = Boolean(project);
  renderProjectSelect();
  if (project) { renderProfile(); renderMemories(); }
  renderUsage();
  refreshActions();
}
function renderProfile() {
  const project = activeProject();
  const data = [
    [t('profile.project'), project.name], [t('profile.goal'), project.goal], [t('profile.scope'), project.scope || t('profile.unspecified')],
    [t('profile.constraints'), project.constraints || t('profile.unspecified')], [t('profile.detail'), t(`style.${project.style}`)],
    [t('profile.ambiguity'), t(`clarification.${project.clarification}`)],
    [t('language.answer'), (project.answerLanguage || 'auto') === 'auto' ? t('language.auto') : languages[project.answerLanguage]],
  ];
  const fragment = document.createDocumentFragment();
  for (const [label, value] of data) fragment.append(element('dt', label), element('dd', value));
  $('profile-content').replaceChildren(fragment);
}
function resetMemoryForm() {
  editingMemoryId = null;
  $('memory-form').reset();
  $('memory-enabled').checked = true;
  message('memory-form-title', 'memory.add');
  message('memory-submit', 'memory.save');
  $('memory-cancel').hidden = true;
}
function renderMemories() {
  const project = activeProject();
  const list = $('memory-list');
  list.replaceChildren();
  if (!project.memories.length) {
    list.append(element('p', t('memory.empty'), 'empty-note'));
    return;
  }
  for (const memory of project.memories) {
    const card = element('article', undefined, `memory-card${memory.enabled ? '' : ' disabled'}`);
    card.append(element('p', memory.text));
    card.append(element('p', memory.tags ? t('memory.tagged', { tags: memory.tags }) : t('memory.noTags'), 'memory-meta'));
    const controls = element('div', undefined, 'action-row');
    for (const key of ['pinned', 'enabled']) {
      const label = t(`memory.${key}`);
      const wrapper = element('label', undefined, 'check-label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = memory[key];
      checkbox.setAttribute('aria-label', t(`memory.${key}Label`, { text: memory.text.slice(0, 80) }));
      checkbox.addEventListener('change', () => {
        memory[key] = checkbox.checked;
        invalidatePreview();
        scheduleSave();
        renderMemories();
      });
      wrapper.append(checkbox, document.createTextNode(label));
      controls.append(wrapper);
    }
    const edit = element('button', t('memory.editButton'));
    edit.type = 'button';
    edit.addEventListener('click', () => {
      editingMemoryId = memory.id;
      $('memory-text').value = memory.text;
      $('memory-tags').value = memory.tags;
      $('memory-pinned').checked = memory.pinned;
      $('memory-enabled').checked = memory.enabled;
      message('memory-form-title', 'memory.edit');
      message('memory-submit', 'memory.update');
      $('memory-cancel').hidden = false;
      $('memory-text').focus();
    });
    const remove = element('button', t('memory.delete'), 'delete-button');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      if (!confirm(t('memory.deleteConfirm'))) return;
      project.memories = project.memories.filter((item) => item.id !== memory.id);
      if (editingMemoryId === memory.id) resetMemoryForm();
      invalidatePreview();
      scheduleSave();
      renderMemories();
    });
    controls.append(edit, remove);
    card.append(controls);
    list.append(card);
  }
}
function showProfileDialog(project = null) {
  editingProjectId = project?.id || null;
  $('profile-form').reset();
  syncLanguageSelectors();
  $('project-style').value = 'concise';
  $('profile-error').hidden = true;
  message('dialog-title', project ? 'dialog.editTitle' : 'dialog.createTitle');
  message('profile-submit', project ? 'dialog.save' : 'dialog.create');
  $('project-answer-language').value = project?.answerLanguage || 'auto';
  if (project) {
    $('project-name').value = project.name;
    $('project-goal').value = project.goal;
    const match = /^In scope:\n([\s\S]*?)\n\nOut of scope:\n([\s\S]*)$/.exec(project.scope);
    $('project-in-scope').value = match ? match[1] : project.scope;
    $('project-out-scope').value = match ? match[2] : '';
    $('project-constraints').value = project.constraints;
    $('project-style').value = project.style;
    $('project-clarification').value = project.clarification;
  }
  $('profile-dialog').showModal();
  $('project-name').focus();
}
function taskPayload() {
  refreshValidation();
  if (!$('compile-form').reportValidity()) return null;
  const task = $('task').value.trim();
  if (!task) throw problem('error.taskBlank');
  if (task.length > limits.task) throw problem('error.taskLong', () => ({ limit: count(limits.task) }));
  const memoryBudget = Number($('memory-budget').value);
  const maxOutputTokens = Number($('output-cap').value);
  if (!Number.isInteger(memoryBudget) || memoryBudget < 0 || memoryBudget > 8000) throw problem('error.memoryBudget', () => ({ min: count(0), max: count(8000) }));
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 128 || maxOutputTokens > 8192) throw problem('error.outputCap', () => ({ min: count(128), max: count(8192) }));
  return { projectId: state.activeProjectId, task, memoryBudget, maxOutputTokens, reasoning: $('reasoning').value };
}
function renderPreview(fresh = true) {
  $('preview').hidden = false;
  if (fresh) message('preview-state', 'preview.fresh');
  $('prompt-preview').value = preview.prompt;
  $('compiled-tokens').textContent = count(preview.inputTokens);
  $('baseline-tokens').textContent = count(preview.baselineTokens);
  $('saved-tokens').textContent = count(preview.savedTokens);
  const memories = activeProject().memories;
  for (const [target, ids] of [['selected-memories', preview.selectedMemoryIds], ['omitted-memories', preview.omittedMemoryIds]]) {
    const list = $(target);
    list.replaceChildren();
    if (!ids.length) list.append(element('li', t('preview.none')));
    for (const memoryId of ids) {
      const memory = memories.find((item) => item.id === memoryId);
      list.append(element('li', memory ? `${memory.text.slice(0, 140)}${memory.text.length > 140 ? '…' : ''}${memory.tags ? ` [${memory.tags}]` : ''}` : memoryId));
    }
  }
  $('estimate').hidden = false;
  $('estimate-input').textContent = money(preview.estimate.inputUSD);
  $('estimate-output').textContent = money(preview.estimate.outputUSD);
  $('estimate-total').textContent = money(preview.estimate.totalUSD);
  const pricing = preview.pricing;
  const rates = t('api.rates', { model: pricing.model, million: count(1000000), input: money(pricing.input), cached: money(pricing.cachedInput), output: money(pricing.output), date: dateText(pricing.checkedAt) });
  delete $('pricing-info').dataset.i18n;
  bindings.delete('pricing-info');
  $('pricing-info').replaceChildren(document.createTextNode(`${rates} `));
  try {
    const url = new URL(pricing.source);
    if (url.protocol === 'https:' && ['developers.openai.com', 'platform.openai.com', 'openai.com'].includes(url.hostname)) {
      const link = element('a', t('api.source'));
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      $('pricing-info').append(link);
    }
  } catch { /* A malformed source must never become an executable URL. */ }
  if (fresh) {
    message('compile-status', 'compile.fresh');
    message('export-status', null);
  }
  refreshActions();
}
async function compile() {
  if (running || compiling) return;
  clearError();
  const payload = taskPayload();
  if (!payload) return;
  $('api-consent').checked = false;
  previewRevision = -1;
  if (preview) message('preview-state', 'preview.compiling');
  const startRevision = revision;
  const sequence = ++compileSequence;
  compiling = true;
  message('compile-status', 'compile.compiling');
  refreshActions();
  try {
    await flushSaves();
    if (revision !== startRevision) throw problem('error.changedSaving');
    const result = await api('/api/compile', { method: 'POST', body: JSON.stringify(payload) });
    if (sequence !== compileSequence || revision !== startRevision) throw problem('error.changedCompile');
    preview = result;
    previewRevision = revision;
    renderPreview();
  } catch (error) {
    message('compile-status', 'compile.failed');
    throw error;
  } finally {
    compiling = false;
    refreshActions();
  }
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = element('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeFilename(name) { return name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 70) || 'context-loom'; }
async function refreshUsage() {
  const latest = await api('/api/state');
  state.usage = latest.usage || [];
  renderUsage();
}
function renderUsage() {
  const container = $('usage-list');
  container.replaceChildren();
  if (!state.usage.length) {
    container.append(element('p', t('usage.empty'), 'empty-note'));
    return;
  }
  const wrapper = element('div', undefined, 'usage-table-wrap');
  const table = element('table', undefined, 'usage-table');
  const caption = element('caption', t('usage.caption'), 'sr-only');
  table.append(caption);
  const head = element('thead');
  const header = element('tr');
  for (const key of ['date', 'status', 'input', 'output', 'cost']) {
    const th = element('th', t(`usage.${key}`));
    th.scope = 'col';
    header.append(th);
  }
  head.append(header);
  table.append(head);
  const body = element('tbody');
  for (const record of [...state.usage].sort((a, b) => String(b.date).localeCompare(String(a.date)))) {
    const row = element('tr');
    const project = state.projects.find((p) => p.id === record.projectId);
    const first = element('td', dateText(record.date));
    first.append(element('div', project?.name || t('usage.missingProject')));
    const second = element('td', statusText(record.status));
    second.append(element('div', record.model));
    row.append(first, second, element('td', `${count(record.inputTokens)} / ${count(record.cachedInputTokens)}`), element('td', `${count(record.outputTokens)} / ${count(record.reasoningTokens)}`), element('td', money(record.costUSD), 'numeric'));
    body.append(row);
  }
  table.append(body);
  wrapper.append(table);
  container.append(wrapper);
}
function renderAnswer() {
  const result = lastAnswer;
  if (!result) return;
  $('answer-section').hidden = false;
  $('answer-text').textContent = result.text || t('answer.empty');
  $('answer-status').textContent = statusText(result.status);
  const usage = result.usage;
  $('answer-usage').textContent = t(result.recorded ? 'answer.usageRecorded' : 'answer.usageUnrecorded', {
    input: count(usage.inputTokens), cached: count(usage.cachedInputTokens), output: count(usage.outputTokens),
    reasoning: count(usage.reasoningTokens), cost: money(usage.costUSD),
  });
}
async function runRequest() {
  if (running) return;
  clearError();
  if (!freshPreview() || !$('api-consent').checked) throw problem('error.approval');
  const payload = taskPayload();
  if (!payload) return;
  const apiKey = $('api-key').value.trim();
  if (!apiKey) throw problem('error.key');
  const approvedEstimateUSD = preview.estimate.totalUSD;
  const startRevision = revision;
  const requestProjectId = state.activeProjectId;
  running = true;
  $('api-consent').checked = false;
  message('run-status', 'api.sending');
  refreshActions();
  let sent = false;
  try {
    await flushSaves();
    if (revision !== startRevision || !freshPreview()) throw problem('error.changedSending');
    sent = true;
    const result = await api('/api/run', { method: 'POST', body: JSON.stringify({ ...payload, apiKey, approvedEstimateUSD, consent: true }) });
    answerProjectId = requestProjectId;
    lastAnswer = result;
    renderAnswer();
    message('run-status', 'api.finished', () => ({ status: statusText(result.status) }));
    try { await refreshUsage(); } catch (error) { showError(problem('error.usageRefresh', {}, error)); }
    $('answer-section').scrollIntoView({ behavior: 'instant', block: 'nearest' });
  } catch (error) {
    message('run-status', sent ? 'api.failed' : 'api.notSent');
    if (sent) {
      try { await refreshUsage(); } catch { /* Keep the original paid-request failure visible. */ }
    }
    throw error;
  } finally {
    running = false;
    refreshActions();
  }
}
function validateBackup(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem('error.backupObject');
  if (value.version !== undefined && value.version !== 1) throw problem('error.backupVersion');
  if (!Array.isArray(value.projects) || !value.projects.length || value.projects.length > limits.projects) throw problem('error.backupProjects', () => ({ limit: count(limits.projects) }));
  const identifier = (text) => typeof text === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(text);
  const string = (text, max, label, required = false) => {
    if (typeof text !== 'string' || text.length > max || (required && !text.trim())) throw problem(required ? 'error.backupStringRequired' : 'error.backupString', () => ({ label: label(), limit: count(max) }));
    return text;
  };
  const projectIds = new Set();
  return value.projects.map((project, index) => {
    const label = () => t('backup.projectLabel', { index: count(index + 1) });
    if (!project || typeof project !== 'object' || !identifier(project.id) || projectIds.has(project.id)) throw problem('error.backupId', () => ({ label: label() }));
    projectIds.add(project.id);
    if (!['concise', 'balanced', 'detailed'].includes(project.style) || !['blocking', 'always'].includes(project.clarification) || !answerLanguages.includes(project.answerLanguage ?? 'auto')) throw problem('error.backupPreferences', () => ({ label: label() }));
    if (!Array.isArray(project.memories) || project.memories.length > limits.memories) throw problem('error.backupMemories', () => ({ label: label(), limit: count(limits.memories) }));
    const memoryIds = new Set();
    const memories = project.memories.map((memory, memoryIndex) => {
      const numbers = () => ({ project: count(index + 1), memory: count(memoryIndex + 1) });
      const memoryLabel = () => t('backup.memoryLabel', numbers());
      if (!memory || typeof memory !== 'object' || !identifier(memory.id) || memoryIds.has(memory.id)) throw problem('error.backupId', () => ({ label: memoryLabel() }));
      memoryIds.add(memory.id);
      if (typeof memory.pinned !== 'boolean' || typeof memory.enabled !== 'boolean') throw problem('error.backupBoolean', () => ({ label: memoryLabel() }));
      return {
        id: id(), text: string(memory.text, limits.field, () => t('backup.textLabel', numbers()), true),
        tags: string(memory.tags, limits.tags, () => t('backup.tagsLabel', numbers())), pinned: memory.pinned, enabled: memory.enabled,
      };
    });
    const fieldLabel = (field) => () => t(`backup.${field}Label`, { index: count(index + 1) });
    return {
      id: id(), name: string(project.name, limits.name, fieldLabel('name'), true),
      goal: string(project.goal, limits.field, fieldLabel('goal'), true),
      scope: string(project.scope, limits.field, fieldLabel('scope')),
      constraints: string(project.constraints, limits.field, fieldLabel('constraints')),
      style: project.style, clarification: project.clarification, answerLanguage: project.answerLanguage ?? 'auto', memories,
    };
  });
}
async function importBackup(file) {
  if (!file) return;
  clearError();
  if (file.size > 32 * 1024 * 1024) throw problem('error.backupSize');
  let value;
  try { value = JSON.parse(await file.text()); } catch { throw problem('error.backupJson'); }
  const projects = validateBackup(value);
  if (state.projects.length + projects.length > limits.projects) throw problem('error.importLimit', () => ({ limit: count(limits.projects) }));
  const next = [...state.projects, ...projects];
  if (new Blob([JSON.stringify({ projects: next, activeProjectId: state.activeProjectId, uiLanguage: state.uiLanguage })]).size > 24 * 1024 * 1024) throw problem('error.stateSize');
  if (!confirm(t('backup.importConfirm', { count: count(projects.length) }))) return;
  state.projects = next;
  if (!state.activeProjectId) state.activeProjectId = projects[0].id;
  invalidatePreview();
  scheduleSave();
  renderWorkspace();
  message('save-status', 'save.imported');
}
async function load() {
  $('ui-language').disabled = true;
  $('dialog-ui-language').disabled = true;
  try {
    const result = await api('/api/state');
    if (!Array.isArray(result.projects) || !Array.isArray(result.usage)) throw problem('error.stateFormat');
    state = { ...result, uiLanguage: result.uiLanguage || 'en' };
    if (state.projects.length && !activeProject()) throw problem('error.activeProject');
    const request = localeRequest;
    try {
      if (await setLocale(state.uiLanguage) && request === localeRequest) refreshLanguage();
    } catch (error) {
      showError(problem('language.failure', {}, error));
      state.uiLanguage = locale();
    }
    loaded = true;
    if (!(visibleError instanceof UiError && visibleError.key === 'language.failure')) clearError();
    $('export-backup').disabled = false;
    $('import-backup').disabled = false;
    message('save-status', 'save.loaded');
    refreshLanguage();
    if (!state.projects.length) showProfileDialog();
  } catch (error) {
    loaded = false;
    message('save-status', 'save.loadFailed');
    showError(problem('error.load', {}, error));
  } finally {
    $('ui-language').disabled = false;
    $('dialog-ui-language').disabled = false;
  }
}

$('task').maxLength = limits.task;
$('project-in-scope').maxLength = limits.field;
$('project-out-scope').maxLength = limits.field;
$('new-project').addEventListener('click', () => showProfileDialog());
$('welcome-create').addEventListener('click', () => showProfileDialog());
$('edit-profile').addEventListener('click', () => showProfileDialog(activeProject()));
$('close-dialog').addEventListener('click', () => $('profile-dialog').close());
$('profile-form').addEventListener('input', (event) => {
  if (event.target.id !== 'dialog-ui-language') invalidatePreview('compile.profileDraft');
});
$('profile-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const scopeIn = $('project-in-scope').value.trim();
  const scopeOut = $('project-out-scope').value.trim();
  const scope = scopeOut ? `In scope:\n${scopeIn}\n\nOut of scope:\n${scopeOut}` : scopeIn;
  const goal = $('project-goal').value.trim();
  const name = $('project-name').value.trim();
  if (!goal || !name || scope.length > limits.field) {
    message('profile-error', !name || !goal ? 'error.profileBlank' : 'error.scopeLong', () => ({ limit: count(limits.field) }));
    $('profile-error').hidden = false;
    return;
  }
  const existing = state.projects.find((project) => project.id === editingProjectId);
  if (!existing && state.projects.length >= limits.projects) { showError(problem('error.projectLimit', () => ({ limit: count(limits.projects) }))); return; }
  const project = { id: existing?.id || id(), name, goal, scope, constraints: $('project-constraints').value.trim(), style: $('project-style').value, clarification: $('project-clarification').value, answerLanguage: $('project-answer-language').value, memories: existing?.memories || [] };
  if (existing) state.projects[state.projects.indexOf(existing)] = project;
  else {
    if (state.activeProjectId) drafts.set(state.activeProjectId, $('task').value);
    state.projects.push(project);
    state.activeProjectId = project.id;
    $('task').value = '';
    resetMemoryForm();
    clearProjectResults();
  }
  invalidatePreview();
  scheduleSave();
  renderWorkspace();
  $('profile-dialog').close();
  $('task').focus();
});
$('project-select').addEventListener('change', () => {
  drafts.set(state.activeProjectId, $('task').value);
  state.activeProjectId = $('project-select').value;
  $('task').value = drafts.get(state.activeProjectId) || '';
  resetMemoryForm();
  invalidatePreview();
  clearProjectResults();
  scheduleSave();
  renderWorkspace();
});
$('memory-form').addEventListener('input', () => invalidatePreview('compile.memoryDraft'));
$('memory-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const project = activeProject();
  const text = $('memory-text').value.trim();
  if (!text) { showError(problem('error.memoryBlank')); return; }
  const existing = project.memories.find((memory) => memory.id === editingMemoryId);
  if (!existing && project.memories.length >= limits.memories) { showError(problem('error.memoryLimit', () => ({ limit: count(limits.memories) }))); return; }
  const memory = { id: existing?.id || id(), text, tags: $('memory-tags').value.trim(), pinned: $('memory-pinned').checked, enabled: $('memory-enabled').checked };
  if (existing) project.memories[project.memories.indexOf(existing)] = memory;
  else project.memories.push(memory);
  resetMemoryForm();
  invalidatePreview();
  scheduleSave();
  renderMemories();
  $('memory-text').focus();
});
$('memory-cancel').addEventListener('click', resetMemoryForm);
$('compile-form').addEventListener('input', () => invalidatePreview());
$('compile-form').addEventListener('submit', handle((event) => { event.preventDefault(); return compile(); }));
$('api-consent').addEventListener('change', refreshActions);
$('api-key').addEventListener('input', () => { $('api-consent').checked = false; refreshActions(); });
$('clear-key').addEventListener('click', () => { $('api-key').value = ''; $('api-consent').checked = false; refreshActions(); $('api-key').focus(); });
$('copy-prompt').addEventListener('click', handle(async () => {
  if (!freshPreview()) throw problem('error.copyFresh');
  try { await navigator.clipboard.writeText(preview.prompt); message('export-status', 'export.copied'); }
  catch { $('prompt-preview').focus(); $('prompt-preview').select(); throw problem('error.clipboard'); }
}));
$('download-prompt').addEventListener('click', handle(() => {
  if (!freshPreview()) throw problem('error.downloadFresh');
  download(`${safeFilename(activeProject().name)}-context.txt`, preview.prompt, 'text/plain;charset=utf-8');
  message('export-status', 'export.downloaded');
}));
$('run-button').addEventListener('click', handle(runRequest));
$('save-answer').addEventListener('click', handle(() => {
  if (!answerProjectId || state.activeProjectId !== answerProjectId) throw problem('error.answerProject');
  resetMemoryForm();
  const text = lastAnswer?.text || '';
  $('memory-text').value = text.slice(0, limits.field);
  invalidatePreview('compile.responseDraft');
  message('memory-form-title', text.length > limits.field ? 'memory.excerpt' : 'memory.review', () => ({ limit: count(limits.field) }));
  $('memory-text').focus();
  $('memory-form').scrollIntoView({ behavior: 'instant', block: 'center' });
}));
$('export-backup').addEventListener('click', () => {
  if (!loaded) return;
  if (!confirm(t('backup.exportConfirm'))) return;
  download(`context-loom-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 1, projects: state.projects, activeProjectId: state.activeProjectId }, null, 2), 'application/json');
});
$('import-backup').addEventListener('change', handle(async () => {
  const file = $('import-backup').files[0];
  $('import-backup').value = '';
  await importBackup(file);
}));
$('refresh-history').addEventListener('click', handle(async () => {
  $('refresh-history').disabled = true;
  try { await refreshUsage(); } finally { $('refresh-history').disabled = false; }
}));
window.addEventListener('beforeunload', (event) => {
  if (pendingSaves || saveError || running) { event.preventDefault(); event.returnValue = ''; }
});
for (const target of ['ui-language', 'dialog-ui-language']) {
  for (const [code, name] of Object.entries(languages)) $(target).append(new Option(name, code));
  $(target).addEventListener('change', (event) => { changeLanguage(event.target.value); });
}
$('project-answer-language').append(new Option('', 'auto'));
for (const [code, name] of Object.entries(languages)) $('project-answer-language').append(new Option(name, code));
document.addEventListener('input', refreshValidation, true);
document.addEventListener('invalid', refreshValidation, true);
try {
  await setLocale('en');
  refreshLanguage();
  await load();
} catch (error) {
  // The catalog is required: do not silently render a partial English interface.
  document.documentElement.lang = 'en';
  $('global-error').textContent = 'The selected language could not be loaded. The current interface language has been kept.\nTechnical details: ' + error.message;
  $('global-error').hidden = false;
}
