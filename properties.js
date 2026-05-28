'use strict';

/* ═══════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════ */
// Heuristic Lua indent pass — runs on textarea blur to normalize pasted
// or hand-written callback bodies.  Intentionally simple:
//   • 4-space indentation, keywords drive depth
//   • opens: `function`, `if`, `for`, `while`, `do`, `repeat`, `then`, `else`, `elseif`, trailing `{`, trailing `(`
//   • closes: `end`, `until`, `else`, `elseif`, `}`, `)`
//   • skips inline forms like `if x then y end` (too hard without a parser)
function formatLuaBody(src) {
  if (!src || !src.includes('\n')) return src;
  const INC = /\b(?:function|if|for|while|do|repeat|then|else|elseif)\b.*$|\{\s*$|\(\s*$/;
  const DEC = /^\s*(?:end|until|else|elseif|\}|\))\b/;
  const lines = src.replace(/\t/g, '    ').split('\n').map(l => l.replace(/^\s+/, ''));
  let depth = 0;
  const out = [];
  for (const raw of lines) {
    if (!raw) { out.push(''); continue; }
    const dedent = DEC.test(raw);
    const here = Math.max(0, depth - (dedent ? 1 : 0));
    out.push('    '.repeat(here) + raw);
    if (INC.test(raw) && !/\bend\b\s*(?:$|--)/.test(raw)) depth++;
    else if (dedent) depth = Math.max(0, depth - 1);
  }
  return out.join('\n');
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function typeColor(el) {
  if (UI_TYPES.has(el.type)) return 'var(--pur)';
  if (el.draggable)           return 'var(--org)';
  if (el.parentId)            return 'var(--grn)';
  return 'var(--t3)';
}

/* ═══════════════════════════════════════════
   CALLBACK HELPERS  (shared by Properties + Callbacks tab)
═══════════════════════════════════════════ */
// Derive the Lua variable name for an element (display-only — no dedup needed
// here; codegen handles collision resolution via its own makeVn()).
function cbVarName(el) {
  const base = (el.name || el.type || '').replace(/[^a-zA-Z0-9]/g, ' ').trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join('')
    .replace(/^(\d)/, '_$1');
  return base || (el.type || 'Element');
}

function cbFnSig(el) {
  const fn = `On${cbVarName(el)}${el.callback || ''}`;
  switch (el.type) {
    case 'Checkbox': return `${fn}(state: boolean)`;
    case 'Keybind':  return `${fn}(key: string)`;
    case 'Dropdown': return `${fn}(selected: string, index: number)`;
    case 'Slider':   return `${fn}(value: number)`;
    case 'Button':   return el.toggleMode ? `${fn}(state: boolean)` : `${fn}()`;
    case 'Switch':   return `${fn}(state: boolean)`;
    default:         return fn;
  }
}
function cbBodyHint(el) {
  switch (el.type) {
    case 'Checkbox': return 'state: boolean &mdash; true = checked &bull; use wait(n) for waiting';
    case 'Keybind':  return 'key: string &mdash; e.g. &quot;Insert&quot;, &quot;F1&quot;, &quot;A&quot;';
    case 'Dropdown': return 'selected: string, index: number &mdash; index is 1-based';
    case 'Slider':   return 'value: number &mdash; current slider value';
    case 'Button':   return el.toggleMode ? 'state: boolean &mdash; true when toggled on &bull; use wait(n) for waiting' : '(no parameters)';
    case 'Switch':   return 'state: boolean &mdash; true when switch is on &bull; use wait(n) for waiting';
    default:         return '';
  }
}
function cbBodyExample(el) {
  switch (el.type) {
    case 'Checkbox': return 'if state then\n    warn("enabled")\nelse\n    warn("disabled")\nend';
    case 'Keybind':  return '-- runs once when the key is pressed\nwarn("pressed: " .. key)';
    case 'Dropdown': return 'warn("picked " .. selected .. " at #" .. index)';
    case 'Slider':   return 'warn("value = " .. value)';
    case 'Button':   return el.toggleMode
      ? 'if state then\n    warn("on")\nelse\n    warn("off")\nend'
      : 'warn("clicked")';
    case 'Switch':   return 'if state then\n    warn("switch on")\nelse\n    warn("switch off")\nend';
    default:         return '-- write your Lua code here';
  }
}
// Describes which locals and helpers are in-scope inside the callback body.
// Rendered in the Callbacks tab below the signature.
function cbBodyScope(el) {
  const common = '<code>E.*</code> (widget state)';
  switch (el.type) {
    case 'Checkbox': return `<code>state</code>, <code>wait(n)</code>, ${common}`;
    case 'Keybind':  return `<code>key</code>, ${common}`;
    case 'Dropdown': return `<code>selected</code>, <code>index</code>, ${common}`;
    case 'Slider':   return `<code>value</code>, ${common}`;
    case 'Button':   return el.toggleMode
      ? `<code>state</code>, <code>wait(n)</code>, ${common}`
      : common;
    case 'Switch':   return `<code>state</code>, <code>wait(n)</code>, ${common}`;
    default:         return common;
  }
}
// Is this widget's callback action a user CustomFunction (vs. ToggleUI / DestroyUI / switchTab / toggleTarget)?
// Only CustomFunction widgets have an editable body.
function cbHasBody(el) {
  if (!UI_TYPES.has(el.type)) return false;
  const act = el.action || 'CustomFunction';
  if (el.type === 'Keybind' && (
        act === 'ToggleUI' ||
        act === 'DestroyUI' ||
        act.startsWith('switchTab:') ||
        act.startsWith('toggleTarget:')
      )) return false;
  if (el.type === 'Button'  && (
        act === 'DestroyUI' ||
        act.startsWith('switchTab:')
      )) return false;
  return true;
}

/* ═══════════════════════════════════════════
   LAYERS PANEL
═══════════════════════════════════════════ */
// Module-scoped drag state for the layers panel.  Survives updateLayers()
// re-renders that happen mid-drag (e.g. when a visibility toggle triggers
// re-render and the original row's ondragend handler vanishes with it).
let _dragLayerId = null;

// Register a single document-level dragend listener once, so cleanup is
// detached from any individual row's lifecycle.
if (!window._layDragBound) {
  window._layDragBound = true;
  document.addEventListener('dragend', () => {
    _dragLayerId = null;
    document.querySelectorAll('.lay').forEach(r => {
      r.classList.remove('dragging');
      r.removeAttribute('data-drop');
    });
    document.querySelectorAll('.lay-end').forEach(z => z.classList.remove('over'));
  });
}

function updateLayers() {
  const wrap  = document.getElementById('layers');
  wrap.innerHTML = '';

  const pool   = S.els.filter(e => e.shared || !e.tabId || e.tabId === S.activeTab);
  const sorted = [...pool].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
  const roots  = sorted.filter(e => !e.parentId);
  const kids   = sorted.filter(e =>  e.parentId);

  function row(item, depth) {
    const d = document.createElement('div');
    d.className = 'lay'
      + (S.sel.has(item.id) ? ' sel' : '')
      + (item.visible       ? ''     : ' hid')
      + (item.locked        ? ' locked' : '');

    const indent = depth
      ? `<span class="lind" style="min-width:${depth * 12}px"></span>`
        + `<span style="width:8px;height:1px;background:var(--b2);flex-shrink:0;display:inline-block;margin-right:2px"></span>`
      : `<span class="lind" style="min-width:0"></span>`;

    d.innerHTML = indent
      + `<span class="lgrip" title="Drag to reorder or reparent">&#x22EE;&#x22EE;</span>`
      + `<span class="li" onclick="togV('${item.id}',event)">${item.visible ? '&#x1F441;' : '&middot;'}</span>`
      + `<span class="li" onclick="togL('${item.id}',event)">${item.locked  ? '&#x1F512;' : '&middot;'}</span>`
      + `<span class="ln" style="color:${UI_TYPES.has(item.type) ? 'var(--pur)' : 'inherit'}">${esc(item.name)}</span>`
      + `<span class="lt" style="color:${typeColor(item)}">${item.type.slice(0, 3)}</span>`
      + `<span class="lz">${item.zIndex || 0}</span>`;

    d.draggable   = true;
    d.dataset.id  = item.id;

    d.ondragstart = ev => {
      ev.dataTransfer.setData('text/plain', item.id);
      ev.dataTransfer.effectAllowed = 'move';
      _dragLayerId = item.id;
      d.classList.add('dragging');
    };
    // Cleanup is handled by the document-level dragend listener above, which
    // survives any updateLayers() re-renders that detach this row's handlers.
    d.ondragover = ev => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      const r = d.getBoundingClientRect();
      const pct = (ev.clientY - r.top) / r.height;
      d.dataset.drop = pct < 0.25 ? 'above' : pct > 0.75 ? 'below' : 'inside';
    };
    d.ondragleave = ev => {
      // Only clear if we've really left this row (not entered a child span)
      const r = d.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right ||
          ev.clientY < r.top  || ev.clientY > r.bottom) {
        delete d.dataset.drop;
      }
    };
    d.ondrop = ev => {
      ev.preventDefault();
      const srcId = ev.dataTransfer.getData('text/plain');
      const mode  = d.dataset.drop;
      delete d.dataset.drop;
      if (srcId && srcId !== item.id && mode) onLayerDrop(srcId, item.id, mode);
    };

    d.onclick = ev => {
      if (ev.target.classList.contains('li')) return;
      if (ev.target.classList.contains('lgrip')) return;
      if (ev.ctrlKey) {
        S.sel.has(item.id) ? S.sel.delete(item.id) : S.sel.add(item.id);
      } else {
        S.sel.clear();
        S.sel.add(item.id);
      }
      _lastHit = item.id;
      updateLayers();
      updateProps();
      render();
    };

    wrap.appendChild(d);

    for (const ch of kids.filter(c => c.parentId === item.id)) row(ch, depth + 1);
  }

  for (const r of roots) row(r, 0);
  // Orphaned children (parent was deleted or on another tab)
  for (const ch of kids) {
    if (!pool.find(e => e.id === ch.parentId)) row(ch, 0);
  }

  // Drop zone at the bottom of the layers panel → unparent / move to root
  const endZone = document.createElement('div');
  endZone.className = 'lay-end';
  endZone.ondragover = ev => { ev.preventDefault(); endZone.classList.add('over'); };
  endZone.ondragleave = () => endZone.classList.remove('over');
  endZone.ondrop = ev => {
    ev.preventDefault();
    endZone.classList.remove('over');
    const srcId = ev.dataTransfer.getData('text/plain');
    if (srcId) onLayerDrop(srcId, null, 'root');
  };
  wrap.appendChild(endZone);

  // If a drag is in flight and the panel was just re-rendered, re-apply the
  // visual indicator to the new row for the dragged element.
  if (_dragLayerId) {
    const row = wrap.querySelector(`.lay[data-id="${_dragLayerId}"]`);
    if (row) row.classList.add('dragging');
  }
}

/* ═══════════════════════════════════════════
   LAYER DRAG-DROP HANDLER
   mode = 'above' | 'below' | 'inside' | 'root'
═══════════════════════════════════════════ */
function onLayerDrop(srcId, dstId, mode) {
  const src = S.els.find(e => e.id === srcId);
  if (!src) return;
  if (srcId === dstId) return;

  // Cycle guard: reject parenting to own descendant
  if (mode === 'inside' && dstId) {
    let cur = dstId;
    while (cur) {
      if (cur === srcId) { toast && toast('Cannot parent into own descendant'); return; }
      const p = S.els.find(e => e.id === cur);
      cur = p ? p.parentId : null;
    }
  }

  pushH();

  if (mode === 'root') {
    src.parentId = null;
  } else if (mode === 'inside') {
    src.parentId = dstId;
  } else if (mode === 'above' || mode === 'below') {
    const dst = S.els.find(e => e.id === dstId);
    if (!dst) return;
    // Move src next to dst in the same parent group
    src.parentId = dst.parentId || null;
    // zIndex adjustment: 'above' in UI = higher zIndex (on top), 'below' = lower
    // Layers panel sorts desc (highest first at top), so 'above' = higher z.
    const delta = mode === 'above' ? 1 : -1;
    src.zIndex = (dst.zIndex || 0) + delta;
    // Nudge any element that now ties with src's new zIndex away
    for (const o of S.els) {
      if (o.id === src.id) continue;
      if ((o.zIndex || 0) === (src.zIndex || 0)) {
        o.zIndex = (o.zIndex || 0) + (delta > 0 ? -1 : 1);
      }
    }
  }

  updateLayers();
  updateProps();
  render();
}

function togV(id, e) {
  e.stopPropagation();
  const el = S.els.find(e => e.id === id);
  if (el) { el.visible = !el.visible; updateLayers(); render(); }
}

function togL(id, e) {
  e.stopPropagation();
  const el = S.els.find(e => e.id === id);
  if (el) { el.locked = !el.locked; updateLayers(); }
}

/* ═══════════════════════════════════════════
   PROPERTIES PANEL
═══════════════════════════════════════════ */
function updateProps() {
  const panel = document.getElementById('pi');

  if (!S.sel.size) {
    panel.innerHTML = '<div class="mt"><em>&#x25C7;</em>Select an element<br>to edit properties</div>';
    return;
  }

  const el = S.els.find(e => S.sel.has(e.id));
  if (!el) return;

  // ── builder helpers ─────────────────────────────────────────
  const r   = (lbl, inp) => `<div class="pr"><span class="pl">${lbl}</span>${inp}</div>`;
  const num = (k, mn = -9999, st = 1) =>
    `<input class="pi" type="number" min="${mn}" step="${st}" value="${el[k] ?? 0}"
      onchange="sp('${el.id}','${k}',+this.value)">`;
  const chk = k =>
    `<input class="pi" type="checkbox" ${el[k] ? 'checked' : ''}
      onchange="sp('${el.id}','${k}',this.checked)">`;
  const crow = k =>
    `<div class="crow">
       <input type="color" value="${(el[k] || '#ffffff').slice(0, 7)}"
         onchange="sp('${el.id}','${k}',this.value);this.nextSibling.value=this.value">
       <input type="text"  value="${el[k] || '#ffffff'}"
         onchange="sp('${el.id}','${k}',this.value);this.previousSibling.value=this.value.slice(0,7)">
     </div>`;
  const txt = (k, ph = '') =>
    `<input class="pi" value="${esc(el[k] || '')}" placeholder="${ph}"
      onchange="sp('${el.id}','${k}',this.value)">`;
  const fntSel = () =>
    `<select class="pi" onchange="sp('${el.id}','font',+this.value)">
       ${FONTS.map((f, i) => `<option value="${i}"${el.font === i ? ' selected' : ''}>${i}</option>`).join('')}
     </select>`;
  const parSel = () => {
    const opts = S.els
      .filter(e => e.id !== el.id && e.type === 'Square')
      .map(e => `<option value="${e.id}"${el.parentId === e.id ? ' selected' : ''}>${esc(e.name)}</option>`)
      .join('');
    return `<select class="pi" onchange="spPar('${el.id}',this.value)">
              <option value=""${!el.parentId ? ' selected' : ''}>None</option>
              ${opts}
            </select>`;
  };
  // fnSig / bodyHint / bodyExample / bodyScope are shared with the Callbacks tab
  // (defined at module scope below — `cbFnSig`, `cbBodyHint`, `cbBodyExample`).
  const fnSig       = () => cbFnSig(el);
  const bodyHint    = () => cbBodyHint(el);
  const bodyExample = () => cbBodyExample(el);
  const bodyTA = () =>
    `<div class="pgt" style="margin-top:8px;border-top:none">Body</div>
     <div class="info" style="margin-bottom:5px">${bodyHint()}</div>
     <textarea class="ta cbody" rows="10" spellcheck="false"
       style="resize:vertical;min-height:120px;font-family:'JetBrains Mono',monospace;font-size:11.5px;line-height:1.45;width:100%;box-sizing:border-box"
       placeholder="${esc(bodyExample())}"
       onchange="sp('${el.id}','callbackBody',formatLuaBody(this.value))">${esc(el.callbackBody || '')}</textarea>
     <div class="info" style="margin-top:4px;opacity:.7">Auto-indents on blur (click out / Tab away). Inline blocks like <code>if x then y end</code> are left alone.</div>`;

  // ── name field ──────────────────────────────────────────────
  let h = `<input class="pnm" value="${esc(el.name)}"
              onchange="sp('${el.id}','name',this.value)">`;

  // ── Basic ───────────────────────────────────────────────────
  h += `<div class="pg"><div class="pgt">Basic</div>`;
  h += r('Visible',       chk('visible'));
  h += r('ZIndex',        num('zIndex', -2147483647));
  h += r('Transparency',
    `<input class="pi" type="range" min="0" max="1" step="0.01" value="${el.opacity ?? 1}"
       oninput="sp('${el.id}','opacity',+this.value)">`);
  h += r('Fix To (Parent)', parSel());
  if (el.parentId) {
    const pn = S.els.find(e => e.id === el.parentId)?.name || '?';
    h += `<div class="info pur">&#x21B3; Coords relative to ${esc(pn)}</div>`;
  }
  if (S.tabs.length > 1) {
    h += r('Shared (all tabs)', chk('shared'));
    if (el.shared) h += `<div class="info">Visible on every tab — not affected by tab switching</div>`;
  }
  h += `</div>`;

  // ── Position / Size ─────────────────────────────────────────
  h += `<div class="pg"><div class="pgt">Position / Size</div>`;
  if (el.type === 'Circle') {
    h += r('X / Y', `<div class="p2">${num('x')}${num('y')}</div>`);
    h += r('Radius', num('radius', 1));
  } else if (el.type === 'Line' || el.type === 'Polyline') {
    h += r('From X/Y', `<div class="p2">${num('x1')}${num('y1')}</div>`);
    h += r('To X/Y',   `<div class="p2">${num('x2')}${num('y2')}</div>`);
  } else {
    h += r('Position X', num('x'));
    h += r('Position Y', num('y'));
    if (el.type !== 'Text') {
      h += r('Size W', num('w', 1));
      h += r('Size H', num('h', 1));
    }
  }
  h += `</div>`;

  // ── Appearance ──────────────────────────────────────────────
  // Switch has its own dedicated Off/On/Knob color section — skip the generic one.
  if (el.type !== 'Switch') {
    h += `<div class="pg"><div class="pgt">Appearance</div>`;
    h += r('Color', crow('color'));
    if (!['Image','Checkbox','Keybind','Dropdown','Slider','Button'].includes(el.type))
      h += r('Thickness', num('thickness', 0, 0.5));
    if (['Square','Triangle','Polyline'].includes(el.type))
      h += r('Filled', chk('filled'));
    if (['Square','Image','Checkbox','Keybind','Dropdown','Button'].includes(el.type))
      h += r('Rounding', num('rounding', 0));
    if (el.type === 'Circle')
      h += r('NumSides',
        `<input class="pi" type="number" min="3" max="128" value="${el.numSides || 64}"
           onchange="sp('${el.id}','numSides',+this.value)">`);
    h += `</div>`;
  }

  // ── Text ────────────────────────────────────────────────────
  if (el.type === 'Text') {
    const dynSrc = el.dynamicSource || '';
    const keybinds = S.els.filter(e => e.type === 'Keybind');
    const dynSelOpts = [
      ['', 'Static'],
      ['playerName', 'Player Name'],
      ['tabName', 'Active Tab Name'],
      ['clock', 'Clock (HH:MM:SS)'],
      ['runtime', 'Runtime (MM:SS)'],
      ['custom', 'Custom Lua Expr'],
      ...keybinds.map(kb => [`keybind:${kb.id}`, `Keybind → ${esc(kb.name || kb.id)}`]),
    ].map(([v, l]) => `<option value="${v}"${dynSrc === v ? ' selected' : ''}>${l}</option>`).join('');
    h += `<div class="pg"><div class="pgt">Text</div>`;
    h += r('Source', `<select class="pi" onchange="sp('${el.id}','dynamicSource',this.value)">${dynSelOpts}</select>`);
    if (dynSrc === '') h += r('Content', txt('text'));
    if (dynSrc === 'custom') h += r('Lua Expr', `<textarea class="pi" rows="3" placeholder="e.g. tostring(workspace.DistributedGameTime)" onchange="sp('${el.id}','dynamicExpr',this.value)" oninput="sp('${el.id}','dynamicExpr',this.value)" style="resize:vertical;font-family:monospace;font-size:11px;width:100%;box-sizing:border-box">${esc(el.dynamicExpr || '')}</textarea>`);
    h += r('Size',    num('size', 4));
    h += r('Font',    fntSel());
    h += r('Centered', chk('center'));
    h += r('Outline',  chk('outline'));
    if (el.outline) h += r('Outl. Color', crow('outlineColor'));
    h += `</div>`;
  }

  // ── Image ───────────────────────────────────────────────────
  if (el.type === 'Image') {
    h += `<div class="pg"><div class="pgt">Image</div>`;
    h += r('URL', txt('url', 'https://...'));
    h += `</div>`;
  }

  // ── Checkbox ─────────────────────────────────────────────────
  if (el.type === 'Checkbox') {
    h += `<div class="pg"><div class="pgt">Checkbox</div>`;
    h += r('Default Checked', chk('defaultChecked'));
    h += r('Outline Color',   crow('outlineColor'));
    h += r('Outline Thick',   num('outlineThickness', 0, 0.5));
    h += r('Checked Color',   crow('checkedColor'));
    h += r('Text',            txt('label'));
    h += r('Text Size',       num('textSize', 4));
    h += r('Text Color',      crow('textColor'));
    h += r('Text Outline',    chk('textOutline'));
    h += r('Font',            fntSel());
    h += r('Corner Radius',   num('rounding', 0));
    h += `</div>`;
    h += `<div class="pg"><div class="pgt">Callback</div>`;
    h += `<div class="pr"><span class="pl">Fn</span><div class="fnprev">${esc(fnSig())}</div></div>`;
    h += r('Suffix', txt('callback', 'Toggle'));
    h += r('Excl. Group', txt('exclusiveGroup', 'e.g. tabs'));
    h += `<div class="info">If set, checking this will uncheck all other checkboxes with the same group name</div>`;
    h += bodyTA();
    h += `</div>`;
  }

  // ── Keybind ──────────────────────────────────────────────────
  if (el.type === 'Keybind') {
    const keySel = () =>
      `<select class="pi" onchange="sp('${el.id}','defaultKey',this.value)">
         ${COMMON_KEYS.map(k =>
           `<option value="${k}"${el.defaultKey === k ? ' selected' : ''}>${k}</option>`
         ).join('')}
       </select>`;
    const kbAction = el.action || 'CustomFunction';
    // Collect every toggleable widget in the project so the key can flip any of them.
    // Keybinds work across tabs, so we include targets from every tab (not just the active one).
    const toggleTargets = S.els.filter(e =>
      e.type === 'Checkbox' || e.type === 'Switch' || (e.type === 'Button' && e.toggleMode)
    );
    const actionSel = `<select class="pi" onchange="sp('${el.id}','action',this.value)">
      <option value="CustomFunction"${kbAction === 'CustomFunction' ? ' selected' : ''}>Custom Function</option>
      <option value="ToggleUI"${kbAction === 'ToggleUI' ? ' selected' : ''}>Toggle UI</option>
      <option value="DestroyUI"${kbAction === 'DestroyUI' ? ' selected' : ''}>Destroy UI</option>
      ${S.tabs.map((t, i) =>
        `<option value="switchTab:${t.id}"${kbAction === `switchTab:${t.id}` ? ' selected' : ''}>Switch Tab → ${esc(t.name)}</option>`
      ).join('')}
      ${toggleTargets.map(t =>
        `<option value="toggleTarget:${t.id}"${kbAction === `toggleTarget:${t.id}` ? ' selected' : ''}>Toggle → ${esc(t.name)} (${t.type})</option>`
      ).join('')}
    </select>`;
    h += `<div class="pg"><div class="pgt">Keybind</div>`;
    h += r('Default Key',  keySel());
    h += r('Action',       actionSel);
    if (kbAction.startsWith('toggleTarget:')) {
      const tgtId  = kbAction.slice('toggleTarget:'.length);
      const tgtEl  = S.els.find(e => e.id === tgtId);
      if (tgtEl) {
        const tgtTab = S.tabs.find(t => t.id === tgtEl.tabId);
        const loc    = tgtEl.shared ? 'shared' : (tgtTab ? `on tab “${esc(tgtTab.name)}”` : 'untracked tab');
        h += `<div class="info">Flips <b>${esc(tgtEl.name)}</b>'s state (${loc}). The target's callback body still runs in response, same as a click.</div>`;
      } else {
        h += `<div class="info" style="color:var(--org)">⚠ Toggle target no longer exists — this keybind will be silent. Pick a new target or switch action back to Custom Function.</div>`;
      }
    }
    if (kbAction === 'DestroyUI') {
      h += `<div class="info" style="color:var(--org)">Permanently removes every Drawing in this UI and disconnects all RunService callbacks. The script effectively stops after this fires. Use to close a menu cleanly without crashing Drawing.clear().</div>`;
    }
    h += r('Filled',       chk('filled'));
    h += r('Text Size',    num('textSize', 4));
    h += r('Text Color',   crow('textColor'));
    h += r('Text Outline', chk('textOutline'));
    h += r('Font',         fntSel());
    h += `</div>`;
    if (kbAction === 'CustomFunction') {
      h += `<div class="pg"><div class="pgt">Callback</div>`;
      h += `<div class="pr"><span class="pl">Fn</span><div class="fnprev">${esc(fnSig())}</div></div>`;
      h += r('Suffix', txt('callback', 'Change'));
      h += bodyTA();
      h += `</div>`;
    }
  }

  // ── Dropdown ─────────────────────────────────────────────────
  if (el.type === 'Dropdown') {
    const ddDyn = !!(el.dynamicOptions && el.dynamicOptions.trim());
    h += `<div class="pg"><div class="pgt">Dropdown</div>`;
    if (!ddDyn) {
      h += `<div class="pr"><span class="pl">Options</span>
              <textarea class="ta" onchange="sp('${el.id}','options',this.value)">${esc(el.options || '')}</textarea>
            </div>`;
      h += `<div class="info">One option per comma. Default Index is 0-based (0 = first option)</div>`;
      h += r('Default Index', num('defaultIndex', 0));
      h += r('Auto-Select Default', chk('autoSelectDefault'));
      h += `<div class="info">When enabled, fires the callback once at startup with the default-selected option — no need for the user to pick it manually.</div>`;
    }
    h += `<div class="pr"><span class="pl">Dynamic Options</span>
            <textarea class="ta" rows="5"
              placeholder="Leave blank for static options.&#10;Expression OR statement block returning a sequence:&#10;&#10;  Players:GetPlayers()&#10;&#10;  local t = {}&#10;  for _, p in Players:GetPlayers() do&#10;    t[#t+1] = p.Name&#10;  end&#10;  return t"
              onchange="sp('${el.id}','dynamicOptions',this.value)">${esc(el.dynamicOptions||'')}</textarea>
          </div>`;
    if (ddDyn) {
      h += `<div class="info">Lua that returns a sequence. A single expression works (<code>Players:GetPlayers()</code>) or paste a multi-line block ending in <code>return &lt;table&gt;</code> — statements are auto-wrapped in a function. Re-evaluated every frame while the dropdown is open. Non-string items render via <code>tostring()</code>; the callback's <code>selected</code> arg is the <code>tostring()</code> form.</div>`;
      h += r('Max Slots', `<input class="pi" type="number" min="1" max="100" value="${el.maxOptions||20}" onchange="sp('${el.id}','maxOptions',+this.value)">`);
      h += `<div class="info">Pre-allocates Drawing slots. Set to the max number of items the expression can return.</div>`;
    }
    h += r('Text Size',   num('textSize', 4));
    h += r('Text Color',  crow('textColor'));
    h += r('Text Outline',chk('textOutline'));
    h += r('Font',        fntSel());
    h += r('Corner Radius',num('rounding', 0));
    h += r('Filled',      chk('filled'));
    h += `</div>`;
    h += `<div class="pg"><div class="pgt">Callback</div>`;
    h += `<div class="pr"><span class="pl">Fn</span><div class="fnprev">${esc(fnSig())}</div></div>`;
    h += r('Suffix', txt('callback', 'Change'));
    h += bodyTA();
    h += `</div>`;
  }

  // ── Slider ───────────────────────────────────────────────────
  if (el.type === 'Slider') {
    h += `<div class="pg"><div class="pgt">Slider</div>`;
    h += r('Min Value',    num('minVal', -99999));
    h += r('Max Value',    num('maxVal', -99999));
    h += r('Current Value',num('curVal', -99999, el.step || 1));
    h += r('Step',         num('step', 0, 0.01));
    h += r('Knob Color',   crow('knobColor'));
    h += r('Corner Radius',num('rounding', 0));
    h += r('Value Suffix', txt('suffix', 'e.g. %'));
    h += r('Filled (Track)',chk('filled'));
    h += `</div>`;
    h += `<div class="pg"><div class="pgt">Callback</div>`;
    h += `<div class="pr"><span class="pl">Fn</span><div class="fnprev">${esc(fnSig())}</div></div>`;
    h += r('Suffix', txt('callback', 'Change'));
    h += r('Fire on Release', chk('fireOnRelease'));
    h += `<div class="info">When on, the callback only fires when you release the mouse — not while dragging</div>`;
    h += bodyTA();
    h += `</div>`;
  }

  // ── Button ───────────────────────────────────────────────────
  if (el.type === 'Button') {
    const btAction = el.action || 'CustomFunction';
    const btActionSel = `<select class="pi" onchange="sp('${el.id}','action',this.value)">
      <option value="CustomFunction"${btAction === 'CustomFunction' ? ' selected' : ''}>Custom Function</option>
      <option value="DestroyUI"${btAction === 'DestroyUI' ? ' selected' : ''}>Destroy UI</option>
      ${S.tabs.map((t, i) =>
        `<option value="switchTab:${t.id}"${btAction === `switchTab:${t.id}` ? ' selected' : ''}>Switch Tab → ${esc(t.name)}</option>`
      ).join('')}
    </select>`;
    h += `<div class="pg"><div class="pgt">Button</div>`;
    h += r('Label',       txt('label'));
    h += r('Action',      btActionSel);
    h += r('Text Size',   num('textSize', 4));
    h += r('Text Color',  crow('textColor'));
    h += r('Text Outline',chk('textOutline'));
    h += r('Hover Color', crow('hoverColor'));
    if (btAction.startsWith('switchTab:')) {
      h += r('Active Tab Bg',   crow('tabActiveColor'));
      h += r('Active Tab Text', crow('tabActiveTextColor'));
      h += `<div class="info">Colors applied to this button when its tab is currently active</div>`;
    }
    h += r('Filled',      chk('filled'));
    h += r('Thickness',   num('thickness', 0, 0.5));
    h += r('Font',        fntSel());
    // Image-button — Immediate mode only, gated by the IMAGE_ENABLED feature flag.
    if (S.drawingMode === 'immediate' && typeof IMAGE_ENABLED !== 'undefined' && IMAGE_ENABLED) {
      h += r('Image URL', txt('imageUrl', 'https://... (optional)'));
      h += `<div class="info cyan">Immediate-mode only. When set, the button background becomes this image — tinted by the current Color / Hover / Active state so hover & toggle still work visually.</div>`;
    }
    if (btAction === 'DestroyUI') {
      h += `<div class="info" style="color:var(--org)">Permanently removes every Drawing in this UI and disconnects all RunService callbacks. Use to close the menu cleanly without crashing Drawing.clear().</div>`;
    }
    h += `</div>`;
    if (btAction === 'CustomFunction') {
      h += `<div class="pg"><div class="pgt">Callback</div>`;
      h += `<div class="pr"><span class="pl">Fn</span><div class="fnprev">${esc(fnSig())}</div></div>`;
      h += r('Suffix', txt('callback', 'Click'));
      h += r('Toggle Mode', chk('toggleMode'));
      h += `<div class="info">When on, the button stays active after clicking and flips between on/off — the callback receives a boolean state</div>`;
      if (el.toggleMode) h += r('Active Color', crow('activeColor'));
      h += bodyTA();
      h += `</div>`;
    }
  }

  // ── Switch ───────────────────────────────────────────────────
  if (el.type === 'Switch') {
    h += `<div class="pg"><div class="pgt">Switch</div>`;
    h += r('Default On',   chk('defaultEnabled'));
    h += r('Off Color',    crow('color'));
    h += r('On Color',     crow('onColor'));
    h += r('Knob Color',   crow('knobColor'));
    h += r('Rounding',     num('rounding', 0));
    h += `<div class="info">Track corner radius. Set to half the height for a pill (e.g. h=22 → rounding=11).</div>`;
    h += r('Label',        txt('label'));
    h += r('Text Size',    num('textSize', 4));
    h += r('Text Color',   crow('textColor'));
    h += r('Text Outline', chk('textOutline'));
    h += r('Font',         fntSel());
    h += `</div>`;
    h += `<div class="pg"><div class="pgt">Callback</div>`;
    h += `<div class="pr"><span class="pl">Fn</span><div class="fnprev">${esc(fnSig())}</div></div>`;
    h += r('Suffix',      txt('callback', 'Toggle'));
    h += r('Excl. Group', txt('exclusiveGroup', 'e.g. modes'));
    h += `<div class="info">If set, turning this on will turn off every other Switch with the same group name.</div>`;
    h += bodyTA();
    h += `</div>`;
  }

  // ── Square: draggable ────────────────────────────────────────
  if (el.type === 'Square') {
    h += `<div class="pg"><div class="pgt">Behavior</div>`;
    h += r('Draggable', chk('draggable'));
    h += `</div>`;
  }

  // ── Layer ordering ───────────────────────────────────────────
  h += `<div class="pg"><div class="pgt">Layer</div>`;
  h += `<div class="pr" style="gap:4px">
    <button class="btn" style="flex:1;font-size:10px" onclick="bZ('${el.id}',1)">&#x25B2;+Z</button>
    <button class="btn" style="flex:1;font-size:10px" onclick="bZ('${el.id}',-1)">&#x25BC;&minus;Z</button>
    <button class="btn" style="flex:1;font-size:10px" onclick="bZ('${el.id}',999)">&#x2B06;Top</button>
    <button class="btn" style="flex:1;font-size:10px" onclick="bZ('${el.id}',-999)">&#x2B07;Bot</button>
  </div></div>`;

  panel.innerHTML = h;

  panel.querySelectorAll('.cbody').forEach(ta => {
    ta.addEventListener('keydown', ev => {
      if (ev.key === 'Tab') {
        ev.preventDefault();
        const s = ta.selectionStart, e2 = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(e2);
        ta.selectionStart = ta.selectionEnd = s + 4;
        sp(el.id, 'callbackBody', ta.value);
      }
    });
  });
}

/* ═══════════════════════════════════════════
   TAB MANAGEMENT
═══════════════════════════════════════════ */
function updateTabBar() {
  const list = document.getElementById('tablist');
  if (!list) return;
  list.innerHTML = S.tabs.map(t => {
    const act = t.id === S.activeTab ? ' act' : '';
    const del = S.tabs.length > 1
      ? `<span class="tabx" onclick="event.stopPropagation();deleteTab('${t.id}')">&#x2715;</span>`
      : '';
    return `<div class="tabitem${act}" onclick="switchActiveTab('${t.id}')"
              ondblclick="startRenameTab('${t.id}')">
              <span class="tabn" id="tabn_${t.id}">${esc(t.name)}</span>${del}
            </div>`;
  }).join('');
}

function switchActiveTab(id) {
  S.activeTab = id;
  S.sel.clear();
  _lastHit = null;
  _lastClickPos = null;
  _codeDirty = true;
  updateTabBar();
  updateLayers();
  updateProps();
  render();
}

function addTab() {
  const id   = 'tab' + Date.now().toString(36);
  const name = 'Tab ' + (S.tabs.length + 1);
  S.tabs.push({ id, name });
  pushH();
  switchActiveTab(id);
}

function deleteTab(id) {
  if (S.tabs.length <= 1) return;
  const idx      = S.tabs.findIndex(t => t.id === id);
  const fallback = S.tabs[idx > 0 ? idx - 1 : 1].id;
  S.els.forEach(el => { if (el.tabId === id) el.tabId = fallback; });
  S.tabs.splice(idx, 1);
  pushH();
  if (S.activeTab === id) switchActiveTab(fallback);
  else { updateTabBar(); updateLayers(); render(); _codeDirty = true; }
}

function renameTab(id, name) {
  const t = S.tabs.find(t => t.id === id);
  if (!t) return;
  const trimmed = name.trim();
  if (trimmed) t.name = trimmed;
  _codeDirty = true;
  updateTabBar();
  pushH();
}

function startRenameTab(id) {
  const span = document.getElementById('tabn_' + id);
  if (!span) return;
  const orig = span.textContent;
  span.contentEditable = true;
  span.focus();
  document.execCommand('selectAll', false, null);
  const finish = () => {
    span.contentEditable = false;
    renameTab(id, span.textContent || orig);
  };
  span.onblur    = finish;
  span.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); span.blur(); } };
}
