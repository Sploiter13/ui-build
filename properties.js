'use strict';

/* ═══════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════ */
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
   LAYERS PANEL
═══════════════════════════════════════════ */
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
      + (item.visible       ? ''     : ' hid');

    const indent = depth
      ? `<span class="lind" style="min-width:${depth * 12}px"></span>`
        + `<span style="width:8px;height:1px;background:var(--b2);flex-shrink:0;display:inline-block;margin-right:2px"></span>`
      : `<span class="lind" style="min-width:0"></span>`;

    d.innerHTML = indent
      + `<span class="li" onclick="togV('${item.id}',event)">${item.visible ? '&#x1F441;' : '&middot;'}</span>`
      + `<span class="li" onclick="togL('${item.id}',event)">${item.locked  ? '&#x1F512;' : '&middot;'}</span>`
      + `<span class="ln" style="color:${UI_TYPES.has(item.type) ? 'var(--pur)' : 'inherit'}">${esc(item.name)}</span>`
      + `<span class="lt" style="color:${typeColor(item)}">${item.type.slice(0, 3)}</span>`
      + `<span class="lz">${item.zIndex || 0}</span>`;

    d.onclick = ev => {
      if (ev.target.classList.contains('li')) return;
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
  const fnSig = () => {
    const fn = `On${vn(el)}${el.callback || ''}`;
    switch (el.type) {
      case 'Checkbox': return `${fn}(state: boolean)`;
      case 'Keybind':  return `${fn}(key: string)`;
      case 'Dropdown': return `${fn}(selected: string, index: number)`;
      case 'Slider':   return `${fn}(value: number)`;
      case 'Button':   return el.toggleMode ? `${fn}(state: boolean)` : `${fn}()`;
      default:         return fn;
    }
  };
  const bodyHint = () => {
    switch (el.type) {
      case 'Checkbox': return 'state: boolean &mdash; true = checked &bull; use wait(n) for waiting';
      case 'Keybind':  return 'key: string &mdash; e.g. &quot;Insert&quot;, &quot;F1&quot;, &quot;A&quot;';
      case 'Dropdown': return 'selected: string, index: number &mdash; index is 1-based';
      case 'Slider':   return 'value: number &mdash; current slider value';
      case 'Button':   return el.toggleMode ? 'state: boolean &mdash; true when toggled on &bull; use wait(n) for waiting' : '(no parameters)';
    }
  };
  const bodyTA = () =>
    `<div class="pgt" style="margin-top:8px;border-top:none">Body</div>
     <div class="info" style="margin-bottom:5px">${bodyHint()}</div>
     <textarea class="ta cbody" rows="5" spellcheck="false"
       placeholder="-- write your Lua code here"
       onchange="sp('${el.id}','callbackBody',this.value)">${esc(el.callbackBody || '')}</textarea>`;

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

  // ── Text ────────────────────────────────────────────────────
  if (el.type === 'Text') {
    const dynSrc = el.dynamicSource || '';
    const keybinds = S.els.filter(e => e.type === 'Keybind');
    const dynSelOpts = [
      ['', 'Static'],
      ['playerName', 'Player Name'],
      ['tabName', 'Active Tab Name'],
      ['clock', 'Clock (HH:MM:SS)'],
      ['custom', 'Custom Lua Expr'],
      ...keybinds.map(kb => [`keybind:${kb.id}`, `Keybind → ${esc(kb.name || kb.id)}`]),
    ].map(([v, l]) => `<option value="${v}"${dynSrc === v ? ' selected' : ''}>${l}</option>`).join('');
    h += `<div class="pg"><div class="pgt">Text</div>`;
    h += r('Source', `<select class="pi" onchange="sp('${el.id}','dynamicSource',this.value)">${dynSelOpts}</select>`);
    if (dynSrc === '') h += r('Content', txt('text'));
    if (dynSrc === 'custom') h += r('Lua Expr', `<input class="pi" value="${esc(el.dynamicExpr || '')}" placeholder="e.g. tostring(workspace.DistributedGameTime)" onchange="sp('${el.id}','dynamicExpr',this.value)">`);
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
    const actionSel = `<select class="pi" onchange="sp('${el.id}','action',this.value)">
      <option value="CustomFunction"${kbAction === 'CustomFunction' ? ' selected' : ''}>Custom Function</option>
      <option value="ToggleUI"${kbAction === 'ToggleUI' ? ' selected' : ''}>Toggle UI</option>
      ${S.tabs.map((t, i) =>
        `<option value="switchTab:${t.id}"${kbAction === `switchTab:${t.id}` ? ' selected' : ''}>Switch Tab → ${esc(t.name)}</option>`
      ).join('')}
    </select>`;
    h += `<div class="pg"><div class="pgt">Keybind</div>`;
    h += r('Default Key',  keySel());
    h += r('Action',       actionSel);
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
    h += `<div class="pg"><div class="pgt">Dropdown</div>`;
    h += `<div class="pr"><span class="pl">Options</span>
            <textarea class="ta" onchange="sp('${el.id}','options',this.value)">${esc(el.options || '')}</textarea>
          </div>`;
    h += `<div class="info">One option per comma. Default Index is 0-based (0 = first option)</div>`;
    h += r('Default Index', num('defaultIndex', 0));
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
    h += r('Current Value',num('curVal', -99999));
    h += r('Step',         num('step', 1));
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
