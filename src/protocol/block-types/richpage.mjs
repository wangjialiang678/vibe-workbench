import tableType from './table.mjs';
import diagramType from './diagram.mjs';

const KINDS = new Set(['md', 'table', 'pills', 'kpi', 'callout', 'lane', 'steps', 'bars', 'diagram']);
const TONES = new Set(['ok', 'doing', 'wait', 'neutral']);
const SECTION_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const MAX_BLOCK_BYTES = 256 * 1024;

function addTextError(errors, value, label, { optional = false } = {}) {
  if (optional && value == null) return;
  if (typeof value !== 'string') errors.push(`${label} must be string`);
}

function validateStringArray(errors, values, label) {
  if (!Array.isArray(values)) {
    errors.push(`${label} must be array`);
    return;
  }
  if (values.some((value) => typeof value !== 'string')) errors.push(`${label} must contain strings`);
}

function validateItem(item, label) {
  const errors = [];
  if (!item || typeof item !== 'object' || Array.isArray(item)) return [`${label} must be object`];
  if (!KINDS.has(item.kind)) return [`${label} unknown kind: ${item.kind}`];

  if (item.kind === 'md') addTextError(errors, item.body, `${label} md body`);

  if (item.kind === 'table') {
    errors.push(...tableType.validate(item).map((error) => `${label} ${error}`));
    if (Array.isArray(item.columns) && item.columns.some((cell) => typeof cell !== 'string')) {
      errors.push(`${label} table columns must be strings`);
    }
    if (Array.isArray(item.rows)) {
      if (item.rows.some((row) => !Array.isArray(row))) errors.push(`${label} table rows must be arrays`);
      if (item.rows.some((row) => Array.isArray(row) && row.some((cell) => typeof cell !== 'string'))) {
        errors.push(`${label} table rows cells must be strings`);
      }
    }
  }

  if (item.kind === 'pills' || item.kind === 'kpi') {
    if (!Array.isArray(item.items)) errors.push(`${label} ${item.kind} items must be array`);
    else item.items.forEach((entry, index) => {
      const entryLabel = `${label} ${item.kind}.items[${index}]`;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push(`${entryLabel} must be object`);
        return;
      }
      addTextError(errors, entry.label, `${entryLabel} label`);
      if (item.kind === 'pills') {
        if (entry.tone != null && (!TONES.has(entry.tone))) errors.push(`${entryLabel} tone invalid`);
      } else {
        addTextError(errors, entry.value, `${entryLabel} value`);
      }
    });
  }

  if (item.kind === 'callout') {
    if (item.tone != null && !TONES.has(item.tone)) errors.push(`${label} callout tone invalid`);
    addTextError(errors, item.title, `${label} callout title`);
    addTextError(errors, item.body, `${label} callout body`);
  }

  if (item.kind === 'lane') {
    addTextError(errors, item.title, `${label} lane title`);
    addTextError(errors, item.body, `${label} lane body`);
  }

  if (item.kind === 'steps') validateStringArray(errors, item.items, `${label} steps items`);

  if (item.kind === 'bars') {
    addTextError(errors, item.unit, `${label} bars unit`, { optional: true });
    if (!Array.isArray(item.series) || item.series.length < 1 || item.series.length > 20) {
      errors.push(`${label} bars series must contain 1-20 items`);
    } else {
      item.series.forEach((entry, index) => {
        const entryLabel = `${label} bars.series[${index}]`;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          errors.push(`${entryLabel} must be object`);
          return;
        }
        addTextError(errors, entry.label, `${entryLabel} label`);
        if (typeof entry.value !== 'number' || !Number.isFinite(entry.value)) {
          errors.push(`${entryLabel} bars value must be finite number`);
        }
      });
    }
    if (item.max != null && (typeof item.max !== 'number' || !Number.isFinite(item.max) || item.max <= 0)) {
      errors.push(`${label} bars max must be a positive finite number`);
    }
  }

  if (item.kind === 'diagram') {
    errors.push(...diagramType.validate(item).map((error) => `${label} ${error}`));
    addTextError(errors, item.lang, `${label} diagram lang`);
    addTextError(errors, item.body, `${label} diagram body`);
  }
  return errors;
}

function serializedByteLength(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function validate(block) {
  const errors = [];
  if (serializedByteLength(block) > MAX_BLOCK_BYTES) errors.push('richpage serialized size must not exceed 256 KiB');
  addTextError(errors, block.title, 'richpage title', { optional: true });
  addTextError(errors, block.summary, 'richpage summary', { optional: true });
  if (block.toc != null && typeof block.toc !== 'boolean') errors.push('richpage toc must be boolean');

  if (!Array.isArray(block.sections) || block.sections.length < 1 || block.sections.length > 40) {
    errors.push('richpage sections must contain 1-40 sections');
  } else {
    const ids = new Set();
    block.sections.forEach((section, sectionIndex) => {
      const label = `richpage sections[${sectionIndex}]`;
      if (!section || typeof section !== 'object' || Array.isArray(section)) {
        errors.push(`${label} must be object`);
        return;
      }
      if (typeof section.id !== 'string' || !SECTION_ID.test(section.id)) errors.push(`${label} section.id invalid`);
      else if (ids.has(section.id)) errors.push(`richpage duplicate section id: ${section.id}`);
      else ids.add(section.id);
      addTextError(errors, section.heading, `${label} heading`);
      if (typeof section.heading === 'string' && !section.heading.trim()) errors.push(`${label} heading required`);
      addTextError(errors, section.kicker, `${label} kicker`, { optional: true });
      if (!Array.isArray(section.items)) errors.push(`${label} items must be array`);
      else {
        if (section.items.length > 60) errors.push(`${label} items must contain at most 60 items`);
        section.items.forEach((item, itemIndex) => errors.push(...validateItem(item, `${label}.items[${itemIndex}]`)));
      }
    });
  }

  if (block.sources != null) {
    if (!Array.isArray(block.sources)) errors.push('richpage sources must be array');
    else block.sources.forEach((source, index) => {
      const label = `richpage sources[${index}]`;
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        errors.push(`${label} must be object`);
        return;
      }
      if (typeof source.n !== 'number' || !Number.isFinite(source.n)) errors.push(`${label} n must be finite number`);
      addTextError(errors, source.text, `${label} source text`);
      addTextError(errors, source.url, `${label} source url`);
      if (typeof source.url === 'string' && !/^https?:\/\//i.test(source.url)) {
        errors.push(`${label} source url must use http or https`);
      }
    });
  }
  return errors;
}

function tone(value) {
  return TONES.has(value) ? value : 'neutral';
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function sectionChange(section, previousSections) {
  if (!Array.isArray(previousSections)) return null;
  const previous = previousSections.find((candidate) => candidate?.id === section.id);
  if (!previous) return 'new';
  return stableStringify(previous) === stableStringify(section) ? 'unchanged' : 'changed';
}

function renderTable(item, escHtml) {
  const head = item.columns.length
    ? `<thead><tr>${item.columns.map((column) => `<th>${escHtml(column)}</th>`).join('')}</tr></thead>`
    : '';
  const body = item.rows.length
    ? `<tbody>${item.rows.map((row) => `<tr>${row.map((cell) => `<td>${escHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`
    : '';
  return `<div class="rp-tablewrap"><table class="rp-table block-table">${head}${body}</table></div>`;
}

function renderBars(item, escHtml) {
  const values = item.series.map((entry) => entry.value);
  const max = item.max ?? Math.max(1, ...values);
  const unit = item.unit ?? '';
  const rows = item.series.map((entry) => {
    const percentage = Math.max(0, Math.min(100, (entry.value / max) * 100));
    const width = Number(percentage.toFixed(2));
    const label = escHtml(entry.label);
    const value = escHtml(entry.value);
    const unitHtml = escHtml(unit);
    return `<div class="rp-bar"><div class="rp-bar-meta"><span class="rp-bar-label">${label}</span><span class="rp-bar-value">${value}${unitHtml}</span></div><svg class="rp-bar-chart" viewBox="0 0 100 4" preserveAspectRatio="none" role="img" aria-label="${label} ${value}${unitHtml}"><rect class="rp-bar-track" width="100%" height="100%"></rect><rect class="rp-bar-fill" width="${width}%" height="100%"></rect></svg></div>`;
  }).join('');
  return `<div class="rp-bars">${rows}</div>`;
}

function renderItem(item, { escHtml, mdToHtml }) {
  if (item.kind === 'md') return `<div class="rp-item rp-md">${mdToHtml(item.body)}</div>`;
  if (item.kind === 'table') return `<div class="rp-item">${renderTable(item, escHtml)}</div>`;
  if (item.kind === 'pills') {
    return `<div class="rp-item rp-pills">${item.items.map((entry) => `<span class="rp-pill rp-tone-${tone(entry.tone)}">${escHtml(entry.label)}</span>`).join('')}</div>`;
  }
  if (item.kind === 'kpi') {
    return `<div class="rp-item rp-kpis">${item.items.map((entry) => `<div class="rp-kpi"><strong>${escHtml(entry.value)}</strong><span>${escHtml(entry.label)}</span></div>`).join('')}</div>`;
  }
  if (item.kind === 'callout') {
    return `<aside class="rp-item rp-callout rp-tone-${tone(item.tone)}"><strong class="rp-callout-title">${escHtml(item.title)}</strong><div class="rp-callout-body">${mdToHtml(item.body)}</div></aside>`;
  }
  if (item.kind === 'lane') {
    return `<section class="rp-item rp-lane"><h4>${escHtml(item.title)}</h4><div>${mdToHtml(item.body)}</div></section>`;
  }
  if (item.kind === 'steps') {
    return `<ol class="rp-item rp-steps">${item.items.map((step) => `<li>${mdToHtml(step)}</li>`).join('')}</ol>`;
  }
  if (item.kind === 'bars') return `<div class="rp-item">${renderBars(item, escHtml)}</div>`;
  if (item.kind === 'diagram') return `<div class="rp-item rp-diagram"><pre class="mermaid">${escHtml(item.body)}</pre></div>`;
  return '';
}

function renderSources(sources, escHtml) {
  if (!Array.isArray(sources) || sources.length === 0) return '';
  return `<footer class="rp-sources"><h3>来源</h3><ol>${sources.map((source) => {
    const safeUrl = /^https?:\/\//i.test(source.url) ? source.url : '#';
    return `<li value="${escHtml(source.n)}"><span>${escHtml(source.text)}</span> <a href="${escHtml(safeUrl)}" rel="noopener" target="_blank">${escHtml(source.url)}</a></li>`;
  }).join('')}</ol></footer>`;
}

function render(block, context) {
  const { escHtml, mdToHtml } = context;
  const blockId = escHtml(block.id ?? '');
  const showToc = block.toc === true || (block.toc !== false && block.sections.length >= 4);
  const summary = block.summary ? `<div class="rp-summary">${mdToHtml(block.summary)}</div>` : '';
  const toc = showToc
    ? `<nav class="rp-toc" aria-label="本页目录"><strong>本页目录</strong><ol>${block.sections.map((section) => `<li><a href="#rp-${blockId}-${escHtml(section.id)}">${escHtml(section.heading)}</a></li>`).join('')}</ol></nav>`
    : '';
  const sections = block.sections.map((section) => {
    const sectionId = escHtml(section.id);
    const change = sectionChange(section, block._prev?.sections);
    const changeAttr = change ? ` data-section-change="${change}"` : '';
    const kicker = section.kicker ? `<span class="rp-kicker">${escHtml(section.kicker)}</span>` : '';
    const items = section.items.map((item) => renderItem(item, context)).join('');
    return `<section id="rp-${blockId}-${sectionId}" data-section-id="${sectionId}"${changeAttr} class="rp-section${change ? ` rp-section-${change}` : ''}"><header class="rp-section-head"><div>${kicker}<h3>${escHtml(section.heading)}</h3></div><button class="rail-add rp-section-comment" type="button" data-richpage-add="${blockId}" data-section-id="${sectionId}">+ 批注本节</button></header><div class="rp-section-items">${items}</div></section>`;
  }).join('');
  const rail = `<aside class="embed-rail rp-rail" data-embed-rail="${blockId}"><div class="rail-head"><span>批注</span><span class="embed-pin-count" data-embed-count="${blockId}">0 条批注</span></div><div class="rail-list" data-embed-rail-list="${blockId}"><div class="rail-empty">选中文字后点「评论」，或点节标题旁的「批注本节」。</div></div></aside>`;
  return `<article class="richpage" data-richpage="${blockId}">${summary}${toc}<div class="rp-layout"><div class="rp-main">${sections}${renderSources(block.sources, escHtml)}</div>${rail}</div></article>`;
}

function markdownBodies(block) {
  const bodies = [];
  if (typeof block.summary === 'string') bodies.push(block.summary);
  for (const section of block.sections ?? []) {
    for (const item of section?.items ?? []) {
      if (item?.kind === 'md' || item?.kind === 'callout' || item?.kind === 'lane') bodies.push(item.body);
      if (item?.kind === 'steps') bodies.push(...(item.items ?? []));
    }
  }
  return bodies.filter((body) => typeof body === 'string');
}

function lint(block) {
  const warnings = [];
  if (typeof block.summary !== 'string' || !block.summary.trim()) {
    warnings.push({ rule: 'richpage-missing-summary', message: '叙事页建议结论先行' });
  }
  for (const section of block.sections ?? []) {
    const items = Array.isArray(section?.items) ? section.items : [];
    if (items.length === 0) warnings.push({ rule: 'richpage-empty-section', message: `「${section?.heading ?? section?.id ?? '未命名节'}」没有内容` });
    const prose = items.filter((item) => item?.kind === 'md').map((item) => item.body ?? '').join('\n');
    if (prose.length > 1500 && items.every((item) => item?.kind === 'md')) {
      warnings.push({ rule: 'richpage-long-prose', message: `「${section?.heading ?? section?.id ?? '未命名节'}」正文较长，考虑拆节或用表格` });
    }
  }
  if (markdownBodies(block).some((body) => /https?:\/\//i.test(body))) {
    warnings.push({ rule: 'richpage-inline-url', message: '链接请集中到 sources' });
  }
  return warnings;
}

export default {
  type: 'richpage',
  hashFields: ['title', 'summary', 'sections', 'sources'],
  validate,
  render,
  lint,
};
