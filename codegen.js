'use strict';

/* ═══════════════════════════════════════════
   HISTORY
═══════════════════════════════════════════ */
function ser() {
  return JSON.stringify({
    tabs:        S.tabs,
    activeTab:   S.activeTab,
    drawingMode: S.drawingMode,
    sel:         Array.from(S.sel),
    els: S.els.map(e => {
      const c = { ...e };
      delete c._img;
      delete c._ok;
      return c;
    }),
  });
}

function pushH() {
  S.hist.push(ser());
  if (S.hist.length > 80) S.hist.shift();
  S.fut = [];
  _codeDirty = true;
}

function restoreSnap(snap) {
  const d = JSON.parse(snap);
  S.els         = d.els || d;   // support old flat-array format
  S.tabs        = d.tabs      || [{ id: 'tab1', name: 'Tab 1' }];
  S.activeTab   = d.activeTab || S.tabs[0].id;
  S.drawingMode = d.drawingMode || 'static';
  // Restore selection (filter out ids that no longer exist — safe against
  // redo past a delete).  Older snapshots without `sel` yield an empty set.
  S.sel = new Set(Array.isArray(d.sel) ? d.sel.filter(id => S.els.some(e => e.id === id)) : []);
}

function undo() {
  if (!S.hist.length) return;
  _codeDirty = true;
  _spBurstKey = null;   // end any property-edit burst so the next edit snapshots fresh
  S.fut.push(ser());
  restoreSnap(S.hist.pop());
  S.els.filter(elNeedsImg).forEach(loadImg);
  _lastHit = null;
  _lastClickPos = null;
  rebuildCnt();
  updateTabBar(); updateLayers(); updateProps(); updateCallbacks(); render();
  toast('Undo');
}

function redo() {
  if (!S.fut.length) return;
  _codeDirty = true;
  _spBurstKey = null;
  S.hist.push(ser());
  restoreSnap(S.fut.pop());
  S.els.filter(elNeedsImg).forEach(loadImg);
  _lastHit = null;
  _lastClickPos = null;
  rebuildCnt();
  updateTabBar(); updateLayers(); updateProps(); updateCallbacks(); render();
  toast('Redo');
}

/* ═══════════════════════════════════════════
   SAVE / LOAD / AUTOSAVE
═══════════════════════════════════════════ */
function rebuildCnt() {
  S.cnt = {};
  // Ensure every element has a tabId (backfill for old projects)
  const defaultTab = S.tabs[0]?.id || 'tab1';
  for (const el of S.els) {
    if (!el.tabId) el.tabId = defaultTab;
    const m = (el.name || '').match(/(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if ((S.cnt[el.type] || 0) < n) S.cnt[el.type] = n;
    }
  }
}

function newProject() {
  if (S.els.length && !confirm('Clear canvas?')) return;
  pushH();
  S.els       = [];
  S.tabs      = [{ id: 'tab1', name: 'Tab 1' }];
  S.activeTab = 'tab1';
  S.sel.clear();
  S.cnt         = {};
  S.drawingMode = 'static';
  _lastHit      = null;
  updateTabBar(); updateLayers(); updateProps(); updateCallbacks(); render(); updateModeUI();
}

function saveJSON() {
  const d = JSON.stringify({
    v: 5,
    w: CV.width,
    h: CV.height,
    tabs:        S.tabs,
    activeTab:   S.activeTab,
    drawingMode: S.drawingMode,
    elements: S.els.map(e => {
      const c = { ...e };
      delete c._img;
      delete c._ok;
      return c;
    }),
  }, null, 2);
  const a = document.createElement('a');
  a.href     = URL.createObjectURL(new Blob([d], { type: 'application/json' }));
  a.download = 'severe_ui.json';
  a.click();
  toast('Saved!');
}

function loadJSON(ev) {
  const f = ev.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = e => {
    try {
      const d = JSON.parse(e.target.result);
      pushH();
      S.els         = d.elements || [];
      S.tabs        = d.tabs      || [{ id: 'tab1', name: 'Tab 1' }];
      S.activeTab   = d.activeTab || S.tabs[0].id;
      S.drawingMode = d.drawingMode || 'static';
      S.sel.clear();
      rebuildCnt();
      if (d.w) { document.getElementById('icw').value = d.w; CV.width  = d.w; }
      if (d.h) { document.getElementById('ich').value = d.h; CV.height = d.h; }
      S.els.filter(elNeedsImg).forEach(loadImg);
      updateTabBar(); updateLayers(); updateProps(); updateCallbacks(); render(); updateModeUI();
      toast('Loaded!');
    } catch {
      alert('Invalid file.');
    }
  };
  rd.readAsText(f);
  ev.target.value = '';
}

setInterval(() => { try { localStorage.setItem('sevui4', ser()); } catch {} }, 6000);

try {
  const s = localStorage.getItem('sevui4');
  if (s) {
    const d = JSON.parse(s);
    S.els         = d.els || d;   // support old flat format
    S.tabs        = d.tabs      || [{ id: 'tab1', name: 'Tab 1' }];
    S.activeTab   = d.activeTab || S.tabs[0].id;
    S.drawingMode = d.drawingMode || 'static';
    rebuildCnt();
    S.els.filter(elNeedsImg).forEach(loadImg);
  }
} catch {}

updateTabBar();

/* ═══════════════════════════════════════════
   TABS / STATUS / TOAST
═══════════════════════════════════════════ */
let _codeDirty = true;

function switchTab(t) {
  document.getElementById('pw').classList.toggle('on', t === 'p');
  document.getElementById('kw').classList.toggle('on', t === 'k');
  document.getElementById('cw').classList.toggle('on', t === 'c');
  document.getElementById('tp').classList.toggle('act', t === 'p');
  document.getElementById('tk').classList.toggle('act', t === 'k');
  document.getElementById('tc').classList.toggle('act', t === 'c');
  if (t === 'k') updateCallbacks();
  if (t === 'c' && _codeDirty) {
    document.getElementById('co').value = genLua();
    _codeDirty = false;
  }
}

/* ═══════════════════════════════════════════
   CALLBACKS TAB
   One row per interactive widget that has an editable body.
   Reads/writes the same `callbackBody` field the Properties panel edits.
═══════════════════════════════════════════ */
let _cbFilter = 'all';   // 'all' | 'Checkbox' | 'Keybind' | ...
let _cbSearch = '';

function updateCallbacks() {
  const panel = document.getElementById('ki');
  if (!panel) return;
  // Skip work when the Callbacks tab isn't visible — `switchTab('k')` calls this
  // on activation, so the tab always shows fresh content when opened.
  const wrap = document.getElementById('kw');
  if (wrap && !wrap.classList.contains('on')) return;

  const tabName = (tabId) => (S.tabs.find(t => t.id === tabId) || {}).name || 'Tab';
  const rows    = S.els.filter(cbHasBody);

  // header + filter chips
  const chip = (key, label) =>
    `<span class="kbk-chip${_cbFilter === key ? ' act' : ''}"
      onclick="_setCbFilter('${key}')">${label}</span>`;
  let h = `
    <div class="kbk-filter">
      ${chip('all',      'All')}
      ${chip('Checkbox', 'Checkbox')}
      ${chip('Keybind',  'Keybind')}
      ${chip('Dropdown', 'Dropdown')}
      ${chip('Slider',   'Slider')}
      ${chip('Button',   'Button')}
    </div>
    <input class="kbk-search" placeholder="Filter by name&hellip;"
           value="${esc(_cbSearch)}" oninput="_setCbSearch(this.value)">
  `;

  const q = _cbSearch.trim().toLowerCase();
  const filtered = rows.filter(e =>
    (_cbFilter === 'all' || e.type === _cbFilter) &&
    (!q || (e.name || '').toLowerCase().includes(q))
  );

  if (filtered.length === 0) {
    h += `<div class="kbk-empty">
            <em>&#x25C7;</em>
            ${rows.length === 0
              ? 'No interactive widgets yet.<br>Add a Checkbox, Button, Slider, Keybind, or Dropdown from the left palette.'
              : 'No widgets match the current filter.'}
          </div>`;
    panel.innerHTML = h;
    return;
  }

  for (const el of filtered) {
    const tn    = tabName(el.tabId);
    const type  = el.type + (el.type === 'Button' ? (el.toggleMode ? ' &middot; Toggle' : ' &middot; Click') : '');
    const sig   = esc(cbFnSig(el));
    const body  = esc(el.callbackBody || '');
    const ex    = esc(cbBodyExample(el));
    h += `
      <div class="kbk-row" data-id="${el.id}">
        <div class="kbk-row-head">
          <span class="kbk-row-tab">${esc(tn)}</span>
          <span class="kbk-row-name">${esc(el.name)}</span>
          <span class="kbk-row-type">(${type})</span>
          <button class="kbk-jump" onclick="_cbGoto('${el.id}')">Go to widget</button>
        </div>
        <div class="kbk-sig">${sig}</div>
        <textarea class="kbk-body" spellcheck="false" placeholder="${ex}"
          onchange="sp('${el.id}','callbackBody',formatLuaBody(this.value))">${body}</textarea>
      </div>`;
  }

  panel.innerHTML = h;
}

function _setCbFilter(f) { _cbFilter = f; updateCallbacks(); }
function _setCbSearch(q) { _cbSearch = q; updateCallbacks(); }

// Jump: switch UI-design tab to the widget's tab, select it, switch right panel to Properties.
function _cbGoto(id) {
  const el = S.els.find(e => e.id === id);
  if (!el) return;
  if (el.tabId && el.tabId !== S.activeTab && !el.shared) {
    S.activeTab = el.tabId;
    if (typeof updateTabBar === 'function') updateTabBar();
  }
  S.sel.clear();
  S.sel.add(el.id);
  switchTab('p');
  render();
  updateLayers();
  updateProps();
  updateStatus();
}

function updateStatus() {
  document.getElementById('sc').textContent = S.els.length;
  document.getElementById('ss').textContent = S.sel.size;
}

let _tT;
function toast(m) {
  const t = document.getElementById('toast');
  t.textContent = m;
  t.classList.add('on');
  clearTimeout(_tT);
  _tT = setTimeout(() => t.classList.remove('on'), 1800);
}

/* ═══════════════════════════════════════════
   LUA CODE GENERATION
   Follows Instructionssv2 ion/gooo style:
     - --!strict + --!optimize 2, no global --!native
     - Section order: directives → environment → constants
                      → variables → functions → runtime
     - @native only on hot pure-math local functions
     - Color3 via fromRGB
     - Text.OutlineColor via Vector3.new (per drawing docs)
     - PreLocal for all UI / drag logic — no yielding
     - getpressedkeys() for key detection
     - Camera.ViewportSize for screen size reference
═══════════════════════════════════════════ */

function hexRGB(h) {
  if (!h || h.length < 7) return [255, 255, 255];
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
}

function c3(h) {
  const [r, g, b] = hexRGB(h);
  return `Color3.fromRGB(${r}, ${g}, ${b})`;
}

function outlineV3(h) {
  const [r, g, b] = hexRGB(h);
  return `Vector3.new(${+(r/255).toFixed(3)}, ${+(g/255).toFixed(3)}, ${+(b/255).toFixed(3)})`;
}

function v2(x, y) {
  return `Vector2.new(${Math.round(x)}, ${Math.round(y)})`;
}

function fn(n) {
  return Number.isInteger(n) ? String(n) : Number(n).toFixed(2);
}

/* ═══════════════════════════════════════════
   ROTATION GEOMETRY (baked at codegen time)
   Rotation is a static per-element property, so we pre-rotate the geometry once
   during generation — no per-frame trig in the emitted Lua. Everything rotates
   around the element's bounding-box CENTER, matching the canvas preview.
═══════════════════════════════════════════ */
// Rotate point (x,y) by `deg` degrees around (cx,cy). Returns [x, y] floats.
function rotateAround(x, y, cx, cy, deg) {
  if (!deg) return [x, y];
  const r = deg * Math.PI / 180, s = Math.sin(r), c = Math.cos(r);
  const dx = x - cx, dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}
// Triangle's three vertices (top-center, bottom-left, bottom-right), rotated
// around the bbox center. `b` is the world-space bounds.
function triPoints(el, b) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, deg = el.rotation || 0;
  return [
    rotateAround(b.x + b.w / 2, b.y,         cx, cy, deg),
    rotateAround(b.x,           b.y + b.h,    cx, cy, deg),
    rotateAround(b.x + b.w,     b.y + b.h,    cx, cy, deg),
  ];
}
// Square's four corners (TL, TR, BR, BL), rotated around the bbox center.
function quadCorners(el, b) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, deg = el.rotation || 0;
  return [
    rotateAround(b.x,         b.y,         cx, cy, deg),
    rotateAround(b.x + b.w,   b.y,         cx, cy, deg),
    rotateAround(b.x + b.w,   b.y + b.h,   cx, cy, deg),
    rotateAround(b.x,         b.y + b.h,   cx, cy, deg),
  ];
}
// True when this Square should render as a rotated quad rather than a Square.
function isRotatedSquare(el) {
  return el.type === 'Square' && !!el.rotation;
}

// Wrap a dynamic-Dropdown options expression so the user can paste either a
// single Lua expression (e.g. `Players:GetPlayers()`) or a statement block
// that returns a sequence (e.g. `local t={} for _,p in … do t[#t+1]=p.Name end
// return t`). When a newline or statement keyword is present we wrap the body
// in an IIFE; otherwise we emit the expression verbatim.
function wrapDynOptsExpr(rawExpr) {
  const expr = (rawExpr || '').trim();
  const hasStmt = /\n/.test(expr) || /\b(?:return|for|while|local|if|repeat)\b/.test(expr);
  return hasStmt ? `(function() ${expr} end)()` : expr;
}

// Emit the unified RunService.PostLocal block that (1) dispatches event-driven
// callbacks (Keybind CF, Dropdown, Slider, Button click) from their `E.<v>Fired`
// flags set in PreLocal, and (2) runs the every-frame polling bodies for
// Checkbox + toggle-Button. Keeping both in one PostLocal connect keeps PreLocal
// lean (pure input/state) while still giving each polling widget its own
// `wait()` throttle via a per-widget `_wt` deadline.
function emitPostLocalInteractive(L, sorted, vn, needsDestroy) {
  const eventWidgets   = [];
  const pollingWidgets = [];
  for (const el of sorted) {
    if (!UI_TYPES.has(el.type)) continue;
    const act = el.action || 'CustomFunction';
    if (el.type === 'Keybind' && (
          act === 'ToggleUI' ||
          act === 'DestroyUI' ||
          act.startsWith('switchTab:') ||
          act.startsWith('toggleTarget:')
        )) continue;
    if (el.type === 'Button'  && (
          act === 'DestroyUI' ||
          act.startsWith('switchTab:')
        )) continue;
    if (el.type === 'Checkbox' ||
        el.type === 'Switch' ||
        (el.type === 'Button' && el.toggleMode)) {
      if ((el.callbackBody || '').trim()) pollingWidgets.push(el);
      continue;
    }
    // Event-driven: Keybind (CustomFunction), Dropdown, Slider, Button (click, CF)
    eventWidgets.push(el);
  }

  if (eventWidgets.length === 0 && pollingWidgets.length === 0) return;

  // Wrap PostLocal Connect with table.insert so DestroyUI can disconnect later.
  const postConnPre = needsDestroy ? '        table.insert(_Conns, ' : '        ';
  const postConnEnd = needsDestroy ? '        end))'                  : '        end)';

  L.push('');
  L.push('    do');
  for (const el of pollingWidgets) {
    const v = vn(el);
    L.push(`        local _wt${v}: number = 0`);
    L.push(`        local function _wait${v}(s: number) _wt${v} = os.clock() + s end`);
  }
  L.push(`${postConnPre}RunService.PostLocal:Connect(function()`);
  L.push('            if not isrbxactive() then return end');

  for (const el of eventWidgets) {
    const v  = vn(el);
    const cb = el.callback;
    L.push(`            if E.${v}Fired then`);
    if (el.type === 'Dropdown') {
      L.push(`                local _i: number = E.${v}FiredIdx`);
      L.push(`                E.${v}Fired = false`);
      L.push(`                On${v}${cb}(E.${v}Selected, _i)`);
    } else if (el.type === 'Keybind') {
      L.push(`                E.${v}Fired = false`);
      L.push(`                On${v}${cb}(E.${v}Key)`);
    } else if (el.type === 'Slider') {
      L.push(`                E.${v}Fired = false`);
      L.push(`                On${v}${cb}(E.${v}Value)`);
    } else if (el.type === 'Button') {
      L.push(`                E.${v}Fired = false`);
      L.push(`                On${v}${cb}()`);
    }
    L.push(`            end`);
  }

  for (const el of pollingWidgets) {
    const v        = vn(el);
    const stateVar = el.type === 'Checkbox' ? `${v}Checked`
                   : el.type === 'Switch'   ? `${v}Enabled`
                   :                          `${v}Toggled`;
    L.push('');
    L.push(`            if E.${stateVar} and os.clock() >= _wt${v} then`);
    L.push(`                local state: boolean = true`);
    L.push(`                local wait = _wait${v}`);
    for (const line of (el.callbackBody || '').trimEnd().split('\n'))
      L.push(`                ${line}`);
    L.push(`            end`);
  }

  L.push(postConnEnd);
  L.push('    end');
}

/* ═══════════════════════════════════════════
   DestroyUI HELPERS
   Shared by static + immediate codegen.
═══════════════════════════════════════════ */

// List every Drawing-field suffix attached to an element in static mode.
// Plain types (Square, Circle, Text, …) use `E.<v>` itself; compound widgets
// use sub-fields (E.<v>Background, E.<v>Fill, …). Return null for "plain".
function staticDrawingFields(el) {
  switch (el.type) {
    case 'Checkbox': return ['Background', 'Fill', 'Label'];
    case 'Keybind':  return ['Background', 'Text'];
    case 'Dropdown': {
      const opts  = (el.options || 'Option 1').split(',').map(o => o.trim());
      const isDyn = !!(el.dynamicOptions && el.dynamicOptions.trim());
      const slots = isDyn ? (el.maxOptions || 20) : opts.length;
      const arr   = ['Background', 'Text', 'Arrow'];
      for (let i = 0; i < slots; i++) {
        arr.push(`OptionBackground${i}`);
        arr.push(`OptionText${i}`);
      }
      return arr;
    }
    case 'Slider': return ['Track', 'Fill', 'Knob', 'Label'];
    case 'Button': return ['Background', 'Text'];
    case 'Switch': return ['Track', 'Knob', 'Label'];
    default:       return null;
  }
}

// Emit the body of `_DestroyUI` in static mode: disconnects every connection
// and Removes every Drawing object. Idempotent via `_Destroyed` guard.
function emitDestroyUIStatic(L, sorted, vn) {
  L.push('local function _DestroyUI(): ()');
  L.push('    if _Destroyed then return end');
  L.push('    _Destroyed = true');
  L.push('    for _, c in _Conns do c:Disconnect() end');
  L.push('    table.clear(_Conns)');
  for (const el of sorted) {
    const v      = vn(el);
    const fields = staticDrawingFields(el);
    if (fields === null) {
      L.push(`    if E.${v} then E.${v}:Remove() end`);
    } else {
      for (const f of fields) L.push(`    if E.${v}${f} then E.${v}${f}:Remove() end`);
    }
  }
  L.push('end');
}

// Emit `_DestroyUI` in immediate mode — no Drawings to Remove, just disconnect.
function emitDestroyUIImmediate(L) {
  L.push('local function _DestroyUI(): ()');
  L.push('    if _Destroyed then return end');
  L.push('    _Destroyed = true');
  L.push('    for _, c in _Conns do c:Disconnect() end');
  L.push('    table.clear(_Conns)');
  L.push('end');
}

function makeVn() {
  const used  = new Map();   // id   -> resolved var name
  const taken = new Set();   // resolved names already claimed
  return function vn(el) {
    if (used.has(el.id)) return used.get(el.id);
    let base = (el.name || el.type || '').replace(/[^a-zA-Z0-9]/g, ' ').trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(w => w[0].toUpperCase() + w.slice(1))
      .join('')
      .replace(/^(\d)/, '_$1');
    if (!base) base = el.type || 'Element';
    let name = base, i = 2;
    while (taken.has(name)) name = base + '_' + (i++);
    taken.add(name);
    used.set(el.id, name);
    return name;
  };
}

function genLua() {
  if ((S.drawingMode || 'static') === 'immediate') return genLuaImmediate();
  const vn         = makeVn();
  const L          = [];
  const sorted     = sortedEls();
  // Hot-path Color3 cache. Per-frame PreLocal paths (Button hover/toggle/tab-active
  // color selection) must read from cached module-scope Color3 locals instead of
  // inline `Color3.fromRGB(...)` constructors — each constructor call allocates a
  // fresh userdata, adding per-button-per-frame GC pressure.
  const hotColorCache = new Map();   // hex → local var name
  const hotColorLines = [];
  const hotColor = (hex) => {
    const key = (hex || '#ffffff').toLowerCase();
    if (!hotColorCache.has(key)) {
      const name = `_HC${hotColorCache.size}`;
      hotColorCache.set(key, name);
      const [r, g, b] = hexRGB(key);
      hotColorLines.push(`local ${name}: Color3 = Color3.fromRGB(${r}, ${g}, ${b})`);
    }
    return hotColorCache.get(key);
  };
  // Pre-seed the cache from every Button so that references further below
  // (inside the PreLocal block that's emitted near line 1670+) can resolve
  // the local name with no regard for emission order. The cache is emitted
  // once, immediately before the IIFE body begins.
  for (const el of sorted) {
    if (el.type === 'Button') {
      hotColor(el.color);
      hotColor(el.hoverColor || el.color);
      if (el.toggleMode) hotColor(el.activeColor || '#2a5ec4');
      hotColor(el.textColor || '#ffffff');
      if ((el.action || '').startsWith('switchTab:')) {
        hotColor(el.tabActiveColor || el.hoverColor || el.color);
        hotColor(el.tabActiveTextColor || el.textColor || '#ffffff');
      }
    } else if (el.type === 'Switch') {
      // Switch toggles between off/on track colors at click time — both
      // must resolve to cached module-scope Color3 locals so the toggle
      // path never allocates a Color3.
      hotColor(el.color);                       // off track
      hotColor(el.onColor || '#4d90ff');        // on track
    }
  }
  // "Center on viewport" setting: offset all position writes by _OFF at runtime
  const centerOn   = !!(typeof SETTINGS !== 'undefined' && SETTINGS.centerOnViewport);
  const designW    = (typeof CV !== 'undefined' && CV.width)  ? CV.width  : 1920;
  const designH    = (typeof CV !== 'undefined' && CV.height) ? CV.height : 1080;
  const v2p        = (x, y) => centerOn
    ? `_OFF + Vector2.new(${Math.round(x)}, ${Math.round(y)})`
    : v2(x, y);
  // Rotated squares render as a Polyline quad (no Position/Size), so they can't
  // be draggable — the drag hit-test reads .Position/.Size. Exclude them here.
  const hasDrag    = sorted.some(e => e.type === 'Square' && e.draggable && !e.rotation);
  const hasCB      = sorted.some(e => e.type === 'Checkbox');
  const hasKB      = sorted.some(e => e.type === 'Keybind');
  const hasDD      = sorted.some(e => e.type === 'Dropdown');
  const hasSL      = sorted.some(e => e.type === 'Slider');
  const hasBT      = sorted.some(e => e.type === 'Button');
  const hasSW      = sorted.some(e => e.type === 'Switch');
  const dynTextEls      = sorted.filter(e => e.type === 'Text' && e.dynamicSource && e.dynamicSource !== '');
  const hasDynText      = dynTextEls.length > 0;
  const needsTabNames   = dynTextEls.some(e => e.dynamicSource === 'tabName');
  const hasRuntimeText  = dynTextEls.some(e => e.dynamicSource === 'runtime');
  const needsInteractive = hasDrag || hasCB || hasKB || hasDD || hasSL || hasBT || hasSW;
  const needsInput      = needsInteractive || hasDynText;
  const draggables  = sorted.filter(e => e.type === 'Square' && e.draggable && !e.rotation);
  // DestroyUI: any Button/Keybind with action='DestroyUI' needs the connection
  // tracking infrastructure and a _DestroyUI() helper.
  const needsDestroy = sorted.some(e =>
    (e.type === 'Button' || e.type === 'Keybind') && e.action === 'DestroyUI'
  );
  // Connect-line wrappers — when DestroyUI is needed, every connection is pushed
  // into _Conns so it can be disconnected. Otherwise emit unwrapped (same as before).
  const connPre = needsDestroy ? '    table.insert(_Conns, ' : '    ';
  const connEnd = needsDestroy ? '    end))'                 : '    end)';

  // Tab helpers
  const multiTab      = S.tabs.length > 1;
  const tabIdx        = el => Math.max(1, S.tabs.findIndex(t => t.id === el.tabId) + 1 || 1);
  const hasSwitchTabAction = sorted.some(e =>
    (e.type === 'Button' || e.type === 'Keybind') &&
    (e.action || '').startsWith('switchTab:')
  );
  const needsSetTab   = multiTab;
  const hasToggleUI   = sorted.some(e => e.type === 'Keybind' && (e.action || 'CustomFunction') === 'ToggleUI');

  if (!sorted.length) {
    return [
      '--!strict',
      '--!optimize 2',
      '',
      'local RunService = game:GetService("RunService")',
      '',
      'local Camera: Camera        = workspace.CurrentCamera',
      'local ViewportSize: Vector2 = Camera.ViewportSize',
    ].join('\n');
  }

  // ── directives ──────────────────────────────────────────────
  L.push('--!strict');
  L.push('--!optimize 2');
  L.push('');

  // ── environment ─────────────────────────────────────────────
  L.push('local RunService = game:GetService("RunService")');
  if (needsInteractive) {
    L.push('local UserInputService = game:GetService("UserInputService")');
  }
  L.push('');

  // ── constants ───────────────────────────────────────────────
  L.push('local Camera: Camera        = workspace.CurrentCamera');
  L.push('local ViewportSize: Vector2 = Camera.ViewportSize');
  L.push('');
  // Cache hot fastcall-dispatched builtins as locals at module scope.
  // Localizing is the explicit guarantee against any global-table lookup per call.
  L.push('local MathFloor  = math.floor');
  if (hasSL) L.push('local MathClamp  = math.clamp');
  if (hasSL) L.push('local MathRound  = math.round');
  if (hasKB) L.push('local TableFind  = table.find');
  L.push('');

  // Emit hot-path Color3 cache (populated during codegen by Button hover/toggle
  // emission). Lives at module scope so the IIFE body can reference without any
  // per-frame construction.
  if (hotColorLines.length) {
    L.push('-- Cached Color3 constants for per-frame hover/toggle writes.');
    for (const line of hotColorLines) L.push(line);
    L.push('');
  }

  // ── IIFE wrapper: one function scope so locals count against it, not the chunk
  //    All Drawing objects and state go in table E — zero local registers per element
  L.push(';(function(): ()');
  L.push('');
  L.push('local E = {} -- holds all Drawing objects and widget state');
  if (needsDestroy) {
    L.push('');
    L.push('-- DestroyUI infrastructure: every connection is tracked so it can be');
    L.push('-- disconnected, and every Drawing object is :Remove()d when triggered.');
    L.push('local _Destroyed: boolean = false');
    L.push('local _Conns: {RBXScriptConnection} = table.create(4)');
  }
  if (hasDD || hasBT || hasSL || hasCB || hasKB || hasSW) {
    L.push('');
    L.push('-- Truncate a Drawing Text object so its rendered width fits maxW pixels.');
    L.push('-- Appends an ellipsis when trimming. Binary-search on TextBounds for O(log n)');
    L.push('-- property writes in the overflow path; zero-cost (one compare) when it fits.');
    L.push('local function _FitText(d: any, maxW: number)');
    L.push('    if d.TextBounds.X <= maxW then return end');
    L.push('    local full: string = d.Text');
    L.push('    local lo: number, hi: number = 0, #full');
    L.push('    while lo < hi do');
    L.push('        local mid: number = (lo + hi + 1) // 2');
    L.push('        d.Text = string.sub(full, 1, mid) .. "..."');
    L.push('        if d.TextBounds.X <= maxW then lo = mid else hi = mid - 1 end');
    L.push('    end');
    L.push('    d.Text = if lo == 0 then "..." else string.sub(full, 1, lo) .. "..."');
    L.push('end');
  }
  if (hasSL) {
    L.push('');
    L.push('-- Format a slider value for display: integers render bare, floats use %g to');
    L.push('-- trim trailing zeros (at most 6 significant digits).  Prevents rendering');
    L.push('-- floating-point noise like "44.24047862250109".');
    L.push('local function _FmtNum(v: number): string');
    L.push('    if v == MathFloor(v) then return tostring(MathFloor(v)) end');
    L.push('    return string.format("%g", v)');
    L.push('end');
  }
  if (centerOn) {
    L.push('');
    L.push('-- Center UI on viewport: shift every position by this offset');
    L.push(`local _VS: Vector2  = ViewportSize`);
    L.push(`local _OFF: Vector2 = Vector2.new(math.floor((_VS.X - ${designW}) / 2), math.floor((_VS.Y - ${designH}) / 2))`);
  }
  L.push('');

  // ── variables (table fields, not locals) ────────────────────
  for (const el of sorted) {
    const v = vn(el);
    switch (el.type) {
      case 'Checkbox':
        L.push(`E.${v}Background = Drawing.new("Square")`);
        L.push(`E.${v}Fill       = Drawing.new("Square")`);
        L.push(`E.${v}Label      = Drawing.new("Text")`);
        L.push(`E.${v}Checked    = ${!!el.defaultChecked}`);
        break;
      case 'Keybind': {
        const kbAct  = el.action || 'CustomFunction';
        const kbEvt  = kbAct === 'CustomFunction';
        L.push(`E.${v}Background  = Drawing.new("Square")`);
        L.push(`E.${v}Text        = Drawing.new("Text")`);
        L.push(`E.${v}Key         = "${el.defaultKey || 'Insert'}"`);
        L.push(`E.${v}Waiting     = false`);
        L.push(`E.${v}WaitReady   = false`);
        // DisplayText is the final label string ("[Key]" or "[...]"). Updated only
        // on state change (click-to-rebind / key-captured), never per frame. Dynamic
        // Text mirrors reuse this same string ref — zero extra allocation.
        L.push(`E.${v}DisplayText = "[${el.defaultKey || 'Insert'}]"`);
        if (kbEvt) L.push(`E.${v}Fired       = false`);
        break;
      }
      case 'Dropdown': {
        const opts      = (el.options || 'Option 1').split(',').map(o => o.trim());
        const defIdx    = Math.max(0, Math.min(opts.length - 1, el.defaultIndex || 0));
        const isDynDD   = !!(el.dynamicOptions && el.dynamicOptions.trim());
        const slotCount = isDynDD ? (el.maxOptions || 20) : opts.length;
        // autoSelectDefault only applies to static dropdowns — dynamic ones
        // build their options on the first PreLocal tick, so the static default
        // index isn't meaningful for them.
        const autoSel   = !!el.autoSelectDefault && !isDynDD;
        L.push(`E.${v}Background = Drawing.new("Square")`);
        L.push(`E.${v}Text       = Drawing.new("Text")`);
        L.push(`E.${v}Arrow      = Drawing.new("Text")`);
        L.push(`E.${v}Selected   = "${opts[defIdx]}"`);
        L.push(`E.${v}Options    = { ${opts.map(o => `"${o}"`).join(', ')} }`);
        L.push(`E.${v}Open       = false`);
        // When autoSelectDefault is on, Fired starts true with FiredIdx set to
        // the default. The first PostLocal tick consumes the flag and dispatches
        // the callback once with the default selection. Zero per-frame cost.
        L.push(`E.${v}Fired      = ${autoSel}`);
        L.push(`E.${v}FiredIdx   = ${autoSel ? defIdx + 1 : 0}`);
        if (isDynDD) L.push(`E.${v}SlotCount  = 0`);
        for (let i = 0; i < slotCount; i++) {
          L.push(`E.${v}OptionBackground${i} = Drawing.new("Square")`);
          L.push(`E.${v}OptionText${i}       = Drawing.new("Text")`);
        }
        // Build flat ref arrays so the per-frame loop can index via integer
        // (`E.<v>_OptBg[i]`) instead of rebuilding `"OptionBackground" .. i`
        // strings every slot every frame. Eliminates ~8 string allocations
        // per slot per frame for a dynamic dropdown.
        if (slotCount > 0) {
          const bgRefs = Array.from({ length: slotCount }, (_, i) => `E.${v}OptionBackground${i}`).join(', ');
          const txRefs = Array.from({ length: slotCount }, (_, i) => `E.${v}OptionText${i}`).join(', ');
          L.push(`E.${v}_OptBg     = { ${bgRefs} }`);
          L.push(`E.${v}_OptTx     = { ${txRefs} }`);
          if (isDynDD) {
            // Cache last string rendered per slot so per-frame label updates skip
            // `tostring()` + `_FitText` when the value hasn't changed.
            L.push(`E.${v}_OptPrev   = table.create(${slotCount}, "")`);
          }
        }
        break;
      }
      case 'Slider':
        L.push(`E.${v}Track    = Drawing.new("Square")`);
        L.push(`E.${v}Fill     = Drawing.new("Square")`);
        L.push(`E.${v}Knob     = Drawing.new("Square")`);
        L.push(`E.${v}Label    = Drawing.new("Text")`);
        L.push(`E.${v}Value    = ${el.curVal || 0}`);
        L.push(`E.${v}Dragging = false`);
        L.push(`E.${v}Fired    = false`);
        // Cache the last Value rendered into the label so per-frame render can
        // skip _FmtNum + string concat + _FitText when the value is unchanged.
        L.push(`E.${v}_LabelPrev = ${el.curVal || 0}`);
        break;
      case 'Button': {
        const btAct  = el.action || 'CustomFunction';
        const btEvt  = btAct === 'CustomFunction' && !el.toggleMode;
        L.push(`E.${v}Background = Drawing.new("Square")`);
        L.push(`E.${v}Text       = Drawing.new("Text")`);
        if (el.toggleMode) L.push(`E.${v}Toggled  = false`);
        if (btEvt)         L.push(`E.${v}Fired    = false`);
        break;
      }
      case 'Switch':
        L.push(`E.${v}Track   = Drawing.new("Square")`);
        L.push(`E.${v}Knob    = Drawing.new("Square")`);
        L.push(`E.${v}Label   = Drawing.new("Text")`);
        L.push(`E.${v}Enabled = ${!!el.defaultEnabled}`);
        break;
      default:
        // A rotated Square has no native rotation in Severe's Drawing API, so it's
        // rendered as a 4-corner Polyline (filled or outline) instead of a Square.
        L.push(`E.${v} = Drawing.new("${isRotatedSquare(el) ? 'Polyline' : el.type}")`);
    }
  }

  if (hasDrag) {
    L.push('');
    for (const el of draggables) {
      const v = vn(el);
      L.push(`E.${v}DragActive     = false`);
      L.push(`E.${v}DragStartMouse = Vector2.new(0, 0)`);
      L.push(`E.${v}DragStartPos   = Vector2.new(0, 0)`);
    }
  }
  L.push('');

  // ── shared upvalues needed before init block ─────────────────
  if (hasToggleUI) {
    L.push(`local UIVisible: boolean = true`);
    L.push('');
  }

  // ── multi-tab: ActiveTab + SetTab() ────────────────────────
  if (needsSetTab) {
    L.push(`local ActiveTab: number = 1`);
    L.push('');
    L.push(`local function SetTab(n: number): ()`);
    L.push(`    ActiveTab = n`);
    const uiPfx = hasToggleUI ? 'UIVisible and ' : '';
    for (let ti = 0; ti < S.tabs.length; ti++) {
      const tabId  = S.tabs[ti].id;
      const tabN   = ti + 1;
      // shared elements are never touched by SetTab
      const tabEls = sorted.filter(e => !e.shared && (e.tabId || S.tabs[0].id) === tabId);
      if (tabEls.length) {
        L.push(`    -- ${S.tabs[ti].name}`);
        for (const el of tabEls) {
          const v   = vn(el);
          const vis = !!el.visible;
          const g   = `${uiPfx}n == ${tabN}`;
          switch (el.type) {
            case 'Checkbox':
              L.push(`    E.${v}Background.Visible = ${g} and ${vis}`);
              L.push(`    E.${v}Label.Visible      = ${g} and ${vis}`);
              L.push(`    E.${v}Fill.Visible       = ${g} and E.${v}Checked`);
              break;
            case 'Keybind':
              L.push(`    E.${v}Background.Visible = ${g} and ${vis}`);
              L.push(`    E.${v}Text.Visible       = ${g} and ${vis}`);
              break;
            case 'Dropdown': {
              const opts      = (el.options || 'Option 1').split(',').map(o => o.trim());
              const isDynDD   = !!(el.dynamicOptions && el.dynamicOptions.trim());
              const slotCount = isDynDD ? (el.maxOptions || 20) : opts.length;
              L.push(`    E.${v}Background.Visible = ${g} and ${vis}`);
              L.push(`    E.${v}Text.Visible       = ${g} and ${vis}`);
              L.push(`    E.${v}Arrow.Visible      = ${g} and ${vis}`);
              for (let oi = 0; oi < slotCount; oi++) {
                L.push(`    E.${v}OptionBackground${oi}.Visible = ${g} and E.${v}Open`);
                L.push(`    E.${v}OptionText${oi}.Visible       = ${g} and E.${v}Open`);
              }
              break;
            }
            case 'Slider':
              L.push(`    E.${v}Track.Visible = ${g} and ${vis}`);
              L.push(`    E.${v}Fill.Visible  = ${g} and ${vis}`);
              L.push(`    E.${v}Knob.Visible  = ${g} and ${vis}`);
              L.push(`    E.${v}Label.Visible = ${g} and ${vis}`);
              break;
            case 'Button':
              L.push(`    E.${v}Background.Visible = ${g} and ${vis}`);
              L.push(`    E.${v}Text.Visible       = ${g} and ${vis}`);
              break;
            case 'Switch':
              L.push(`    E.${v}Track.Visible = ${g} and ${vis}`);
              L.push(`    E.${v}Knob.Visible  = ${g} and ${vis}`);
              L.push(`    E.${v}Label.Visible = ${g} and ${vis}`);
              break;
            default:
              L.push(`    E.${v}.Visible = ${g} and ${vis}`);
          }
        }
      }
    }
    L.push(`end`);
    L.push('');
  }

  // ── TabNames table (used by dynamic Text with source=tabName) ─
  if (needsTabNames) {
    const names = S.tabs.map(t => `"${t.name.replace(/"/g, '\\"')}"`).join(', ');
    L.push(`local TabNames: {string} = { ${names} }`);
    L.push('');
  }

  // ── init block ───────────────────────────────────────────────
  L.push('do');

  // A child sits just above its parent BY DEFAULT, but a child explicitly given a
  // LOWER zIndex than its parent is respected and drops behind it (e.g. z = -10000
  // sends a square to the back instead of being force-bumped to parent.z + 1, the
  // old bug). Mirrors sortedEls() so the canvas preview and the emitted .ZIndex agree.
  const _zCache = new Map();
  const resolvedZ = (e) => {
    if (_zCache.has(e.id)) return _zCache.get(e.id);
    const ez = e.zIndex || 0;
    if (!e.parentId) { _zCache.set(e.id, ez); return ez; }
    const par = S.els.find(x => x.id === e.parentId);
    if (!par) { _zCache.set(e.id, ez); return ez; }
    _zCache.set(e.id, ez);
    const z = (ez < (par.zIndex || 0)) ? ez : Math.max(ez, resolvedZ(par) + 1);
    _zCache.set(e.id, z);
    return z;
  };

  for (const el of sorted) {
    const v     = vn(el);
    const b     = bounds(el);
    const safeZ = resolvedZ(el);

    L.push('');

    switch (el.type) {

      case 'Square':
        if (isRotatedSquare(el)) {
          // Rendered as a closed 4-corner Polyline (Filled mirrors el.filled).
          // Rounding is dropped — Polyline has no corner radius.
          const c   = quadCorners(el, b);
          const pts = [...c, c[0]].map(p => v2p(p[0], p[1])).join(', ');
          L.push(`    E.${v}.Points    = { ${pts} }`);
          L.push(`    E.${v}.Color     = ${c3(el.color)}`);
          L.push(`    E.${v}.Opacity   = ${fn(el.opacity ?? 1)}`);
          L.push(`    E.${v}.Filled    = ${!!el.filled}`);
          L.push(`    E.${v}.Thickness = ${fn(el.thickness || 1)}`);
          L.push(`    E.${v}.ZIndex    = ${safeZ}`);
          L.push(`    E.${v}.Visible   = ${!!el.visible}`);
        } else {
          L.push(`    E.${v}.Position  = ${v2p(b.x, b.y)}`);
          L.push(`    E.${v}.Size      = ${v2(el.w, el.h)}`);
          L.push(`    E.${v}.Color     = ${c3(el.color)}`);
          L.push(`    E.${v}.Opacity   = ${fn(el.opacity ?? 1)}`);
          L.push(`    E.${v}.Filled    = ${!!el.filled}`);
          L.push(`    E.${v}.Thickness = ${fn(el.thickness || 1)}`);
          if (el.rounding) L.push(`    E.${v}.Rounding  = ${el.rounding}`);
          L.push(`    E.${v}.ZIndex    = ${safeZ}`);
          L.push(`    E.${v}.Visible   = ${!!el.visible}`);
        }
        break;

      case 'Circle':
        L.push(`    E.${v}.Position  = ${v2p(b.cx, b.cy)}`);
        L.push(`    E.${v}.Radius    = ${el.radius}`);
        L.push(`    E.${v}.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}.Opacity   = ${fn(el.opacity ?? 1)}`);
        L.push(`    E.${v}.Filled    = ${!!el.filled}`);
        L.push(`    E.${v}.Thickness = ${fn(el.thickness || 1)}`);
        L.push(`    E.${v}.NumSides  = ${el.numSides || 64}`);
        L.push(`    E.${v}.ZIndex    = ${safeZ}`);
        L.push(`    E.${v}.Visible   = ${!!el.visible}`);
        break;

      case 'Text': {
        const safeText = (el.text || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        L.push(`    E.${v}.Position     = ${v2p(b.wx || b.x, b.wy || b.y)}`);
        L.push(`    E.${v}.Text         = "${safeText}"`);
        L.push(`    E.${v}.Size         = ${el.size || 16}`);
        L.push(`    E.${v}.Font         = ${el.font || 0}`);
        L.push(`    E.${v}.Color        = ${c3(el.color)}`);
        L.push(`    E.${v}.Opacity      = ${fn(el.opacity ?? 1)}`);
        L.push(`    E.${v}.Center       = ${!!el.center}`);
        L.push(`    E.${v}.Outline      = ${!!el.outline}`);
        if (el.outline)
          L.push(`    E.${v}.OutlineColor = ${outlineV3(el.outlineColor || '#000000')}`);
        L.push(`    E.${v}.ZIndex       = ${safeZ}`);
        L.push(`    E.${v}.Visible      = ${!!el.visible}`);
        break;
      }

      case 'Triangle': {
        // triPoints returns the same 3 vertices as before when rotation == 0,
        // so unrotated triangles stay byte-identical.
        const tp = triPoints(el, b);
        L.push(`    E.${v}.PointA    = ${v2p(tp[0][0], tp[0][1])}`);
        L.push(`    E.${v}.PointB    = ${v2p(tp[1][0], tp[1][1])}`);
        L.push(`    E.${v}.PointC    = ${v2p(tp[2][0], tp[2][1])}`);
        L.push(`    E.${v}.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}.Opacity   = ${fn(el.opacity ?? 1)}`);
        L.push(`    E.${v}.Filled    = ${!!el.filled}`);
        L.push(`    E.${v}.Thickness = ${fn(el.thickness || 1)}`);
        L.push(`    E.${v}.ZIndex    = ${safeZ}`);
        L.push(`    E.${v}.Visible   = ${!!el.visible}`);
        break;
      }

      case 'Line':
        L.push(`    E.${v}.From      = ${v2p(b.wx1, b.wy1)}`);
        L.push(`    E.${v}.To        = ${v2p(b.wx2, b.wy2)}`);
        L.push(`    E.${v}.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}.Opacity   = ${fn(el.opacity ?? 1)}`);
        L.push(`    E.${v}.Thickness = ${fn(el.thickness || 1)}`);
        L.push(`    E.${v}.ZIndex    = ${safeZ}`);
        L.push(`    E.${v}.Visible   = ${!!el.visible}`);
        break;

      case 'Polyline':
        L.push(`    E.${v}.Points    = { ${v2p(b.wx1, b.wy1)}, ${v2p(b.wx2, b.wy2)} }`);
        L.push(`    E.${v}.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}.Opacity   = ${fn(el.opacity ?? 1)}`);
        L.push(`    E.${v}.Filled    = ${!!el.filled}`);
        L.push(`    E.${v}.Thickness = ${fn(el.thickness || 1)}`);
        L.push(`    E.${v}.ZIndex    = ${safeZ}`);
        L.push(`    E.${v}.Visible   = ${!!el.visible}`);
        break;

      case 'Image':
        L.push(`    E.${v}.Position = ${v2p(b.x, b.y)}`);
        L.push(`    E.${v}.Size     = ${v2(Math.round(el.w), Math.round(el.h))}`);
        if (el.url) L.push(`    E.${v}.Url      = "${el.url}"`);
        L.push(`    E.${v}.Opacity  = ${fn(el.opacity ?? 1)}`);
        if (el.rounding) L.push(`    E.${v}.Rounding = ${el.rounding}`);
        L.push(`    E.${v}.ZIndex   = ${safeZ}`);
        L.push(`    E.${v}.Visible  = ${!!el.visible}`);
        break;

      case 'Checkbox': {
        const z   = safeZ;
        const pad = 3;
        const lx  = Math.round(b.x + el.w + 6);
        const ly  = Math.round(b.y + el.h/2 - (el.textSize || 16)/2);
        const lbl = (el.label || 'Checkbox').replace(/"/g, '\\"');

        L.push(`    E.${v}Background.Position  = ${v2p(b.x, b.y)}`);
        L.push(`    E.${v}Background.Size      = ${v2(el.w, el.h)}`);
        L.push(`    E.${v}Background.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}Background.Filled    = true`);
        L.push(`    E.${v}Background.Thickness = ${fn(el.outlineThickness || 1)}`);
        if (el.rounding) L.push(`    E.${v}Background.Rounding  = ${el.rounding}`);
        L.push(`    E.${v}Background.ZIndex    = ${z}`);
        L.push(`    E.${v}Background.Visible   = ${!!el.visible}`);
        L.push('');
        L.push(`    E.${v}Fill.Position  = ${v2p(b.x + pad, b.y + pad)}`);
        L.push(`    E.${v}Fill.Size      = ${v2(el.w - pad*2, el.h - pad*2)}`);
        L.push(`    E.${v}Fill.Color     = ${c3(el.checkedColor || '#00ff00')}`);
        L.push(`    E.${v}Fill.Filled    = true`);
        if (el.rounding) L.push(`    E.${v}Fill.Rounding  = ${Math.max(0, el.rounding - 1)}`);
        L.push(`    E.${v}Fill.ZIndex    = ${z + 1}`);
        L.push(`    E.${v}Fill.Visible   = ${!!(el.defaultChecked && el.visible)}`);
        L.push('');
        L.push(`    E.${v}Label.Position     = ${v2p(lx, ly)}`);
        L.push(`    E.${v}Label.Text         = "${lbl}"`);
        L.push(`    E.${v}Label.Size         = ${el.textSize || 16}`);
        L.push(`    E.${v}Label.Font         = ${el.font || 0}`);
        L.push(`    E.${v}Label.Color        = ${c3(el.textColor || '#ffffff')}`);
        L.push(`    E.${v}Label.Outline      = ${!!el.textOutline}`);
        if (el.textOutline)
          L.push(`    E.${v}Label.OutlineColor = ${outlineV3('#000000')}`);
        L.push(`    E.${v}Label.ZIndex       = ${z + 1}`);
        L.push(`    E.${v}Label.Visible      = ${!!el.visible}`);
        break;
      }

      case 'Keybind': {
        const z  = safeZ;
        const tx = Math.round(b.x + el.w/2);
        const ty = Math.round(b.y + el.h/2 - (el.textSize || 16)/2);

        L.push(`    E.${v}Background.Position  = ${v2p(b.x, b.y)}`);
        L.push(`    E.${v}Background.Size      = ${v2(el.w, el.h)}`);
        L.push(`    E.${v}Background.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}Background.Filled    = ${!!el.filled}`);
        L.push(`    E.${v}Background.Thickness = 1`);
        if (el.rounding) L.push(`    E.${v}Background.Rounding  = ${el.rounding}`);
        L.push(`    E.${v}Background.ZIndex    = ${z}`);
        L.push(`    E.${v}Background.Visible   = ${!!el.visible}`);
        L.push('');
        L.push(`    E.${v}Text.Position     = ${v2p(tx, ty)}`);
        L.push(`    E.${v}Text.Text         = E.${v}DisplayText`);
        L.push(`    E.${v}Text.Size         = ${el.textSize || 16}`);
        L.push(`    E.${v}Text.Font         = ${el.font || 0}`);
        L.push(`    E.${v}Text.Color        = ${c3(el.textColor || '#000000')}`);
        L.push(`    E.${v}Text.Center       = true`);
        L.push(`    E.${v}Text.Outline      = ${!!el.textOutline}`);
        if (el.textOutline)
          L.push(`    E.${v}Text.OutlineColor = ${outlineV3('#000000')}`);
        L.push(`    E.${v}Text.ZIndex       = ${z + 1}`);
        L.push(`    E.${v}Text.Visible      = ${!!el.visible}`);
        break;
      }

      case 'Dropdown': {
        const z    = safeZ;
        const opts = (el.options || 'Option 1').split(',').map(o => o.trim());
        const dtx  = Math.round(b.x + 8);
        const dty  = Math.round(b.y + el.h/2 - (el.textSize || 16)/2);
        const atx  = Math.round(b.x + el.w - 16);

        L.push(`    E.${v}Background.Position  = ${v2p(b.x, b.y)}`);
        L.push(`    E.${v}Background.Size      = ${v2(el.w, el.h)}`);
        L.push(`    E.${v}Background.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}Background.Filled    = ${!!el.filled}`);
        L.push(`    E.${v}Background.Thickness = ${fn(el.thickness || 1)}`);
        if (el.rounding) L.push(`    E.${v}Background.Rounding  = ${el.rounding}`);
        L.push(`    E.${v}Background.ZIndex    = ${z}`);
        L.push(`    E.${v}Background.Visible   = ${!!el.visible}`);
        L.push('');
        L.push(`    E.${v}Text.Position  = ${v2p(dtx, dty)}`);
        L.push(`    E.${v}Text.Text      = E.${v}Selected`);
        L.push(`    E.${v}Text.Size      = ${el.textSize || 16}`);
        L.push(`    E.${v}Text.Font      = ${el.font || 0}`);
        L.push(`    E.${v}Text.Color     = ${c3(el.textColor || '#000000')}`);
        L.push(`    E.${v}Text.Outline   = ${!!el.textOutline}`);
        if (el.textOutline)
          L.push(`    E.${v}Text.OutlineColor = ${outlineV3('#000000')}`);
        L.push(`    E.${v}Text.ZIndex    = ${z + 1}`);
        L.push(`    E.${v}Text.Visible   = ${!!el.visible}`);
        L.push(`    _FitText(E.${v}Text, ${Math.max(1, el.w - 28)})`);
        L.push('');
        L.push(`    E.${v}Arrow.Position = ${v2p(atx, dty)}`);
        L.push(`    E.${v}Arrow.Text     = "\u25bc"`);
        L.push(`    E.${v}Arrow.Size     = ${Math.max(10, (el.textSize || 16) - 4)}`);
        L.push(`    E.${v}Arrow.Font     = ${el.font || 0}`);
        L.push(`    E.${v}Arrow.Color    = ${c3(el.textColor || '#000000')}`);
        L.push(`    E.${v}Arrow.ZIndex   = ${z + 1}`);
        L.push(`    E.${v}Arrow.Visible  = ${!!el.visible}`);

        const isDynDD3   = !!(el.dynamicOptions && el.dynamicOptions.trim());
        const slotCount3 = isDynDD3 ? (el.maxOptions || 20) : opts.length;
        for (let i = 0; i < slotCount3; i++) {
          const ory = Math.round(b.y + el.h * (i + 1));
          const oty = Math.round(b.y + el.h * (i + 1) + el.h/2 - (el.textSize || 16)/2);
          L.push('');
          L.push(`    E.${v}OptionBackground${i}.Position  = ${v2p(b.x, ory)}`);
          L.push(`    E.${v}OptionBackground${i}.Size      = ${v2(el.w, el.h)}`);
          L.push(`    E.${v}OptionBackground${i}.Color     = ${c3(el.color)}`);
          L.push(`    E.${v}OptionBackground${i}.Filled    = true`);
          if (el.rounding) L.push(`    E.${v}OptionBackground${i}.Rounding  = ${el.rounding}`);
          L.push(`    E.${v}OptionBackground${i}.ZIndex    = ${z + 2}`);
          L.push(`    E.${v}OptionBackground${i}.Visible   = false`);
          L.push('');
          L.push(`    E.${v}OptionText${i}.Position  = ${v2p(Math.round(b.x + 8), oty)}`);
          L.push(`    E.${v}OptionText${i}.Text      = "${isDynDD3 ? '' : opts[i] || ''}"`);
          L.push(`    E.${v}OptionText${i}.Size      = ${el.textSize || 16}`);
          L.push(`    E.${v}OptionText${i}.Font      = ${el.font || 0}`);
          L.push(`    E.${v}OptionText${i}.Color     = ${c3(el.textColor || '#000000')}`);
          L.push(`    E.${v}OptionText${i}.ZIndex    = ${z + 3}`);
          L.push(`    E.${v}OptionText${i}.Visible   = false`);
          if (!isDynDD3) L.push(`    _FitText(E.${v}OptionText${i}, ${Math.max(1, el.w - 16)})`);
        }
        break;
      }

      case 'Slider': {
        const z   = safeZ;
        const pct = ((el.curVal || 0) - (el.minVal || 0)) / Math.max(1, (el.maxVal || 100) - (el.minVal || 0));
        const fw  = Math.max(0, el.w * pct);

        L.push(`    E.${v}Track.Position  = ${v2p(b.x, b.y)}`);
        L.push(`    E.${v}Track.Size      = ${v2(el.w, el.h)}`);
        L.push(`    E.${v}Track.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}Track.Opacity   = ${fn((el.opacity ?? 1) * 0.3)}`);
        L.push(`    E.${v}Track.Filled    = ${!!el.filled}`);
        if (el.rounding) L.push(`    E.${v}Track.Rounding  = ${el.rounding}`);
        L.push(`    E.${v}Track.ZIndex    = ${z}`);
        L.push(`    E.${v}Track.Visible   = ${!!el.visible}`);
        L.push('');
        L.push(`    E.${v}Fill.Position   = ${v2p(b.x, b.y)}`);
        L.push(`    E.${v}Fill.Size       = ${v2(Math.round(fw), el.h)}`);
        L.push(`    E.${v}Fill.Color      = ${c3(el.color)}`);
        L.push(`    E.${v}Fill.Filled     = true`);
        if (el.rounding) L.push(`    E.${v}Fill.Rounding   = ${el.rounding}`);
        L.push(`    E.${v}Fill.ZIndex     = ${z + 1}`);
        L.push(`    E.${v}Fill.Visible    = ${!!el.visible}`);
        L.push('');
        L.push(`    E.${v}Knob.Position   = ${v2p(Math.round(b.x + fw - 5), b.y - 2)}`);
        L.push(`    E.${v}Knob.Size       = ${v2(10, el.h + 4)}`);
        L.push(`    E.${v}Knob.Color      = ${c3(el.knobColor || '#ffffff')}`);
        L.push(`    E.${v}Knob.Filled     = true`);
        L.push(`    E.${v}Knob.Rounding   = 2`);
        L.push(`    E.${v}Knob.ZIndex     = ${z + 2}`);
        L.push(`    E.${v}Knob.Visible    = ${!!el.visible}`);
        L.push('');
        L.push(`    E.${v}Label.Position  = ${v2p(Math.round(b.x + el.w/2), b.y - 16)}`);
        L.push(`    E.${v}Label.Text      = _FmtNum(E.${v}Value) .. "${el.suffix || ''}"`);
        L.push(`    E.${v}Label.Size      = 11`);
        L.push(`    E.${v}Label.Font      = 0`);
        L.push(`    E.${v}Label.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}Label.Center    = true`);
        L.push(`    E.${v}Label.ZIndex    = ${z + 2}`);
        L.push(`    E.${v}Label.Visible   = ${!!el.visible}`);
        L.push(`    _FitText(E.${v}Label, ${Math.max(1, el.w)})`);
        break;
      }

      case 'Button': {
        const z   = safeZ;
        const btx = Math.round(b.x + el.w/2);
        const bty = Math.round(b.y + el.h/2 - (el.textSize || 16)/2);
        const lbl = (el.label || 'Button').replace(/"/g, '\\"');

        L.push(`    E.${v}Background.Position  = ${v2p(b.x, b.y)}`);
        L.push(`    E.${v}Background.Size      = ${v2(el.w, el.h)}`);
        L.push(`    E.${v}Background.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}Background.Filled    = ${!!el.filled}`);
        L.push(`    E.${v}Background.Thickness = ${fn(el.thickness || 1)}`);
        if (el.rounding) L.push(`    E.${v}Background.Rounding  = ${el.rounding}`);
        L.push(`    E.${v}Background.ZIndex    = ${z}`);
        L.push(`    E.${v}Background.Visible   = ${!!el.visible}`);
        L.push('');
        L.push(`    E.${v}Text.Position     = ${v2p(btx, bty)}`);
        L.push(`    E.${v}Text.Text         = "${lbl}"`);
        L.push(`    E.${v}Text.Size         = ${el.textSize || 16}`);
        L.push(`    E.${v}Text.Font         = ${el.font || 0}`);
        L.push(`    E.${v}Text.Color        = ${c3(el.textColor || '#ffffff')}`);
        L.push(`    E.${v}Text.Center       = true`);
        L.push(`    E.${v}Text.Outline      = ${!!el.textOutline}`);
        if (el.textOutline)
          L.push(`    E.${v}Text.OutlineColor = ${outlineV3('#000000')}`);
        L.push(`    E.${v}Text.ZIndex       = ${z + 1}`);
        L.push(`    E.${v}Text.Visible      = ${!!el.visible}`);
        L.push(`    _FitText(E.${v}Text, ${Math.max(1, el.w - 8)})`);
        break;
      }

      case 'Switch': {
        const z         = safeZ;
        const knobSize  = el.h - 4;
        const knobOffX  = Math.round(b.x + 2);
        const knobOnX   = Math.round(b.x + el.w - knobSize - 2);
        const knobY     = Math.round(b.y + 2);
        const lx        = Math.round(b.x + el.w + 8);
        const ly        = Math.round(b.y + el.h/2 - (el.textSize || 16)/2);
        const lbl       = (el.label || 'Switch').replace(/"/g, '\\"');
        const rnd       = el.rounding != null ? el.rounding : Math.floor(el.h / 2);
        const initColor = el.defaultEnabled ? c3(el.onColor || '#4d90ff') : c3(el.color);
        const initKnobX = el.defaultEnabled ? knobOnX : knobOffX;

        L.push(`    E.${v}Track.Position  = ${v2p(b.x, b.y)}`);
        L.push(`    E.${v}Track.Size      = ${v2(el.w, el.h)}`);
        L.push(`    E.${v}Track.Color     = ${initColor}`);
        L.push(`    E.${v}Track.Filled    = true`);
        L.push(`    E.${v}Track.Thickness = 1`);
        L.push(`    E.${v}Track.Rounding  = ${rnd}`);
        L.push(`    E.${v}Track.ZIndex    = ${z}`);
        L.push(`    E.${v}Track.Visible   = ${!!el.visible}`);
        L.push('');
        L.push(`    E.${v}Knob.Position  = ${v2p(initKnobX, knobY)}`);
        L.push(`    E.${v}Knob.Size      = ${v2(knobSize, knobSize)}`);
        L.push(`    E.${v}Knob.Color     = ${c3(el.knobColor || '#ffffff')}`);
        L.push(`    E.${v}Knob.Filled    = true`);
        L.push(`    E.${v}Knob.Rounding  = ${Math.floor(knobSize / 2)}`);
        L.push(`    E.${v}Knob.ZIndex    = ${z + 1}`);
        L.push(`    E.${v}Knob.Visible   = ${!!el.visible}`);
        L.push('');
        L.push(`    E.${v}Label.Position     = ${v2p(lx, ly)}`);
        L.push(`    E.${v}Label.Text         = "${lbl}"`);
        L.push(`    E.${v}Label.Size         = ${el.textSize || 16}`);
        L.push(`    E.${v}Label.Font         = ${el.font || 0}`);
        L.push(`    E.${v}Label.Color        = ${c3(el.textColor || '#ffffff')}`);
        L.push(`    E.${v}Label.Outline      = ${!!el.textOutline}`);
        if (el.textOutline)
          L.push(`    E.${v}Label.OutlineColor = ${outlineV3('#000000')}`);
        L.push(`    E.${v}Label.ZIndex       = ${z + 1}`);
        L.push(`    E.${v}Label.Visible      = ${!!el.visible}`);
        break;
      }
    }

    // Apply opacity to compound widgets (plain shapes already set it inline above).
    // Hit-testing uses Position/Size, never opacity — so an opacity-0 widget is
    // fully invisible yet still clickable: the clean way to make an invisible
    // hotspot, instead of visible=false (which can't be interacted with).
    const _opFields = staticDrawingFields(el);
    if (_opFields && (el.opacity ?? 1) !== 1) {
      for (const _f of _opFields) L.push(`    E.${v}${_f}.Opacity = ${fn(el.opacity)}`);
    }
  }

  // Dynamic text: init caches and one-shot constants so the per-frame loop
  // can skip all work when the value hasn't changed.
  if (dynTextEls && dynTextEls.length) {
    L.push('');
    let wrotePlayerName = false;
    for (const el of dynTextEls) {
      const v   = vn(el);
      const src = el.dynamicSource || '';
      if (src === 'playerName') {
        // Session-constant: write once here, never re-read per frame.
        if (!wrotePlayerName) {
          L.push(`    local _PlayerName: string = game.Players.LocalPlayer.Name`);
          wrotePlayerName = true;
        }
        L.push(`    E.${v}.Text = _PlayerName`);
      } else if (src === 'tabName') {
        // Start at a sentinel so the first PreLocal tick always writes.
        L.push(`    E.${v}_Prev = -1`);
      } else if (src === 'clock' || src === 'runtime') {
        L.push(`    E.${v}_Prev = -1`);
      } else if (src === 'custom' && (el.dynamicExpr || '').trim()) {
        L.push(`    E.${v}_Prev = ""`);
      }
      // keybind: source reads E.<kv>DisplayText directly (no prev-cache needed).
    }
  }

  if (needsSetTab) L.push('    SetTab(1)');
  L.push('end');

  // ── PreLocal / PostLocal / Render ───────────────────────────
  // Helper: emit dynamic-text assignments (used in PreLocal so memory reads run every game tick)
  //
  // Every source is guarded so the hot path does NOT rebuild strings or even
  // touch the Drawing.Text property when the underlying value is unchanged:
  //   - playerName : constant per session → written once at init, skipped here
  //   - tabName    : only writes when ActiveTab changes (stored in E.<v>_Prev)
  //   - clock      : rebuilds os.date() only when the wall-clock second changes
  //   - runtime    : rebuilds string.format only when elapsed-second changes
  //   - custom     : tostring() result compared to cached; skip write if equal
  //   - keybind:id : reads cached DisplayText ref (updated event-driven above)
  const emitDynTextLines = (indent) => {
    for (const el of dynTextEls) {
      const v   = vn(el);
      const src = el.dynamicSource || '';
      if (src.startsWith('keybind:')) {
        const kbEl = sorted.find(e => e.id === src.slice('keybind:'.length));
        if (kbEl) {
          const kv = vn(kbEl);
          // Property set of the cached string ref; no concat, no format.
          L.push(`${indent}E.${v}.Text = E.${kv}DisplayText`);
        }
      } else if (src === 'playerName') {
        // Handled once in init — nothing to do per frame.
      } else if (src === 'tabName') {
        L.push(`${indent}if ActiveTab ~= E.${v}_Prev then`);
        L.push(`${indent}    E.${v}.Text   = TabNames[ActiveTab] or ""`);
        L.push(`${indent}    E.${v}_Prev   = ActiveTab`);
        L.push(`${indent}end`);
      } else if (src === 'clock') {
        // Only call os.date (allocates) when the whole-second boundary flips.
        L.push(`${indent}do`);
        L.push(`${indent}    local _sec: number = os.time()`);
        L.push(`${indent}    if _sec ~= E.${v}_Prev then`);
        L.push(`${indent}        E.${v}.Text = os.date("%H:%M:%S")`);
        L.push(`${indent}        E.${v}_Prev = _sec`);
        L.push(`${indent}    end`);
        L.push(`${indent}end`);
      } else if (src === 'runtime') {
        L.push(`${indent}do`);
        L.push(`${indent}    if _T0 == 0 then _T0 = tick() end`);
        L.push(`${indent}    local _sec: number = MathFloor(tick() - _T0)`);
        L.push(`${indent}    if _sec ~= E.${v}_Prev then`);
        L.push(`${indent}        E.${v}.Text = string.format("%02d:%02d", _sec // 60, _sec % 60)`);
        L.push(`${indent}        E.${v}_Prev = _sec`);
        L.push(`${indent}    end`);
        L.push(`${indent}end`);
      } else if (src === 'custom' && (el.dynamicExpr || '').trim()) {
        // tostring returns the same ref for string values (zero alloc) and only
        // allocates for non-strings. Skip the property write when unchanged.
        L.push(`${indent}do`);
        L.push(`${indent}    local _val: string = tostring(${el.dynamicExpr.trim()})`);
        L.push(`${indent}    if _val ~= E.${v}_Prev then`);
        L.push(`${indent}        E.${v}.Text = _val`);
        L.push(`${indent}        E.${v}_Prev = _val`);
        L.push(`${indent}    end`);
        L.push(`${indent}end`);
      }
    }
  };

  if (needsInput) {
    const needsMouse    = hasBT || hasDrag || hasSwitchTabAction;

    L.push('');
    L.push('do');
    if (hasRuntimeText) L.push('    local _T0: number = 0 -- set on first PreLocal tick');
    if (needsInteractive) {
      L.push('    local PrevLeftPressed: boolean = false');
      if (hasKB) L.push('    local PrevKeys: {string} = {}');
      L.push('');
    }

    // ── _DestroyUI helper (defined BEFORE connects so they can close over it) ──
    if (needsDestroy) {
      emitDestroyUIStatic(L, sorted, vn);
      L.push('');
    }

    // ── callback stubs + PreLocal + PostLocal (interactive elements only) ──
    if (needsInteractive) {
    // ── callback stubs (inside runtime do-block to stay under 200-local limit) ──
    for (const el of sorted.filter(e => UI_TYPES.has(e.type))) {
      const elAct = el.action || 'CustomFunction';
      if (el.type === 'Keybind' && (
            elAct === 'ToggleUI' ||
            elAct === 'DestroyUI' ||
            elAct.startsWith('switchTab:') ||
            elAct.startsWith('toggleTarget:')
          )) continue;
      if (el.type === 'Button'  && (
            elAct === 'DestroyUI' ||
            elAct.startsWith('switchTab:')
          )) continue;
      const fnName = `On${vn(el)}${el.callback}`;
      let sig = '';
      if (el.type === 'Checkbox') sig = 'state: boolean';
      if (el.type === 'Keybind')  sig = 'key: string';
      if (el.type === 'Dropdown') sig = 'selected: string, index: number';
      if (el.type === 'Slider')   sig = 'value: number';
      if (el.type === 'Button')   sig = el.toggleMode ? 'state: boolean' : '';
      if (el.type === 'Switch')   sig = 'state: boolean';
      L.push(`    local function ${fnName}(${sig}): ()`);
      // Checkbox, Switch, and toggle-Button bodies run every frame in PostLocal — stub stays empty
      const bodyInPostLocal = el.type === 'Checkbox'
                          || el.type === 'Switch'
                          || (el.type === 'Button' && el.toggleMode);
      const body = bodyInPostLocal ? '' : (el.callbackBody || '').trimEnd();
      if (body.trim()) {
        for (const line of body.split('\n')) L.push(`        ${line}`);
      } else {
        L.push(`        `);
      }
      L.push(`    end`);
      L.push('');
    }

    // ── PreLocal: input + state only ─────────────────────────
    L.push(`${connPre}RunService.PreLocal:Connect(function()`);
    L.push('        if not isrbxactive() then return end  -- skip input when Roblox unfocused');
    L.push('        local Mouse: Vector2       = UserInputService:GetMouseLocation()');
    L.push('        local LeftPressed: boolean = isleftpressed()');
    L.push('        local LeftClicked: boolean = LeftPressed and not PrevLeftPressed');
    if (hasKB) L.push('        local Keys: {string}      = getpressedkeys()');
    L.push('');

    for (const el of sorted.filter(e => e.type === 'Checkbox')) {
      const v = vn(el);
      const tg = (multiTab && !el.shared) ? `ActiveTab == ${tabIdx(el)} and ` : '';
      L.push(`        if ${tg}LeftClicked then`);
      L.push(`            local Pos  = E.${v}Background.Position`);
      L.push(`            local Size = E.${v}Background.Size`);
      L.push(`            if Mouse.X >= Pos.X and Mouse.X <= Pos.X + Size.X`);
      L.push(`            and Mouse.Y >= Pos.Y and Mouse.Y <= Pos.Y + Size.Y then`);
      L.push(`                E.${v}Checked = not E.${v}Checked`);
      if (el.exclusiveGroup) {
        const peers = sorted.filter(e => e.type === 'Checkbox' && e.id !== el.id && e.exclusiveGroup === el.exclusiveGroup);
        if (peers.length) {
          L.push(`                if E.${v}Checked then`);
          for (const peer of peers) {
            const pv = vn(peer);
            // Peer's body (if any) will run in the PostLocal poll next frame via the
            // updated E.<peer>Checked state — no explicit dispatch needed here.
            L.push(`                    E.${pv}Checked = false`);
          }
          L.push(`                end`);
        }
      }
      // Body (if set) runs in PostLocal every frame while E.<v>Checked — no dispatch needed.
      L.push(`            end`);
      L.push(`        end`);
      L.push('');
    }

    // ── Switch click handlers ──
    // Toggling a switch updates state AND writes the new Track.Color + Knob.Position
    // inline so no per-frame property writes are needed. Colors come from the
    // module-scope hot Color3 cache so there's zero per-click allocation. Knob
    // positions are pre-computed at codegen time and emitted as inline Vector2.new
    // calls (called rarely — only on toggle).
    for (const el of sorted.filter(e => e.type === 'Switch')) {
      const v        = vn(el);
      const tg       = (multiTab && !el.shared) ? `ActiveTab == ${tabIdx(el)} and ` : '';
      const cOn      = hotColor(el.onColor || '#4d90ff');
      const cOff     = hotColor(el.color);
      const knobSize = el.h - 4;
      // Knob positions are written RELATIVE to the live Track.Position so they stay
      // correct after the parent window is dragged or when centerOnViewport shifts
      // everything. onX is the slid-right offset within the track; 2 is the inset.
      const onOff    = el.w - knobSize - 2;
      L.push(`        if ${tg}LeftClicked then`);
      L.push(`            local Pos  = E.${v}Track.Position`);
      L.push(`            local Size = E.${v}Track.Size`);
      L.push(`            if Mouse.X >= Pos.X and Mouse.X <= Pos.X + Size.X`);
      L.push(`            and Mouse.Y >= Pos.Y and Mouse.Y <= Pos.Y + Size.Y then`);
      L.push(`                E.${v}Enabled = not E.${v}Enabled`);
      if (el.exclusiveGroup) {
        const peers = sorted.filter(e => e.type === 'Switch' && e.id !== el.id && e.exclusiveGroup === el.exclusiveGroup);
        if (peers.length) {
          L.push(`                if E.${v}Enabled then`);
          for (const peer of peers) {
            const pv   = vn(peer);
            const pOff = hotColor(peer.color);
            L.push(`                    E.${pv}Enabled        = false`);
            L.push(`                    E.${pv}Track.Color    = ${pOff}`);
            L.push(`                    E.${pv}Knob.Position  = E.${pv}Track.Position + Vector2.new(2, 2)`);
          }
          L.push(`                end`);
        }
      }
      // Inline visual update — slide the knob relative to the current track position.
      L.push(`                if E.${v}Enabled then`);
      L.push(`                    E.${v}Track.Color   = ${cOn}`);
      L.push(`                    E.${v}Knob.Position = Pos + Vector2.new(${onOff}, 2)`);
      L.push(`                else`);
      L.push(`                    E.${v}Track.Color   = ${cOff}`);
      L.push(`                    E.${v}Knob.Position = Pos + Vector2.new(2, 2)`);
      L.push(`                end`);
      L.push(`            end`);
      L.push(`        end`);
      L.push('');
    }

    // helper: emit static visibility setters for all elements (used by ToggleUI keybinds)
    const emitStaticVis = (indent) => {
      const p = ' '.repeat(indent);
      for (const se of sorted) {
        const sv  = vn(se);
        const vis = !!se.visible;
        switch (se.type) {
          case 'Checkbox':
            L.push(`${p}E.${sv}Background.Visible = UIVisible and ${vis}`);
            L.push(`${p}E.${sv}Label.Visible      = UIVisible and ${vis}`);
            break; // Fill is dynamic — handled by Render
          case 'Keybind':
            L.push(`${p}E.${sv}Background.Visible = UIVisible and ${vis}`);
            L.push(`${p}E.${sv}Text.Visible       = UIVisible and ${vis}`);
            break;
          case 'Dropdown':
            L.push(`${p}E.${sv}Background.Visible = UIVisible and ${vis}`);
            L.push(`${p}E.${sv}Text.Visible       = UIVisible and ${vis}`);
            L.push(`${p}E.${sv}Arrow.Visible      = UIVisible and ${vis}`);
            break; // Options are dynamic — handled by Render
          case 'Slider':
            L.push(`${p}E.${sv}Track.Visible = UIVisible and ${vis}`);
            L.push(`${p}E.${sv}Fill.Visible  = UIVisible and ${vis}`);
            L.push(`${p}E.${sv}Knob.Visible  = UIVisible and ${vis}`);
            L.push(`${p}E.${sv}Label.Visible = UIVisible and ${vis}`);
            break;
          case 'Button':
            L.push(`${p}E.${sv}Background.Visible = UIVisible and ${vis}`);
            L.push(`${p}E.${sv}Text.Visible       = UIVisible and ${vis}`);
            break;
          case 'Switch':
            L.push(`${p}E.${sv}Track.Visible = UIVisible and ${vis}`);
            L.push(`${p}E.${sv}Knob.Visible  = UIVisible and ${vis}`);
            L.push(`${p}E.${sv}Label.Visible = UIVisible and ${vis}`);
            break;
          default:
            L.push(`${p}E.${sv}.Visible = UIVisible and ${vis}`);
        }
      }
    };

    for (const el of sorted.filter(e => e.type === 'Keybind')) {
      const v            = vn(el);
      const kbAct        = el.action || 'CustomFunction';
      const isTogUI      = kbAct === 'ToggleUI';
      const isDestroyUI  = kbAct === 'DestroyUI';
      const isKbSwTab    = kbAct.startsWith('switchTab:');
      const isToggleTgt  = kbAct.startsWith('toggleTarget:');
      const tgtId        = isToggleTgt ? kbAct.slice('toggleTarget:'.length) : null;
      const tgt          = tgtId ? sorted.find(e => e.id === tgtId) : null;
      const kbSwTabIdx   = isKbSwTab
        ? S.tabs.findIndex(t => t.id === kbAct.slice('switchTab:'.length)) + 1
        : 0;
      // ToggleUI, DestroyUI, switchTab, and toggleTarget keybinds fire from any tab; CustomFunction ones only on their tab
      const tg = (multiTab && !el.shared && !isTogUI && !isDestroyUI && !isKbSwTab && !isToggleTgt) ? `ActiveTab == ${tabIdx(el)} and ` : '';
      const clickTg = (multiTab && !el.shared) ? `ActiveTab == ${tabIdx(el)} and ` : '';
      L.push(`        if E.${v}Waiting then`);
      L.push(`            if E.${v}WaitReady then`);
      L.push(`                local Pressed: {string} = getpressedkeys()`);
      L.push(`                if #Pressed > 0 then`);
      L.push(`                    E.${v}Key         = Pressed[1]`);
      L.push(`                    E.${v}Waiting     = false`);
      L.push(`                    E.${v}WaitReady   = false`);
      // Rebuild DisplayText once on capture — this is the only allocation site.
      L.push(`                    E.${v}DisplayText = "[" .. Pressed[1] .. "]"`);
      L.push(`                    E.${v}Text.Text   = E.${v}DisplayText`);
      // Key-capture fires CustomFunction once: flag, dispatch runs in PostLocal.
      if (!isTogUI && !isDestroyUI && !isKbSwTab && !isToggleTgt) L.push(`                    E.${v}Fired       = true`);
      L.push(`                end`);
      L.push(`            elseif not LeftPressed then`);
      L.push(`                E.${v}WaitReady = true`);
      L.push(`            end`);
      L.push(`        else`);
      L.push(`            if ${clickTg}LeftClicked then`);
      L.push(`                local Pos  = E.${v}Background.Position`);
      L.push(`                local Size = E.${v}Background.Size`);
      L.push(`                if Mouse.X >= Pos.X and Mouse.X <= Pos.X + Size.X`);
      L.push(`                and Mouse.Y >= Pos.Y and Mouse.Y <= Pos.Y + Size.Y then`);
      L.push(`                    E.${v}Waiting     = true`);
      L.push(`                    E.${v}WaitReady   = false`);
      // Switch to "[...]" placeholder — reuses an interned literal, no per-frame concat.
      L.push(`                    E.${v}DisplayText = "[...]"`);
      L.push(`                    E.${v}Text.Text   = E.${v}DisplayText`);
      L.push(`                end`);
      L.push(`            end`);
      // Skip emitting the key-press dispatch guard entirely when a toggleTarget's target
      // is dead — saves one TableFind fastcall per frame on a no-op keybind.
      const toggleTgtValid = isToggleTgt && (
        (tgt && tgt.type === 'Checkbox') ||
        (tgt && tgt.type === 'Switch') ||
        (tgt && tgt.type === 'Button' && tgt.toggleMode)
      );
      const emitDispatch = !isToggleTgt || toggleTgtValid;
      if (emitDispatch) {
        L.push(`            if ${tg}TableFind(Keys, E.${v}Key) and not TableFind(PrevKeys, E.${v}Key) then`);
        if (isTogUI) {
          // ToggleUI runs inline in PreLocal — it must affect render-visibility this frame.
          L.push(`                UIVisible = not UIVisible`);
          emitStaticVis(16);
          if (needsSetTab) L.push(`                if UIVisible then SetTab(ActiveTab) end`);
        } else if (isDestroyUI) {
          // DestroyUI: stop the whole UI cleanly. Removes every Drawing and
          // disconnects every connection. Idempotent (no-op on repeat press).
          L.push(`                _DestroyUI()`);
          L.push(`                return`);
        } else if (isKbSwTab) {
          // switchTab runs inline in PreLocal — must affect ActiveTab before render reads it.
          L.push(`                SetTab(${kbSwTabIdx || 1})`);
        } else if (isToggleTgt) {
          // toggleTarget flips another widget's state inline so Render sees it this frame.
          // Pure field writes — no allocation, no closure, no table build.
          if (tgt.type === 'Checkbox') {
            const tv = vn(tgt);
            L.push(`                E.${tv}Checked = not E.${tv}Checked`);
            if (tgt.exclusiveGroup) {
              const peers = sorted.filter(pe =>
                pe.type === 'Checkbox' && pe.id !== tgt.id && pe.exclusiveGroup === tgt.exclusiveGroup
              );
              if (peers.length) {
                // Unrolled at codegen time — no runtime loop, no iterator alloc.
                L.push(`                if E.${tv}Checked then`);
                for (const peer of peers) L.push(`                    E.${vn(peer)}Checked = false`);
                L.push(`                end`);
              }
            }
          } else if (tgt.type === 'Switch') {
            // Switch toggle-target: flip Enabled + update Track.Color + Knob.Position inline.
            // Knob is positioned relative to the live Track.Position (drag/center safe).
            const tv         = vn(tgt);
            const tKnobSize  = tgt.h - 4;
            const tOnOff     = tgt.w - tKnobSize - 2;
            const tcOn       = hotColor(tgt.onColor || '#4d90ff');
            const tcOff      = hotColor(tgt.color);
            L.push(`                E.${tv}Enabled = not E.${tv}Enabled`);
            if (tgt.exclusiveGroup) {
              const peers = sorted.filter(pe =>
                pe.type === 'Switch' && pe.id !== tgt.id && pe.exclusiveGroup === tgt.exclusiveGroup
              );
              if (peers.length) {
                L.push(`                if E.${tv}Enabled then`);
                for (const peer of peers) {
                  const pv    = vn(peer);
                  const pcOff = hotColor(peer.color);
                  L.push(`                    E.${pv}Enabled        = false`);
                  L.push(`                    E.${pv}Track.Color    = ${pcOff}`);
                  L.push(`                    E.${pv}Knob.Position  = E.${pv}Track.Position + Vector2.new(2, 2)`);
                }
                L.push(`                end`);
              }
            }
            L.push(`                if E.${tv}Enabled then`);
            L.push(`                    E.${tv}Track.Color   = ${tcOn}`);
            L.push(`                    E.${tv}Knob.Position = E.${tv}Track.Position + Vector2.new(${tOnOff}, 2)`);
            L.push(`                else`);
            L.push(`                    E.${tv}Track.Color   = ${tcOff}`);
            L.push(`                    E.${tv}Knob.Position = E.${tv}Track.Position + Vector2.new(2, 2)`);
            L.push(`                end`);
          } else {
            L.push(`                E.${vn(tgt)}Toggled = not E.${vn(tgt)}Toggled`);
          }
        } else {
          // CustomFunction — flag for PostLocal dispatch.
          L.push(`                E.${v}Fired = true`);
        }
        L.push(`            end`);
      }
      L.push(`        end`);
      L.push('');
    }

    for (const el of sorted.filter(e => e.type === 'Dropdown')) {
      const v       = vn(el);
      const opts    = (el.options || 'Option 1').split(',').map(o => o.trim());
      const N       = opts.length;
      const tg      = (multiTab && !el.shared) ? `ActiveTab == ${tabIdx(el)} and ` : '';
      const isDynDD = !!(el.dynamicOptions && el.dynamicOptions.trim());
      const slotCnt = isDynDD ? (el.maxOptions || 20) : N;
      if (isDynDD) {
        L.push(`        if ${tg}LeftClicked then`);
        L.push(`            do`);
        L.push(`                local Pos  = E.${v}Background.Position`);
        L.push(`                local Size = E.${v}Background.Size`);
        L.push(`                if Mouse.X >= Pos.X and Mouse.X <= Pos.X + Size.X`);
        L.push(`                and Mouse.Y >= Pos.Y and Mouse.Y <= Pos.Y + Size.Y then`);
        L.push(`                    E.${v}Open = not E.${v}Open`);
        L.push(`                end`);
        L.push(`            end`);
        L.push(`            if E.${v}Open then`);
        L.push(`                local BgPos  = E.${v}Background.Position`);
        L.push(`                local BgSize = E.${v}Background.Size`);
        L.push(`                for _i = 1, E.${v}SlotCount do`);
        L.push(`                    local SlotY = BgPos.Y + BgSize.Y * _i`);
        L.push(`                    if Mouse.X >= BgPos.X and Mouse.X <= BgPos.X + BgSize.X`);
        L.push(`                    and Mouse.Y >= SlotY and Mouse.Y < SlotY + BgSize.Y then`);
        L.push(`                        E.${v}Selected = tostring(E.${v}Options[_i] or "")`);
        L.push(`                        E.${v}Open     = false`);
        L.push(`                        E.${v}FiredIdx = _i`);
        L.push(`                        E.${v}Fired    = true`);
        L.push(`                        break`);
        L.push(`                    end`);
        L.push(`                end`);
        L.push(`            end`);
        L.push(`        end`);
        // Live-refresh options every frame while the dropdown is open.
        L.push(`        if ${tg}E.${v}Open then`);
        L.push(`            local _opts = ${wrapDynOptsExpr(el.dynamicOptions)}`);
        L.push(`            if type(_opts) ~= "table" then _opts = {} end`);
        L.push(`            E.${v}Options   = _opts`);
        L.push(`            E.${v}SlotCount = math.min(#_opts, ${slotCnt})`);
        L.push(`        end`);
      } else {
        L.push(`        if ${tg}LeftClicked then`);
        L.push(`            do`);
        L.push(`                local Pos  = E.${v}Background.Position`);
        L.push(`                local Size = E.${v}Background.Size`);
        L.push(`                if Mouse.X >= Pos.X and Mouse.X <= Pos.X + Size.X`);
        L.push(`                and Mouse.Y >= Pos.Y and Mouse.Y <= Pos.Y + Size.Y then`);
        L.push(`                    E.${v}Open = not E.${v}Open`);
        L.push(`                end`);
        L.push(`            end`);
        for (let i = 0; i < N; i++) {
          L.push(`            if E.${v}Open then`);
          L.push(`                local Pos  = E.${v}OptionBackground${i}.Position`);
          L.push(`                local Size = E.${v}OptionBackground${i}.Size`);
          L.push(`                if Mouse.X >= Pos.X and Mouse.X <= Pos.X + Size.X`);
          L.push(`                and Mouse.Y >= Pos.Y and Mouse.Y <= Pos.Y + Size.Y then`);
          L.push(`                    E.${v}Selected = "${opts[i]}"`);
          L.push(`                    E.${v}Open     = false`);
          L.push(`                    E.${v}FiredIdx = ${i + 1}`);
          L.push(`                    E.${v}Fired    = true`);
          L.push(`                end`);
          L.push(`            end`);
        }
        L.push(`        end`);
      }
      L.push('');
    }

    for (const el of sorted.filter(e => e.type === 'Slider')) {
      const v    = vn(el);
      // Any positive step is honored — including sub-unit (0.1, 0.25, 0.5).
      // When step is unset we leave Raw unrounded so the user can opt out of
      // quantization entirely (e.g. for fine continuous inputs).
      const step = el.step && el.step > 0 ? el.step : null;
      const tg   = (multiTab && !el.shared) ? `ActiveTab == ${tabIdx(el)} and ` : '';
      L.push(`        do`);
      L.push(`            local Pos  = E.${v}Track.Position`);
      L.push(`            local Size = E.${v}Track.Size`);
      L.push(`            local InRange: boolean = Mouse.X >= Pos.X and Mouse.X <= Pos.X + Size.X`);
      L.push(`                                 and Mouse.Y >= Pos.Y - 4 and Mouse.Y <= Pos.Y + Size.Y + 4`);
      L.push(`            if ${tg}LeftPressed and (E.${v}Dragging or InRange) then`);
      L.push(`                E.${v}Dragging = true`);
      L.push(`                local T: number = MathClamp((Mouse.X - Pos.X) / Size.X, 0, 1)`);
      if (step) {
        L.push(`                local Raw: number = ${el.minVal || 0} + T * (${el.maxVal || 100} - ${el.minVal || 0})`);
        L.push(`                E.${v}Value         = MathFloor(Raw / ${step} + 0.5) * ${step}`);
      } else {
        L.push(`                E.${v}Value         = ${el.minVal || 0} + T * (${el.maxVal || 100} - ${el.minVal || 0})`);
      }
      if (!el.fireOnRelease) {
        L.push(`                E.${v}Fired         = true`);
      }
      L.push(`            elseif not LeftPressed then`);
      if (el.fireOnRelease) {
        L.push(`                if E.${v}Dragging then`);
        L.push(`                    E.${v}Fired    = true`);
        L.push(`                end`);
      }
      L.push(`                E.${v}Dragging = false`);
      L.push(`            end`);
      L.push(`        end`);
      L.push('');
    }

    for (const el of sorted.filter(e => e.type === 'Button')) {
      const v       = vn(el);
      const btAct   = el.action || 'CustomFunction';
      const isSwitchTab = btAct.startsWith('switchTab:');
      const isDestroyBtn = btAct === 'DestroyUI';
      const switchTabIdx = isSwitchTab
        ? S.tabs.findIndex(t => t.id === btAct.slice('switchTab:'.length)) + 1
        : 0;
      // A button can only be CLICKED when it's visible, so gate purely by tab
      // membership (shared buttons fire from any tab; tab-specific ones only on
      // their tab). This applies to switchTab/DestroyUI buttons too — otherwise
      // their hidden hitbox on another tab steals overlapping clicks (e.g. a
      // slider sitting where an off-tab Unload button used to be).
      const tg = (multiTab && !el.shared) ? `ActiveTab == ${tabIdx(el)} and ` : '';
      L.push(`        do`);
      L.push(`            local Pos  = E.${v}Background.Position`);
      L.push(`            local Size = E.${v}Background.Size`);
      L.push(`            local Over: boolean = Mouse.X >= Pos.X and Mouse.X <= Pos.X + Size.X`);
      L.push(`                              and Mouse.Y >= Pos.Y and Mouse.Y <= Pos.Y + Size.Y`);
      L.push(`            if ${tg}Over and LeftClicked then`);
      if (isSwitchTab) {
        L.push(`                SetTab(${switchTabIdx || 1})`);
      } else if (isDestroyBtn) {
        // DestroyUI inline: stop the whole UI cleanly. Removes every Drawing and
        // disconnects every connection. Idempotent (no-op on repeat click).
        L.push(`                _DestroyUI()`);
        L.push(`                return`);
      } else if (el.toggleMode) {
        L.push(`                E.${v}Toggled = not E.${v}Toggled`);
      } else {
        L.push(`                E.${v}Fired   = true`);
      }
      L.push(`            end`);
      L.push(`        end`);
      L.push('');
    }

    for (const el of draggables) {
      const v      = vn(el);
      const b      = bounds(el);
      // Cross-tab parent guard: only include children on the same tab (or shared-across-tabs).
      const _sameTab = (k) => el.shared || k.shared || ((k.tabId || S.tabs[0].id) === (el.tabId || S.tabs[0].id));
      // Recursive descendant walk so hit-test exclusion covers grandchildren too.
      const uiKids = [];
      {
        const stack = S.els.filter(e => e.parentId === el.id && e.visible && _sameTab(e));
        const seen  = new Set();
        while (stack.length) {
          const k = stack.shift();
          if (seen.has(k.id)) continue;
          seen.add(k.id);
          if (UI_TYPES.has(k.type)) uiKids.push(k);
          for (const gc of S.els) {
            if (gc.parentId === k.id && gc.visible && _sameTab(gc) && !seen.has(gc.id)) stack.push(gc);
          }
        }
      }
      const kidHitVar = kid => (kid.type === 'Slider' || kid.type === 'Switch')
        ? `${vn(kid)}Track`
        : `${vn(kid)}Background`;

      L.push(`        do`);
      L.push(`            local SquarePos:  Vector2 = E.${v}.Position`);
      L.push(`            local SquareSize: Vector2 = E.${v}.Size`);
      L.push(`            local OnSquare: boolean = Mouse.X >= SquarePos.X and Mouse.X <= SquarePos.X + SquareSize.X`);
      L.push(`                                  and Mouse.Y >= SquarePos.Y and Mouse.Y <= SquarePos.Y + SquareSize.Y`);
      if (uiKids.length) {
        L.push(`            local OnChild: boolean = false`);
        for (const kid of uiKids) {
          const kv = vn(kid);
          const hv = kidHitVar(kid);
          L.push(`            do`);
          L.push(`                local ChildPos  = E.${hv}.Position`);
          L.push(`                local ChildSize = E.${hv}.Size`);
          if (kid.type === 'Slider') {
            L.push(`                if E.${kv}Dragging`);
            L.push(`                or (Mouse.X >= ChildPos.X and Mouse.X <= ChildPos.X + ChildSize.X`);
            L.push(`                and Mouse.Y >= ChildPos.Y - 8 and Mouse.Y <= ChildPos.Y + ChildSize.Y + 8) then`);
          } else {
            L.push(`                if Mouse.X >= ChildPos.X and Mouse.X <= ChildPos.X + ChildSize.X`);
            L.push(`                and Mouse.Y >= ChildPos.Y and Mouse.Y <= ChildPos.Y + ChildSize.Y then`);
          }
          L.push(`                    OnChild = true`);
          L.push(`                end`);
          L.push(`            end`);
        }
        L.push(`            if LeftPressed and not OnChild and (E.${v}DragActive or OnSquare) then`);
      } else {
        L.push(`            if LeftPressed and (E.${v}DragActive or OnSquare) then`);
      }
      L.push(`                if not E.${v}DragActive then`);
      L.push(`                    E.${v}DragActive     = true`);
      L.push(`                    E.${v}DragStartMouse = Mouse`);
      L.push(`                    E.${v}DragStartPos   = SquarePos`);
      L.push(`                end`);
      L.push(`            elseif not LeftPressed then`);
      L.push(`                E.${v}DragActive = false`);
      L.push(`            end`);
      L.push(`        end`);
      L.push('');
    }

    if (hasKB) L.push('        PrevKeys        = Keys');
    L.push('        PrevLeftPressed = LeftPressed');
    if (hasDynText) {
      L.push('');
      emitDynTextLines('        ');
    }
    L.push(connEnd);

    // ── PostLocal: unified event dispatch + every-frame polling bodies ───
    // Severe phase map: Render = draw only, PreLocal = logic/state mutation,
    // PostLocal = "per-frame logic after physics / input globals / free user code."
    // All user callback bodies (event + polling) run here so PreLocal stays
    // focused on input handling and never interleaves with user code.
    emitPostLocalInteractive(L, sorted, vn, needsDestroy);
    } // end needsInteractive
    L.push('');

    // ── Standalone PreLocal for pure dynamic text (no interactive elements) ──
    if (hasDynText && !needsInteractive) {
      L.push(`${connPre}RunService.PreLocal:Connect(function()`);
      emitDynTextLines('        ');
      L.push(connEnd);
      L.push('');
    }

    // ── PreLocal #2: Drawing property updates (retained-mode, so no Render needed) ──
    // Severe rule: Render is for DRAWING ONLY. Retained-mode Drawing objects (Drawing.new)
    // keep rendering themselves once their properties are set — so every mutation here
    // (Visible, Color, Position, Size, Text) belongs in PreLocal, not Render.
    if (needsInteractive) {
    L.push(`${connPre}RunService.PreLocal:Connect(function()`);
    L.push('        if not isrbxactive() then return end  -- skip per-frame work when unfocused');
    if (needsMouse) {
      L.push('        local Mouse: Vector2 = UserInputService:GetMouseLocation()');
      L.push('');
    }

    for (const el of sorted.filter(e => e.type === 'Checkbox')) {
      const v  = vn(el);
      const ti = tabIdx(el);
      const tabGate = (multiTab && !el.shared) ? `ActiveTab == ${ti} and ` : '';
      const uiGate  = hasToggleUI ? `UIVisible and ` : '';
      L.push(`        E.${v}Fill.Visible = ${uiGate}${tabGate}E.${v}Checked`);
    }
    if (hasCB) L.push('');

    // Keybind DisplayText is event-driven (updated at state transitions), so no
    // per-frame Text mutation is required.  (Dynamic-text mirrors read the same
    // cached DisplayText string ref.)

    for (const el of sorted.filter(e => e.type === 'Dropdown')) {
      const v       = vn(el);
      const opts    = (el.options || 'Option 1').split(',').map(o => o.trim());
      const N       = opts.length;
      const ti      = tabIdx(el);
      const tabGate = (multiTab && !el.shared) ? `ActiveTab == ${ti} and ` : '';
      const uiGate  = hasToggleUI ? `UIVisible and ` : '';
      const isDynDD = !!(el.dynamicOptions && el.dynamicOptions.trim());
      const slotCnt = isDynDD ? (el.maxOptions || 20) : N;
      if (isDynDD) {
        // Hot path: indexes into the pre-built _OptBg/_OptTx ref arrays so no
        // per-slot string keys are built at runtime. Labels only re-fit when
        // the option string actually changes (cached in _OptPrev).
        L.push(`        do`);
        L.push(`            local _BgPos   = E.${v}Background.Position`);
        L.push(`            local _BgSize  = E.${v}Background.Size`);
        L.push(`            local _OptBg   = E.${v}_OptBg`);
        L.push(`            local _OptTx   = E.${v}_OptTx`);
        L.push(`            local _OptPrev = E.${v}_OptPrev`);
        L.push(`            local _Options = E.${v}Options`);
        L.push(`            local _Count   = E.${v}SlotCount`);
        L.push(`            E.${v}Text.Text  = E.${v}Selected`);
        L.push(`            _FitText(E.${v}Text, ${Math.max(1, el.w - 28)})`);
        L.push(`            E.${v}Arrow.Text = if E.${v}Open then "\u25b2" else "\u25bc"`);
        L.push(`            for _i = 1, ${slotCnt} do`);
        L.push(`                local _bg = _OptBg[_i]`);
        L.push(`                local _tx = _OptTx[_i]`);
        L.push(`                local _show: boolean = ${uiGate}${tabGate}E.${v}Open and _i <= _Count`);
        L.push(`                _bg.Visible = _show`);
        L.push(`                _tx.Visible = _show`);
        L.push(`                if _show then`);
        L.push(`                    _bg.Position = Vector2.new(_BgPos.X, _BgPos.Y + _BgSize.Y * _i)`);
        L.push(`                    _bg.Size     = _BgSize`);
        L.push(`                    _tx.Position = Vector2.new(_BgPos.X + 6, _BgPos.Y + _BgSize.Y * _i + 4)`);
        // Only rebuild the text + re-fit when the source option actually changed.
        L.push(`                    local _opt = _Options[_i]`);
        L.push(`                    local _str = if type(_opt) == "string" then _opt else tostring(_opt or "")`);
        L.push(`                    if _str ~= _OptPrev[_i] then`);
        L.push(`                        _tx.Text     = _str`);
        L.push(`                        _FitText(_tx, ${Math.max(1, el.w - 16)})`);
        L.push(`                        _OptPrev[_i] = _str`);
        L.push(`                    end`);
        L.push(`                end`);
        L.push(`            end`);
        L.push(`        end`);
      } else {
        L.push(`        E.${v}Text.Text  = E.${v}Selected`);
        L.push(`        _FitText(E.${v}Text, ${Math.max(1, el.w - 28)})`);
        L.push(`        E.${v}Arrow.Text = if E.${v}Open then "\u25b2" else "\u25bc"`);
        for (let i = 0; i < N; i++) {
          L.push(`        E.${v}OptionBackground${i}.Visible = ${uiGate}${tabGate}E.${v}Open`);
          L.push(`        E.${v}OptionText${i}.Visible       = ${uiGate}${tabGate}E.${v}Open`);
        }
      }
      L.push('');
    }

    for (const el of sorted.filter(e => e.type === 'Slider')) {
      const v    = vn(el);
      const minV = el.minVal || 0;
      const maxV = el.maxVal || 100;
      L.push(`        do`);
      L.push(`            local T: number  = MathClamp((E.${v}Value - ${minV}) / ${maxV - minV}, 0, 1)`);
      L.push(`            local FW: number = E.${v}Track.Size.X * T`);
      L.push(`            E.${v}Fill.Size     = Vector2.new(FW, E.${v}Track.Size.Y)`);
      L.push(`            E.${v}Knob.Position = Vector2.new(E.${v}Track.Position.X + FW - 5, E.${v}Track.Position.Y - 2)`);
      // Only rebuild the label string when the Value actually changed — saves
      // _FmtNum + string concat + _FitText per frame while the user isn't dragging.
      L.push(`            if E.${v}Value ~= E.${v}_LabelPrev then`);
      L.push(`                E.${v}Label.Text = _FmtNum(E.${v}Value) .. "${el.suffix || ''}"`);
      L.push(`                _FitText(E.${v}Label, ${Math.max(1, el.w)})`);
      L.push(`                E.${v}_LabelPrev = E.${v}Value`);
      L.push(`            end`);
      L.push(`        end`);
    }
    if (hasSL) L.push('');

    for (const el of sorted.filter(e => e.type === 'Button')) {
      const v         = vn(el);
      const btAct     = el.action || 'CustomFunction';
      const isSwitchTab = btAct.startsWith('switchTab:');
      const switchTabIdx = isSwitchTab
        ? S.tabs.findIndex(t => t.id === btAct.slice('switchTab:'.length)) + 1
        : 0;
      if (isSwitchTab) {
        // All four color states resolved to cached module-scope Color3 locals —
        // no Color3.fromRGB per frame regardless of which branch is taken.
        const actBgC    = hotColor(el.tabActiveColor   || el.hoverColor || el.color);
        const actTextC  = hotColor(el.tabActiveTextColor || el.textColor || '#ffffff');
        const hoverBgC  = hotColor(el.hoverColor || el.color);
        const baseBgC   = hotColor(el.color);
        const baseTextC = hotColor(el.textColor || '#ffffff');
        L.push(`        do`);
        L.push(`            local Pos  = E.${v}Background.Position`);
        L.push(`            local Size = E.${v}Background.Size`);
        L.push(`            local Over:  boolean = Mouse.X >= Pos.X and Mouse.X <= Pos.X + Size.X`);
        L.push(`                              and Mouse.Y >= Pos.Y and Mouse.Y <= Pos.Y + Size.Y`);
        L.push(`            local IsAct: boolean = ActiveTab == ${switchTabIdx}`);
        L.push(`            E.${v}Background.Color = if IsAct then ${actBgC} elseif Over then ${hoverBgC} else ${baseBgC}`);
        L.push(`            E.${v}Text.Color       = if IsAct then ${actTextC} else ${baseTextC}`);
        L.push(`        end`);
      } else if (el.toggleMode) {
        const activeC = hotColor(el.activeColor || '#2a5ec4');
        const baseC   = hotColor(el.color);
        L.push(`        E.${v}Background.Color = if E.${v}Toggled then ${activeC} else ${baseC}`);
      } else {
        const hoverC = hotColor(el.hoverColor || el.color);
        const baseC  = hotColor(el.color);
        L.push(`        do`);
        L.push(`            local Pos  = E.${v}Background.Position`);
        L.push(`            local Size = E.${v}Background.Size`);
        L.push(`            local Over: boolean = Mouse.X >= Pos.X and Mouse.X <= Pos.X + Size.X`);
        L.push(`                              and Mouse.Y >= Pos.Y and Mouse.Y <= Pos.Y + Size.Y`);
        L.push(`            E.${v}Background.Color = if Over then ${hoverC} else ${baseC}`);
        L.push(`        end`);
      }
    }
    if (hasBT) L.push('');

    for (const el of draggables) {
      const v       = vn(el);
      const b       = bounds(el);
      // Cross-tab parent guard: only move children on the same tab (or shared).
      const _sameTab = (k) => el.shared || k.shared || ((k.tabId || S.tabs[0].id) === (el.tabId || S.tabs[0].id));
      // Recursive descendant walk: move ALL descendants of the draggable, not just direct children.
      const allKids = [];
      {
        const stack = S.els.filter(e => e.parentId === el.id && e.visible && _sameTab(e));
        const seen  = new Set();
        while (stack.length) {
          const k = stack.shift();
          if (seen.has(k.id)) continue;
          seen.add(k.id);
          allKids.push(k);
          for (const gc of S.els) {
            if (gc.parentId === k.id && gc.visible && _sameTab(gc) && !seen.has(gc.id)) stack.push(gc);
          }
        }
      }

      L.push(`        if E.${v}DragActive then`);
      L.push(`            local NewPos: Vector2 = E.${v}DragStartPos + (Mouse - E.${v}DragStartMouse)`);
      L.push(`            E.${v}.Position = NewPos`);

      for (const kid of allKids) {
        const kv = vn(kid);
        const kb = bounds(kid);
        const ox = Math.round(kb.x) - Math.round(b.x);
        const oy = Math.round(kb.y) - Math.round(b.y);
        L.push('');
        if (kid.type === 'Checkbox') {
          const pad = 3;
          L.push(`            E.${kv}Background.Position  = NewPos + Vector2.new(${ox}, ${oy})`);
          L.push(`            E.${kv}Fill.Position        = NewPos + Vector2.new(${ox + pad}, ${oy + pad})`);
          L.push(`            E.${kv}Label.Position       = NewPos + Vector2.new(${ox + kid.w + 6}, ${oy + Math.round(kid.h/2 - (kid.textSize||16)/2)})`);
        } else if (kid.type === 'Keybind') {
          L.push(`            E.${kv}Background.Position = NewPos + Vector2.new(${ox}, ${oy})`);
          L.push(`            E.${kv}Text.Position       = NewPos + Vector2.new(${ox + Math.round(kid.w/2)}, ${oy + Math.round(kid.h/2 - (kid.textSize||16)/2)})`);
        } else if (kid.type === 'Dropdown') {
          const dopts      = (kid.options || 'Option 1').split(',').map(o => o.trim());
          const isDynKid   = !!(kid.dynamicOptions && kid.dynamicOptions.trim());
          const dragSlots  = isDynKid ? (kid.maxOptions || 20) : dopts.length;
          L.push(`            E.${kv}Background.Position = NewPos + Vector2.new(${ox}, ${oy})`);
          L.push(`            E.${kv}Text.Position       = NewPos + Vector2.new(${ox + 8}, ${oy + Math.round(kid.h/2 - (kid.textSize||16)/2)})`);
          L.push(`            E.${kv}Arrow.Position      = NewPos + Vector2.new(${ox + kid.w - 16}, ${oy + Math.round(kid.h/2 - (kid.textSize||16)/2)})`);
          for (let i = 0; i < dragSlots; i++) {
            L.push(`            E.${kv}OptionBackground${i}.Position = NewPos + Vector2.new(${ox}, ${oy + kid.h*(i+1)})`);
            L.push(`            E.${kv}OptionText${i}.Position       = NewPos + Vector2.new(${ox + 8}, ${oy + kid.h*(i+1) + Math.round(kid.h/2 - (kid.textSize||16)/2)})`);
          }
        } else if (kid.type === 'Slider') {
          L.push(`            E.${kv}Track.Position = NewPos + Vector2.new(${ox}, ${oy})`);
          L.push(`            E.${kv}Fill.Position  = NewPos + Vector2.new(${ox}, ${oy})`);
          L.push(`            E.${kv}Knob.Position  = NewPos + Vector2.new(${ox} + E.${kv}Fill.Size.X - 5, ${oy} - 2)`);
          L.push(`            E.${kv}Label.Position = NewPos + Vector2.new(${ox + Math.round(kid.w/2)}, ${oy - 16})`);
        } else if (kid.type === 'Button') {
          L.push(`            E.${kv}Background.Position = NewPos + Vector2.new(${ox}, ${oy})`);
          L.push(`            E.${kv}Text.Position       = NewPos + Vector2.new(${ox + Math.round(kid.w/2)}, ${oy + Math.round(kid.h/2 - (kid.textSize||16)/2)})`);
        } else if (kid.type === 'Switch') {
          // Knob X depends on current Enabled state — branchless via if-expression.
          const kPad     = 2;
          const kKnobSz  = kid.h - 4;
          const kKnobOnX = ox + kid.w - kKnobSz - kPad;
          const kKnobOff = ox + kPad;
          L.push(`            E.${kv}Track.Position    = NewPos + Vector2.new(${ox}, ${oy})`);
          L.push(`            E.${kv}Knob.Position     = NewPos + Vector2.new(if E.${kv}Enabled then ${kKnobOnX} else ${kKnobOff}, ${oy + kPad})`);
          L.push(`            E.${kv}Label.Position    = NewPos + Vector2.new(${ox + kid.w + 8}, ${oy + Math.round(kid.h/2 - (kid.textSize||16)/2)})`);
        } else if (kid.type === 'Circle') {
          const ocx = Math.round(kb.cx) - Math.round(b.x);
          const ocy = Math.round(kb.cy) - Math.round(b.y);
          L.push(`            E.${kv}.Position = NewPos + Vector2.new(${ocx}, ${ocy})`);
        } else if (kid.type === 'Triangle') {
          // Rotated points relative to parent top-left (same as unrotated when rot==0).
          const tp = triPoints(kid, kb);
          L.push(`            E.${kv}.PointA = NewPos + Vector2.new(${Math.round(tp[0][0] - b.x)}, ${Math.round(tp[0][1] - b.y)})`);
          L.push(`            E.${kv}.PointB = NewPos + Vector2.new(${Math.round(tp[1][0] - b.x)}, ${Math.round(tp[1][1] - b.y)})`);
          L.push(`            E.${kv}.PointC = NewPos + Vector2.new(${Math.round(tp[2][0] - b.x)}, ${Math.round(tp[2][1] - b.y)})`);
        } else if (kid.type === 'Text') {
          // Centered text uses its anchor (kb.wx/wy), not the bbox left edge, as .Position.
          // Using ox/oy (which derive from kb.x = wx - tw/2) would drift centered labels
          // by half their width on every drag. Use the raw anchor offset instead.
          const ax = Math.round(kb.wx != null ? kb.wx : kb.x) - Math.round(b.x);
          const ay = Math.round(kb.wy != null ? kb.wy : kb.y) - Math.round(b.y);
          L.push(`            E.${kv}.Position = NewPos + Vector2.new(${ax}, ${ay})`);
        } else if (kid.type === 'Line') {
          // Offsets MUST track each endpoint relative to the parent's top-left —
          // NOT the bbox corner (ox/oy). Using the bbox corner distorts any line
          // whose endpoints aren't already in top-left→bottom-right order, because
          // From/To then get pinned to min(x)/min(y) instead of the real points.
          const kb2 = bounds(kid);
          const fx = Math.round(kb2.wx1) - Math.round(b.x);
          const fy = Math.round(kb2.wy1) - Math.round(b.y);
          const tx = Math.round(kb2.wx2) - Math.round(b.x);
          const ty = Math.round(kb2.wy2) - Math.round(b.y);
          L.push(`            E.${kv}.From = NewPos + Vector2.new(${fx}, ${fy})`);
          L.push(`            E.${kv}.To   = NewPos + Vector2.new(${tx}, ${ty})`);
        } else if (kid.type === 'Polyline') {
          const kb2 = bounds(kid);
          const fx = Math.round(kb2.wx1) - Math.round(b.x);
          const fy = Math.round(kb2.wy1) - Math.round(b.y);
          const tx = Math.round(kb2.wx2) - Math.round(b.x);
          const ty = Math.round(kb2.wy2) - Math.round(b.y);
          L.push(`            E.${kv}.Points = { NewPos + Vector2.new(${fx}, ${fy}), NewPos + Vector2.new(${tx}, ${ty}) }`);
        } else if (isRotatedSquare(kid)) {
          // Rotated square child renders as a Polyline quad — move its 4 corners.
          const c   = quadCorners(kid, kb);
          const pts = [...c, c[0]].map(p => `NewPos + Vector2.new(${Math.round(p[0] - b.x)}, ${Math.round(p[1] - b.y)})`).join(', ');
          L.push(`            E.${kv}.Points = { ${pts} }`);
        } else {
          L.push(`            E.${kv}.Position = NewPos + Vector2.new(${ox}, ${oy})`);
        }
      }

      L.push(`        end`);
      L.push('');
    }

    L.push(connEnd);
    } // end if (needsInteractive) Render block
    L.push('end');
  } else {
    // no runtime block — close IIFE after init block
    L.push('');
  }

  L.push('end)()');

  return L.join('\n');
}

/* ═══════════════════════════════════════════
   IMMEDIATE MODE CODE GENERATION
═══════════════════════════════════════════ */
function genLuaImmediate() {
  const vn     = makeVn();
  const L      = [];
  const sorted = sortedEls();
  // "Center on viewport" setting: shift every cached position by _OFF
  const centerOn = !!(typeof SETTINGS !== 'undefined' && SETTINGS.centerOnViewport);
  const designW  = (typeof CV !== 'undefined' && CV.width)  ? CV.width  : 1920;
  const designH  = (typeof CV !== 'undefined' && CV.height) ? CV.height : 1080;

  // ── flags (mirrors genLua) ───────────────────────────────────
  // Rotated squares render as a quad (no Position/Size) → never draggable.
  const hasDrag    = sorted.some(e => e.type === 'Square' && e.draggable && !e.rotation);
  const hasCB      = sorted.some(e => e.type === 'Checkbox');
  const hasKB      = sorted.some(e => e.type === 'Keybind');
  const hasDD      = sorted.some(e => e.type === 'Dropdown');
  const hasSL      = sorted.some(e => e.type === 'Slider');
  const hasBT      = sorted.some(e => e.type === 'Button');
  const hasSW      = sorted.some(e => e.type === 'Switch');
  const dynTextEls     = sorted.filter(e => e.type === 'Text' && e.dynamicSource && e.dynamicSource !== '');
  const hasDynText     = dynTextEls.length > 0;
  const needsTabNames  = dynTextEls.some(e => e.dynamicSource === 'tabName');
  const hasRuntimeText = dynTextEls.some(e => e.dynamicSource === 'runtime');
  const needsInteractive = hasDrag || hasCB || hasKB || hasDD || hasSL || hasBT || hasSW;
  const needsInput     = needsInteractive || hasDynText;
  const draggables     = sorted.filter(e => e.type === 'Square' && e.draggable && !e.rotation);
  const multiTab       = S.tabs.length > 1;
  const tabIdx         = el => Math.max(1, S.tabs.findIndex(t => t.id === el.tabId) + 1 || 1);
  const hasSwitchTabAction = sorted.some(e =>
    (e.type === 'Button' || e.type === 'Keybind') && (e.action || '').startsWith('switchTab:')
  );
  const hasToggleUI  = sorted.some(e => e.type === 'Keybind' && (e.action || 'CustomFunction') === 'ToggleUI');
  const needsMouse   = hasBT || hasDrag || hasSwitchTabAction;
  // DestroyUI: track connections and emit _DestroyUI() if any Button/Keybind needs it.
  const needsDestroy = sorted.some(e =>
    (e.type === 'Button' || e.type === 'Keybind') && e.action === 'DestroyUI'
  );
  // Connection wrappers — every Connect goes through table.insert(_Conns, ...) when
  // DestroyUI is in use so we can disconnect cleanly. Otherwise emit unwrapped.
  const connPre = needsDestroy ? '    table.insert(_Conns, ' : '    ';
  const connEnd = needsDestroy ? '    end))'                 : '    end)';

  if (!sorted.length) {
    return ['--!strict', '--!optimize 2', '', 'local RunService = game:GetService("RunService")'].join('\n');
  }

  // ── helpers ───────────────────────────────────────────────────
  // Walk up the ancestor chain to find a draggable Square. The cross-tab guard is
  // applied ONLY at the draggable endpoint (mirroring the static-mode _sameTab
  // filter used by the drag handler): the descendant follows the drag if the
  // draggable is shared, OR the descendant itself is shared, OR they share a tab.
  // Intermediate containers may live on a different tab (e.g. Tab-2 ESP group
  // parented through a Tab-1 CombatBg whose own parent is a shared draggable) —
  // that's legal because the static drag walks DOWN from the draggable and would
  // still include the descendant.
  const findDragAncestor = el => {
    let cur = el;
    const seen = new Set();
    const T0 = S.tabs[0].id;
    while (cur && cur.parentId && !seen.has(cur.id)) {
      seen.add(cur.id);
      const par = S.els.find(e => e.id === cur.parentId);
      if (!par) return undefined;
      if (par.type === 'Square' && par.draggable) {
        if (par.shared || el.shared || (par.tabId || T0) === (el.tabId || T0)) return par;
        return undefined;
      }
      cur = par;
    }
    return undefined;
  };
  const isDragChild = el => !!findDragAncestor(el);
  const dragParent  = el => findDragAncestor(el);

  // ── pre-cache: Color3 + Vector2 constants (module-level locals) ──
  // These are emitted BEFORE the IIFE so Render never allocates static values.
  const cacheLines     = [];
  const cachedColors   = new Map();   // hex  → local name
  const cachedV2Sizes  = new Map();   // "w,h"→ local name
  const cachedV2Pos    = new Map();   // "x,y"→ local name  (non-drag-child positions only)
  const usedHints      = new Set();

  const uniqHint = (base) => {
    let h = base, n = 2;
    while (usedHints.has(h)) h = base + n++;
    usedHints.add(h);
    return h;
  };

  const getC = (hex, hint) => {
    if (!cachedColors.has(hex)) {
      const nm = uniqHint('_C' + hint);
      cachedColors.set(hex, nm);
      const [r, g, b] = hexRGB(hex || '#ffffff');
      cacheLines.push(`local ${nm}: Color3 = Color3.fromRGB(${r}, ${g}, ${b})`);
    }
    return cachedColors.get(hex);
  };
  const getV = (w, h, hint) => {
    const key = `${Math.round(w)},${Math.round(h)}`;
    if (!cachedV2Sizes.has(key)) {
      const nm = uniqHint('_V' + hint);
      cachedV2Sizes.set(key, nm);
      cacheLines.push(`local ${nm}: Vector2 = Vector2.new(${Math.round(w)}, ${Math.round(h)})`);
    }
    return cachedV2Sizes.get(key);
  };
  const getP = (x, y, hint) => {
    const key = `${Math.round(x)},${Math.round(y)}`;
    if (!cachedV2Pos.has(key)) {
      const nm = uniqHint('_P' + hint);
      cachedV2Pos.set(key, nm);
      const rhs = centerOn
        ? `_OFF + Vector2.new(${Math.round(x)}, ${Math.round(y)})`
        : `Vector2.new(${Math.round(x)}, ${Math.round(y)})`;
      cacheLines.push(`local ${nm}: Vector2 = ${rhs}`);
    }
    return cachedV2Pos.get(key);
  };

  // Helper: if a filled-rect-style widget has rounding > 0, pre-register the two
  // central-bar sizes used by emitFilledRect so the cache lines are emitted before
  // the IIFE (getV appends to `cacheLines`, which has already been flushed once the
  // render loop runs — so anything we'll ask for during render must be registered now).
  const preRoundV = (w, h, rounding, hint) => {
    if (!rounding || rounding <= 0) return;
    const W = Math.round(w), H = Math.round(h);
    const r = Math.max(0, Math.min(Math.round(rounding), Math.floor(W / 2), Math.floor(H / 2)));
    if (r <= 0) return;
    // Only register the central bars that will actually be drawn — the full-pill
    // case (2r == H or 2r == W) has a zero-size bar that emitFilledRect skips.
    if (W - 2 * r > 0) getV(W - 2 * r, H,         hint + 'H');
    if (H - 2 * r > 0) getV(W,         H - 2 * r, hint + 'V');
  };

  // Walk elements once to register all constants
  for (const el of sorted) {
    const v   = vn(el);
    const b   = bounds(el);
    const idc = isDragChild(el);

    switch (el.type) {
      case 'Square':
        getC(el.color, v);
        if (isRotatedSquare(el)) {
          // Rotated square draws as a quad — cache its 4 rotated corners (when not
          // a drag child; drag children compute corners from the parent each frame).
          if (!idc) {
            const c = quadCorners(el, b);
            getP(c[0][0], c[0][1], v + 'Q0');
            getP(c[1][0], c[1][1], v + 'Q1');
            getP(c[2][0], c[2][1], v + 'Q2');
            getP(c[3][0], c[3][1], v + 'Q3');
          }
        } else {
          getV(el.w, el.h, v);
          if (el.filled) preRoundV(el.w, el.h, el.rounding || 0, v);
          if (!idc && !el.draggable) getP(b.x, b.y, v);
        }
        break;
      case 'Circle':
        getC(el.color, v);
        if (!idc) getP(b.cx, b.cy, v);
        break;
      case 'Text':
        getC(el.color, v);
        if (el.outline && el.outlineColor) getC(el.outlineColor, v + 'Out');
        if (!idc) getP(b.wx !== undefined ? b.wx : b.x, b.wy !== undefined ? b.wy : b.y, v);
        break;
      case 'Triangle': {
        getC(el.color, v);
        if (!idc) {
          // triPoints == original vertices when rotation == 0 (byte-identical keys).
          const tp = triPoints(el, b);
          getP(tp[0][0], tp[0][1], v + 'A');
          getP(tp[1][0], tp[1][1], v + 'B');
          getP(tp[2][0], tp[2][1], v + 'C');
        }
        break;
      }
      case 'Line':
        getC(el.color, v);
        if (!idc) { getP(b.wx1, b.wy1, v + 'A'); getP(b.wx2, b.wy2, v + 'B'); }
        break;
      case 'Polyline':
        getC(el.color, v);
        if (!idc) { getP(b.wx1, b.wy1, v + 'A'); getP(b.wx2, b.wy2, v + 'B'); }
        break;
      case 'Image':
        getC(el.color || '#ffffff', v);
        getV(el.w, el.h, v);
        if (!idc) getP(b.x, b.y, v);
        break;
      case 'Checkbox': {
        const pad = 3;
        getC(el.color,                  v + 'Bg');
        getC(el.checkedColor || '#00ff00', v + 'Fl');
        getC(el.textColor    || '#ffffff', v + 'Lb');
        getV(el.w, el.h,                   v + 'Bg');
        getV(el.w - pad * 2, el.h - pad * 2, v + 'Fl');
        if (!idc) {
          getP(b.x,       b.y,       v + 'Bg');
          getP(b.x + pad, b.y + pad, v + 'Fl');
          getP(b.x + el.w + 6, b.y + Math.round(el.h / 2 - (el.textSize || 16) / 2), v + 'Lb');
        }
        break;
      }
      case 'Keybind': {
        getC(el.color,              v + 'Bg');
        getC(el.textColor || '#ffffff', v + 'Tx');
        getV(el.w, el.h,            v + 'Bg');
        preRoundV(el.w, el.h, el.rounding || 0, v + 'Kb');
        if (!idc) {
          getP(b.x, b.y, v + 'Bg');
          getP(b.x + Math.round(el.w / 2), b.y + Math.round(el.h / 2 - (el.textSize || 16) / 2), v + 'Tx');
        }
        break;
      }
      case 'Dropdown': {
        getC(el.color,              v + 'Bg');
        getC(el.textColor || '#ffffff', v + 'Tx');
        getV(el.w, el.h,            v + 'Bg');
        preRoundV(el.w, el.h, el.rounding || 0, v + 'Dd');
        if (!idc) {
          getP(b.x, b.y, v + 'Bg');
          getP(b.x + 8,          b.y + Math.round(el.h / 2 - (el.textSize || 16) / 2), v + 'Tx');
          getP(b.x + el.w - 16,  b.y + Math.round(el.h / 2 - (el.textSize || 16) / 2), v + 'Ar');
        }
        break;
      }
      case 'Slider': {
        getC(el.color,              v + 'Tk');
        getC(el.knobColor || '#ffffff', v + 'Kn');
        getC(el.textColor || '#ffffff', v + 'Lb');
        getV(el.w, el.h,            v + 'Tk');
        getV(10, el.h + 4,          v + 'Kn');
        preRoundV(el.w, el.h, el.rounding || 0, v + 'Sl');
        if (!idc) {
          getP(b.x, b.y, v + 'Tk');
          getP(b.x + Math.round(el.w / 2), b.y - 16, v + 'Lb');
        }
        break;
      }
      case 'Button': {
        getC(el.color,              v + 'Bg');
        getC(el.hoverColor || el.color, v + 'Hv');
        getC(el.textColor || '#ffffff', v + 'Tx');
        if (el.toggleMode) getC(el.activeColor || '#2a5ec4', v + 'Ac');
        if (el.tabActiveColor) getC(el.tabActiveColor, v + 'TbAc');
        getV(el.w, el.h,            v + 'Bg');
        preRoundV(el.w, el.h, el.rounding || 0, v + 'Bt');
        if (!idc) {
          getP(b.x, b.y, v + 'Bg');
          getP(b.x + Math.round(el.w / 2), b.y + Math.round(el.h / 2 - (el.textSize || 16) / 2), v + 'Tx');
        }
        break;
      }
      case 'Switch': {
        // Both Off + On colors must be cached so render can pick via if-expression
        // without ever allocating a Color3.
        getC(el.color,                  v + 'SwOff');
        getC(el.onColor || '#4d90ff',   v + 'SwOn');
        getC(el.knobColor || '#ffffff', v + 'SwKn');
        getC(el.textColor || '#ffffff', v + 'SwLb');
        getV(el.w, el.h,                v + 'SwTk');
        const sKnobSz = el.h - 4;
        getV(sKnobSz, sKnobSz,          v + 'SwKn');
        preRoundV(el.w, el.h, el.rounding != null ? el.rounding : Math.floor(el.h / 2), v + 'SwTk');
        if (!idc) {
          getP(b.x, b.y, v + 'SwTk');
          getP(b.x + el.w + 8, b.y + Math.round(el.h / 2 - (el.textSize || 16) / 2), v + 'SwLb');
        }
        break;
      }
    }
  }

  // ── directives ──────────────────────────────────────────────
  L.push('--!strict');
  L.push('--!optimize 2');
  L.push('');
  L.push('local RunService = game:GetService("RunService")');
  if (needsInput) L.push('local UserInputService = game:GetService("UserInputService")');
  L.push('');
  L.push('local Camera: Camera        = workspace.CurrentCamera');
  L.push('local ViewportSize: Vector2 = Camera.ViewportSize');
  L.push('');
  // Cache hot fastcall-dispatched builtins as locals at module scope.
  // Immediate mode redraws every frame, so these lookups are on the hottest path in the script.
  L.push('local MathFloor     = math.floor');
  if (hasSL) L.push('local MathClamp     = math.clamp');
  if (hasSL) L.push('local MathRound     = math.round');
  if (hasKB) L.push('local TableFind     = table.find');
  L.push('local V2new         = Vector2.new');
  L.push('local DI            = DrawingImmediate');
  L.push('local DI_FRect      = DrawingImmediate.FilledRectangle');
  L.push('local DI_Rect       = DrawingImmediate.Rectangle');
  L.push('local DI_FCircle    = DrawingImmediate.FilledCircle');
  L.push('local DI_Circle     = DrawingImmediate.Circle');
  L.push('local DI_FTriangle  = DrawingImmediate.FilledTriangle');
  L.push('local DI_Triangle   = DrawingImmediate.Triangle');
  L.push('local DI_Line       = DrawingImmediate.Line');
  L.push('local DI_Polyline   = DrawingImmediate.Polyline');
  L.push('local DI_Text       = DrawingImmediate.Text');
  L.push('local DI_OText      = DrawingImmediate.OutlinedText');
  // Only localize DrawingImmediate.Image when the project actually uses an Image
  // element or an image-button — otherwise it's an unused (and possibly nil) local.
  const usesImage = sorted.some(e => e.type === 'Image' || (e.type === 'Button' && e.imageUrl && e.imageUrl.trim()));
  if (usesImage) L.push('local DI_Image      = DrawingImmediate.Image');
  L.push('local DI_GetBounds  = DrawingImmediate.GetTextBounds');
  L.push('');
  L.push('-- Truncate text so its rendered width fits maxW pixels.');
  L.push('-- Uses DrawingImmediate.GetTextBounds when font is known, falls back to');
  L.push('-- a cheap character-width estimate when the default font is used (nil).');
  L.push('-- Binary search → O(log n) GetTextBounds calls in the overflow path.');
  L.push('local function DI_FitText(text: string, size: number, font: string?, maxW: number): string');
  L.push('    if font and DI_GetBounds then');
  L.push('        if DI_GetBounds(font, size, text).X <= maxW then return text end');
  L.push('        local lo: number, hi: number = 0, #text');
  L.push('        while lo < hi do');
  L.push('            local mid: number = (lo + hi + 1) // 2');
  L.push('            if DI_GetBounds(font, size, string.sub(text, 1, mid) .. "...").X <= maxW then');
  L.push('                lo = mid');
  L.push('            else');
  L.push('                hi = mid - 1');
  L.push('            end');
  L.push('        end');
  L.push('        return if lo == 0 then "..." else string.sub(text, 1, lo) .. "..."');
  L.push('    else');
  L.push('        local maxChars: number = math.floor(maxW / (size * 0.55))');
  L.push('        if #text <= maxChars then return text end');
  L.push('        return string.sub(text, 1, math.max(1, maxChars - 3)) .. "..."');
  L.push('    end');
  L.push('end');
  L.push('');
  if (hasSL) {
    L.push('-- Format a slider value for display: integers render bare, floats use %g to');
    L.push('-- trim trailing zeros (at most 6 significant digits).');
    L.push('local function _FmtNum(v: number): string');
    L.push('    if v == MathFloor(v) then return tostring(MathFloor(v)) end');
    L.push('    return string.format("%g", v)');
    L.push('end');
    L.push('');
  }

  // Center UI on viewport: runtime offset applied to every cached position
  if (centerOn) {
    L.push('-- Center UI on viewport: shift every position by this offset');
    L.push(`local _OFF: Vector2 = Vector2.new(math.floor((ViewportSize.X - ${designW}) / 2), math.floor((ViewportSize.Y - ${designH}) / 2))`);
    L.push('');
  }

  // Emit pre-cached constants
  for (const line of cacheLines) L.push(line);
  if (cacheLines.length) L.push('');

  // ── IIFE ──────────────────────────────────────────────────────
  L.push(';(function(): ()');
  L.push('');
  L.push('local E = {} -- widget state and draggable positions');
  if (needsDestroy) {
    L.push('');
    L.push('-- DestroyUI: track every Connect so it can be disconnected on demand.');
    L.push('local _Destroyed: boolean = false');
    L.push('local _Conns: {RBXScriptConnection} = table.create(3)');
  }
  L.push('');

  // ── E table ── state only, no Drawing.new ─────────────────────
  for (const el of sorted) {
    const v = vn(el);
    const b = bounds(el);
    switch (el.type) {
      case 'Square':
        if (el.draggable) {
          const posRhs = centerOn
            ? `_OFF + Vector2.new(${Math.round(b.x)}, ${Math.round(b.y)})`
            : `Vector2.new(${Math.round(b.x)}, ${Math.round(b.y)})`;
          L.push(`E.${v}Pos  = ${posRhs}`);
          L.push(`E.${v}Size = Vector2.new(${Math.round(el.w)}, ${Math.round(el.h)})`);
        }
        break;
      case 'Text': {
        const dsrc = el.dynamicSource || '';
        if (dsrc !== '') {
          L.push(`E.${v}Text = ""`);
          // Prev-value cache so PreLocal can skip rebuilds when the value
          // hasn't changed. Sentinels chosen so the first tick always writes.
          if (dsrc === 'tabName' || dsrc === 'clock' || dsrc === 'runtime') {
            L.push(`E.${v}_Prev = -1`);
          } else if (dsrc === 'custom' && (el.dynamicExpr || '').trim()) {
            L.push(`E.${v}_Prev = ""`);
          }
          // keybind: source reads E.<kv>DisplayText directly — no prev cache.
          // playerName is written below once at init.
        }
        break;
      }
      case 'Checkbox':
        L.push(`E.${v}Checked = ${!!el.defaultChecked}`);
        break;
      case 'Keybind': {
        const kbAct = el.action || 'CustomFunction';
        const kbEvt = kbAct === 'CustomFunction';
        L.push(`E.${v}Key         = "${el.defaultKey || 'Insert'}"`);
        L.push(`E.${v}Waiting     = false`);
        L.push(`E.${v}WaitReady   = false`);
        L.push(`E.${v}DisplayText = "[${el.defaultKey || 'Insert'}]"`);
        if (kbEvt) L.push(`E.${v}Fired       = false`);
        break;
      }
      case 'Dropdown': {
        const opts   = (el.options || 'Option 1').split(',').map(o => o.trim());
        const defIdx = Math.max(0, Math.min(opts.length - 1, el.defaultIndex || 0));
        const isDynDD = !!(el.dynamicOptions && el.dynamicOptions.trim());
        // autoSelectDefault: dispatch the callback once at startup with the
        // default selection. Only meaningful for static dropdowns.
        const autoSel = !!el.autoSelectDefault && !isDynDD;
        L.push(`E.${v}Selected = "${opts[defIdx]}"`);
        L.push(`E.${v}Options  = { ${opts.map(o => `"${o.replace(/"/g, '\\"')}"`).join(', ')} }`);
        L.push(`E.${v}Open     = false`);
        if (isDynDD) L.push(`E.${v}SlotCount = 0`);
        L.push(`E.${v}Fired    = ${autoSel}`);
        L.push(`E.${v}FiredIdx = ${autoSel ? defIdx + 1 : 0}`);
        break;
      }
      case 'Slider':
        L.push(`E.${v}Value     = ${el.curVal || 0}`);
        L.push(`E.${v}Dragging  = false`);
        L.push(`E.${v}LabelText = "${el.curVal || 0}${el.suffix || ''}"`);
        L.push(`E.${v}FillW     = 0`);  // pre-computed in PreLocal, consumed by Render
        L.push(`E.${v}Fired     = false`);
        // Previous Value cached so per-frame PreLocal only rebuilds LabelText on change.
        L.push(`E.${v}_LabelPrev = ${el.curVal || 0}`);
        break;
      case 'Button': {
        const btAct = el.action || 'CustomFunction';
        const btEvt = btAct === 'CustomFunction' && !el.toggleMode;
        if (el.toggleMode) L.push(`E.${v}Toggled = false`);
        L.push(`E.${v}Hover   = false`);   // pre-computed hover flag
        L.push(`E.${v}BgColor = ${cachedColors.get(el.color)}`);  // pre-computed fill color
        if (btEvt) L.push(`E.${v}Fired   = false`);
        break;
      }
      case 'Switch': {
        // Pre-compute TrackColor + KnobX from defaultEnabled so the first frame
        // doesn't need to wait on PreLocal to populate. PreLocal then keeps them
        // in sync with E.<v>Enabled on every toggle.
        const swKnobSize = el.h - 4;
        const swKnobOn   = el.w - swKnobSize - 2;
        const swKnobOff  = 2;
        const cInitOn    = cachedColors.get(el.onColor || '#4d90ff');
        const cInitOff   = cachedColors.get(el.color);
        const initC      = el.defaultEnabled ? cInitOn : cInitOff;
        const initX      = el.defaultEnabled ? swKnobOn : swKnobOff;
        L.push(`E.${v}Enabled    = ${!!el.defaultEnabled}`);
        L.push(`E.${v}TrackColor = ${initC}`);
        L.push(`E.${v}KnobX      = ${initX}`);
        break;
      }
    }
  }

  if (hasDrag) {
    L.push('');
    for (const el of draggables) {
      const v = vn(el);
      L.push(`E.${v}DragActive     = false`);
      L.push(`E.${v}DragStartMouse = Vector2.new(0, 0)`);
      L.push(`E.${v}DragStartPos   = Vector2.new(0, 0)`);
    }
  }
  L.push('');

  // ── UIVisible / ActiveTab ─────────────────────────────────────
  if (hasToggleUI) { L.push('local UIVisible: boolean = true'); L.push(''); }

  // ── SetTab (one-liner — no .Visible writes needed) ───────────
  if (multiTab) {
    L.push('local ActiveTab: number = 1');
    L.push('');
    L.push('local function SetTab(n: number): ()');
    L.push('    ActiveTab = n');
    L.push('end');
    L.push('');
  }

  if (needsTabNames) {
    const names = S.tabs.map(t => `"${t.name.replace(/"/g, '\\"')}"`).join(', ');
    L.push(`local TabNames: {string} = { ${names} }`);
    L.push('');
  }

  // ── init block (minimal) ──────────────────────────────────────
  L.push('do');
  if (multiTab) L.push('    SetTab(1)');
  for (const el of sorted.filter(e => e.type === 'Slider')) {
    const v = vn(el);
    L.push(`    E.${v}LabelText = _FmtNum(E.${v}Value) .. "${el.suffix || ''}"`);
  }
  // Keybind DisplayText is already populated with "[<defaultKey>]" at the per-element
  // init step above — no additional concat needed here.
  //
  // Dynamic-text session-constants: playerName is read once here. Per-frame
  // PreLocal skips these elements entirely.
  {
    let wrotePlayerName = false;
    for (const el of dynTextEls) {
      if ((el.dynamicSource || '') !== 'playerName') continue;
      if (!wrotePlayerName) {
        L.push(`    local _PlayerName: string = game.Players.LocalPlayer.Name`);
        wrotePlayerName = true;
      }
      L.push(`    E.${vn(el)}Text = _PlayerName`);
    }
  }
  L.push('end');
  L.push('');

  // ── Runtime block ─────────────────────────────────────────────
  L.push('do');
  if (hasRuntimeText) L.push('    local _T0: number = 0');
  if (needsInteractive) {
    L.push('    local PrevLeftPressed: boolean = false');
    if (hasKB) L.push('    local PrevKeys: {string} = {}');
    L.push('');
  }

  if (needsInput) {
    // ── _DestroyUI (defined BEFORE connects so they close over it) ──
    if (needsDestroy) {
      emitDestroyUIImmediate(L);
      L.push('');
    }

    // ── Callback stubs ───────────────────────────────────────────
    for (const el of sorted.filter(e => UI_TYPES.has(e.type))) {
      const v       = vn(el);
      const kbAct   = el.action || 'CustomFunction';
      const isTogUI    = el.type === 'Keybind' && kbAct === 'ToggleUI';
      const isDestroy  = (el.type === 'Keybind' || el.type === 'Button') && kbAct === 'DestroyUI';
      const isSwTab    = (el.type === 'Keybind' || el.type === 'Button') && kbAct.startsWith('switchTab:');
      const isTgtKB    = el.type === 'Keybind' && kbAct.startsWith('toggleTarget:');
      if (isTogUI || isDestroy || isSwTab || isTgtKB) continue;
      const bodyInPost = el.type === 'Checkbox'
                     || el.type === 'Switch'
                     || (el.type === 'Button' && el.toggleMode);
      let sig = '';
      if (el.type === 'Checkbox')  sig = 'state: boolean';
      if (el.type === 'Keybind')   sig = 'key: string';
      if (el.type === 'Dropdown')  sig = 'selected: string, index: number';
      if (el.type === 'Slider')    sig = 'value: number';
      if (el.type === 'Button')    sig = el.toggleMode ? 'state: boolean' : '';
      if (el.type === 'Switch')    sig = 'state: boolean';
      L.push(`    local function On${v}${el.callback}(${sig}): ()`);
      const body = bodyInPost ? '' : (el.callbackBody || '').trimEnd();
      if (body.trim()) {
        for (const line of body.split('\n')) L.push(`        ${line}`);
      } else {
        L.push(`        `);
      }
      L.push(`    end`);
      L.push('');
    }

    // ── PreLocal ──────────────────────────────────────────────────
    L.push(`${connPre}RunService.PreLocal:Connect(function()`);
    L.push('        if not isrbxactive() then return end  -- short-circuit when Roblox unfocused');
    L.push('        local Mouse: Vector2       = UserInputService:GetMouseLocation()');
    L.push('        local LeftPressed: boolean = isleftpressed()');
    L.push('        local LeftClicked: boolean = LeftPressed and not PrevLeftPressed');
    if (hasKB) L.push('        local Keys: {string}      = getpressedkeys()');
    L.push('');

    // Helper: get position expression for an element in PreLocal hit-testing
    const hitPosExpr = (el) => {
      if (isDragChild(el)) {
        const par = dragParent(el);
        const pb  = bounds(par);
        const b2  = bounds(el);
        const ox  = Math.round(b2.x) - Math.round(pb.x);
        const oy  = Math.round(b2.y) - Math.round(pb.y);
        return `E.${vn(par)}Pos + Vector2.new(${ox}, ${oy})`;
      }
      const b2 = bounds(el);
      return cachedV2Pos.get(`${Math.round(b2.x)},${Math.round(b2.y)}`);
    };

    // Checkboxes
    for (const el of sorted.filter(e => e.type === 'Checkbox')) {
      const v  = vn(el);
      const tg = (multiTab && !el.shared) ? `ActiveTab == ${tabIdx(el)} and ` : '';
      const posExpr = hitPosExpr(el);
      L.push(`        if ${tg}LeftClicked then`);
      L.push(`            local _Pos = ${posExpr}`);
      L.push(`            if Mouse.X >= _Pos.X and Mouse.X <= _Pos.X + ${el.w}`);
      L.push(`            and Mouse.Y >= _Pos.Y and Mouse.Y <= _Pos.Y + ${el.h} then`);
      if (el.exclusiveGroup) {
        // uncheck others in same group — peer bodies run via PostLocal poll off
        // their own E.<v>Checked state, so no dispatch needed here.
        const peers = sorted.filter(e => e.type === 'Checkbox' && e.id !== el.id && e.exclusiveGroup === el.exclusiveGroup);
        for (const p of peers) L.push(`                E.${vn(p)}Checked = false`);
        L.push(`                E.${v}Checked = true`);
      } else {
        L.push(`                E.${v}Checked = not E.${v}Checked`);
      }
      L.push(`            end`);
      L.push(`        end`);
      L.push('');
    }

    // Switches — click hit-test only. Render-state (TrackColor + KnobX) is
    // recomputed in the per-frame precompute block below so a single E.Enabled
    // bool drives both visual states with zero per-frame allocation.
    for (const el of sorted.filter(e => e.type === 'Switch')) {
      const v       = vn(el);
      const tg      = (multiTab && !el.shared) ? `ActiveTab == ${tabIdx(el)} and ` : '';
      const posExpr = hitPosExpr(el);
      L.push(`        if ${tg}LeftClicked then`);
      L.push(`            local _Pos = ${posExpr}`);
      L.push(`            if Mouse.X >= _Pos.X and Mouse.X <= _Pos.X + ${el.w}`);
      L.push(`            and Mouse.Y >= _Pos.Y and Mouse.Y <= _Pos.Y + ${el.h} then`);
      if (el.exclusiveGroup) {
        const peers = sorted.filter(e => e.type === 'Switch' && e.id !== el.id && e.exclusiveGroup === el.exclusiveGroup);
        for (const p of peers) L.push(`                E.${vn(p)}Enabled = false`);
        L.push(`                E.${v}Enabled = true`);
      } else {
        L.push(`                E.${v}Enabled = not E.${v}Enabled`);
      }
      L.push(`            end`);
      L.push(`        end`);
      L.push('');
    }

    // Keybinds
    for (const el of sorted.filter(e => e.type === 'Keybind')) {
      const v        = vn(el);
      const kbAct    = el.action || 'CustomFunction';
      const isTogUI  = kbAct === 'ToggleUI';
      const isDestroyUI = kbAct === 'DestroyUI';
      const isKbSwTab = kbAct.startsWith('switchTab:');
      const isToggleTgt = kbAct.startsWith('toggleTarget:');
      const tgtId    = isToggleTgt ? kbAct.slice('toggleTarget:'.length) : null;
      const tgt      = tgtId ? sorted.find(e => e.id === tgtId) : null;
      const kbSwTabIdx = isKbSwTab ? S.tabs.findIndex(t => t.id === kbAct.slice('switchTab:'.length)) + 1 : 0;
      const tg       = (multiTab && !el.shared && !isTogUI && !isDestroyUI && !isKbSwTab && !isToggleTgt) ? `ActiveTab == ${tabIdx(el)} and ` : '';
      const clickTg  = (multiTab && !el.shared) ? `ActiveTab == ${tabIdx(el)} and ` : '';
      const posExpr  = hitPosExpr(el);
      L.push(`        if E.${v}Waiting then`);
      L.push(`            if E.${v}WaitReady then`);
      L.push(`                local Pressed: {string} = getpressedkeys()`);
      L.push(`                if #Pressed > 0 then`);
      L.push(`                    E.${v}Key         = Pressed[1]`);
      L.push(`                    E.${v}Waiting     = false`);
      L.push(`                    E.${v}WaitReady   = false`);
      // Rebuild DisplayText once on capture — the only allocation site.
      L.push(`                    E.${v}DisplayText = "[" .. Pressed[1] .. "]"`);
      if (!isTogUI && !isDestroyUI && !isKbSwTab && !isToggleTgt) L.push(`                    E.${v}Fired       = true`);
      L.push(`                end`);
      L.push(`            elseif not LeftPressed then`);
      L.push(`                E.${v}WaitReady = true`);
      L.push(`            end`);
      L.push(`        else`);
      L.push(`            if ${clickTg}LeftClicked then`);
      L.push(`                local _Pos = ${posExpr}`);
      L.push(`                if Mouse.X >= _Pos.X and Mouse.X <= _Pos.X + ${el.w}`);
      L.push(`                and Mouse.Y >= _Pos.Y and Mouse.Y <= _Pos.Y + ${el.h} then`);
      L.push(`                    E.${v}Waiting     = true`);
      L.push(`                    E.${v}WaitReady   = false`);
      // Swap to placeholder literal — interned, zero allocation.
      L.push(`                    E.${v}DisplayText = "[...]"`);
      L.push(`                end`);
      L.push(`            end`);
      // Skip the dispatch guard entirely when a toggleTarget's target is dead —
      // avoids one TableFind fastcall per frame for a no-op keybind.
      const toggleTgtValid = isToggleTgt && (
        (tgt && tgt.type === 'Checkbox') ||
        (tgt && tgt.type === 'Switch') ||
        (tgt && tgt.type === 'Button' && tgt.toggleMode)
      );
      const emitDispatch = !isToggleTgt || toggleTgtValid;
      if (emitDispatch) {
        L.push(`            if ${tg}TableFind(Keys, E.${v}Key) and not TableFind(PrevKeys, E.${v}Key) then`);
        if (isTogUI) {
          L.push(`                UIVisible = not UIVisible`);
        } else if (isDestroyUI) {
          // DestroyUI: disconnect everything and stop. Idempotent.
          L.push(`                _DestroyUI()`);
          L.push(`                return`);
        } else if (isKbSwTab) {
          L.push(`                SetTab(${kbSwTabIdx || 1})`);
        } else if (isToggleTgt) {
          // toggleTarget flips another widget's state inline so Render sees it this frame.
          // Pure field writes — no allocation, no closure, no table build.
          if (tgt.type === 'Checkbox') {
            const tv = vn(tgt);
            L.push(`                E.${tv}Checked = not E.${tv}Checked`);
            if (tgt.exclusiveGroup) {
              const peers = sorted.filter(pe =>
                pe.type === 'Checkbox' && pe.id !== tgt.id && pe.exclusiveGroup === tgt.exclusiveGroup
              );
              if (peers.length) {
                // Unrolled at codegen time — no runtime loop, no iterator alloc.
                L.push(`                if E.${tv}Checked then`);
                for (const peer of peers) L.push(`                    E.${vn(peer)}Checked = false`);
                L.push(`                end`);
              }
            }
          } else if (tgt.type === 'Switch') {
            // Immediate Switch only needs the Enabled flag flipped — the per-frame
            // precompute will recompute TrackColor + KnobX automatically next tick.
            const tv = vn(tgt);
            L.push(`                E.${tv}Enabled = not E.${tv}Enabled`);
            if (tgt.exclusiveGroup) {
              const peers = sorted.filter(pe =>
                pe.type === 'Switch' && pe.id !== tgt.id && pe.exclusiveGroup === tgt.exclusiveGroup
              );
              if (peers.length) {
                L.push(`                if E.${tv}Enabled then`);
                for (const peer of peers) L.push(`                    E.${vn(peer)}Enabled = false`);
                L.push(`                end`);
              }
            }
          } else {
            L.push(`                E.${vn(tgt)}Toggled = not E.${vn(tgt)}Toggled`);
          }
        } else {
          L.push(`                E.${v}Fired = true`);
        }
        L.push(`            end`);
      }
      L.push(`        end`);
      // DisplayText is event-driven (updated only at the two state-transition
      // sites above), so no per-frame mutation is needed here.
      L.push('');
    }

    // Dropdowns
    for (const el of sorted.filter(e => e.type === 'Dropdown')) {
      const v       = vn(el);
      const opts    = (el.options || 'Option 1').split(',').map(o => o.trim());
      const N       = opts.length;
      const tg      = (multiTab && !el.shared) ? `ActiveTab == ${tabIdx(el)} and ` : '';
      const isDynDD = !!(el.dynamicOptions && el.dynamicOptions.trim());
      const posExpr = hitPosExpr(el);
      L.push(`        if ${tg}LeftClicked then`);
      L.push(`            do`);
      L.push(`                local _BgPos = ${posExpr}`);
      L.push(`                if Mouse.X >= _BgPos.X and Mouse.X <= _BgPos.X + ${el.w}`);
      L.push(`                and Mouse.Y >= _BgPos.Y and Mouse.Y <= _BgPos.Y + ${el.h} then`);
      L.push(`                    E.${v}Open = not E.${v}Open`);
      L.push(`                end`);
      L.push(`            end`);
      L.push(`            if E.${v}Open then`);
      L.push(`                local _BgPos = ${posExpr}`);
      const loopMax = isDynDD ? `E.${v}SlotCount` : N;
      L.push(`                for _i = 1, ${loopMax} do`);
      L.push(`                    local _SlotY: number = _BgPos.Y + ${el.h} * _i`);
      L.push(`                    if Mouse.X >= _BgPos.X and Mouse.X <= _BgPos.X + ${el.w}`);
      L.push(`                    and Mouse.Y >= _SlotY and Mouse.Y < _SlotY + ${el.h} then`);
      if (isDynDD) {
        L.push(`                        E.${v}Selected = tostring(E.${v}Options[_i] or "")`);
      } else {
        L.push(`                        E.${v}Selected = E.${v}Options[_i]`);
      }
      L.push(`                        E.${v}Open     = false`);
      L.push(`                        E.${v}FiredIdx = _i`);
      L.push(`                        E.${v}Fired    = true`);
      L.push(`                        break`);
      L.push(`                    end`);
      L.push(`                end`);
      L.push(`            end`);
      L.push(`        end`);
      if (isDynDD) {
        // Live-refresh options every frame while the dropdown is open.
        L.push(`        if ${tg}E.${v}Open then`);
        L.push(`            local _opts = ${wrapDynOptsExpr(el.dynamicOptions)}`);
        L.push(`            if type(_opts) ~= "table" then _opts = {} end`);
        L.push(`            E.${v}Options   = _opts`);
        L.push(`            E.${v}SlotCount = math.min(#_opts, ${el.maxOptions || 20})`);
        L.push(`        end`);
      }
      L.push('');
    }

    // Sliders
    for (const el of sorted.filter(e => e.type === 'Slider')) {
      const v       = vn(el);
      const b       = bounds(el);
      const step    = el.step && el.step > 0 ? el.step : null;
      const range   = (el.maxVal || 100) - (el.minVal || 0);
      // Compute the quantised/raw slider value — shared by the fire-on-release
      // and live branches below.
      const valExpr = step
        ? `MathFloor((${el.minVal || 0} + _T * ${range}) / ${step} + 0.5) * ${step}`
        : `${el.minVal || 0} + _T * ${range}`;
      const tg      = (multiTab && !el.shared) ? `ActiveTab == ${tabIdx(el)}` : '';
      const posExpr = isDragChild(el)
        ? (() => { const par = dragParent(el); const pb = bounds(par); return `E.${vn(par)}Pos + Vector2.new(${Math.round(b.x - pb.x)}, ${Math.round(b.y - pb.y)})`; })()
        : cachedV2Pos.get(`${Math.round(b.x)},${Math.round(b.y)}`);
      const activeGuard = tg ? `${tg} and (E.${v}Dragging or _InRng)` : `E.${v}Dragging or _InRng`;
      L.push(`        do`);
      L.push(`            local _TkPos  = ${posExpr}`);
      L.push(`            local _InRng: boolean = Mouse.X >= _TkPos.X and Mouse.X <= _TkPos.X + ${el.w}`);
      L.push(`                                and Mouse.Y >= _TkPos.Y - 8 and Mouse.Y <= _TkPos.Y + ${el.h} + 8`);
      if (el.fireOnRelease) {
        L.push(`            if not LeftPressed then`);
        L.push(`                if E.${v}Dragging then`);
        L.push(`                    E.${v}Dragging = false`);
        L.push(`                    E.${v}Fired    = true`);
        L.push(`                end`);
        L.push(`            elseif ${activeGuard} then`);
        L.push(`                E.${v}Dragging = true`);
        L.push(`                local _T: number = MathClamp((Mouse.X - _TkPos.X) / ${el.w}, 0, 1)`);
        L.push(`                E.${v}Value    = ${valExpr}`);
        L.push(`            end`);
      } else {
        L.push(`            if not LeftPressed then`);
        L.push(`                E.${v}Dragging = false`);
        L.push(`            elseif ${activeGuard} then`);
        L.push(`                E.${v}Dragging = true`);
        L.push(`                local _T: number = MathClamp((Mouse.X - _TkPos.X) / ${el.w}, 0, 1)`);
        L.push(`                E.${v}Value    = ${valExpr}`);
        L.push(`                E.${v}Fired    = true`);
        L.push(`            end`);
      }
      // Precompute label text — only rebuild on Value change to avoid
      // per-frame _FmtNum + string concat while the slider is idle.
      L.push(`            if E.${v}Value ~= E.${v}_LabelPrev then`);
      L.push(`                E.${v}LabelText  = _FmtNum(E.${v}Value) .. "${el.suffix || ''}"`);
      L.push(`                E.${v}_LabelPrev = E.${v}Value`);
      L.push(`            end`);
      L.push(`        end`);
      L.push('');
    }

    // Buttons
    for (const el of sorted.filter(e => e.type === 'Button')) {
      const v         = vn(el);
      const b         = bounds(el);
      const kbAct     = el.action || 'CustomFunction';
      const isSwitchTab = kbAct.startsWith('switchTab:');
      const isDestroyBtn = kbAct === 'DestroyUI';
      const switchTabIdx = isSwitchTab ? S.tabs.findIndex(t => t.id === kbAct.slice('switchTab:'.length)) + 1 : 0;
      // Gate clicks purely by visibility (shared → any tab, else its own tab).
      // switchTab/DestroyUI buttons included — a hidden off-tab button must not
      // catch overlapping clicks (e.g. a slider over a hidden Unload button).
      const tg        = (multiTab && !el.shared) ? `ActiveTab == ${tabIdx(el)} and ` : '';
      const posExpr   = isDragChild(el)
        ? (() => { const par = dragParent(el); const pb = bounds(par); return `E.${vn(par)}Pos + Vector2.new(${Math.round(b.x - pb.x)}, ${Math.round(b.y - pb.y)})`; })()
        : cachedV2Pos.get(`${Math.round(b.x)},${Math.round(b.y)}`);
      L.push(`        do`);
      L.push(`            local _BgPos = ${posExpr}`);
      L.push(`            local _Over: boolean = Mouse.X >= _BgPos.X and Mouse.X <= _BgPos.X + ${el.w}`);
      L.push(`                              and Mouse.Y >= _BgPos.Y and Mouse.Y <= _BgPos.Y + ${el.h}`);
      L.push(`            if ${tg}LeftClicked and _Over then`);
      if (isSwitchTab) {
        L.push(`                SetTab(${switchTabIdx || 1})`);
      } else if (isDestroyBtn) {
        L.push(`                _DestroyUI()`);
        L.push(`                return`);
      } else if (el.toggleMode) {
        L.push(`                E.${v}Toggled = not E.${v}Toggled`);
      } else {
        L.push(`                E.${v}Fired   = true`);
      }
      L.push(`            end`);
      L.push(`        end`);
      L.push('');
    }

    // Draggable squares
    for (const el of draggables) {
      const v       = vn(el);
      const b       = bounds(el);
      // Cross-tab parent guard + recursive descendants (so hit-test excludes grandchildren too).
      const _sameTabI = (k) => el.shared || k.shared || ((k.tabId || S.tabs[0].id) === (el.tabId || S.tabs[0].id));
      const uiKids = [];
      {
        const stack = S.els.filter(e => e.parentId === el.id && e.visible && _sameTabI(e));
        const seen  = new Set();
        while (stack.length) {
          const k = stack.shift();
          if (seen.has(k.id)) continue;
          seen.add(k.id);
          if (UI_TYPES.has(k.type)) uiKids.push(k);
          for (const gc of S.els) {
            if (gc.parentId === k.id && gc.visible && _sameTabI(gc) && !seen.has(gc.id)) stack.push(gc);
          }
        }
      }
      const kidHitVar = kid => (kid.type === 'Slider' || kid.type === 'Switch')
        ? `Pos_${vn(kid)}Tk`
        : `Pos_${vn(kid)}Bg`;
      L.push(`        do`);
      L.push(`            local _SqPos:  Vector2 = E.${v}Pos`);
      L.push(`            local _SqSize: Vector2 = E.${v}Size`);
      L.push(`            local _OnSq: boolean = Mouse.X >= _SqPos.X and Mouse.X <= _SqPos.X + _SqSize.X`);
      L.push(`                              and Mouse.Y >= _SqPos.Y and Mouse.Y <= _SqPos.Y + _SqSize.Y`);
      if (uiKids.length) {
        L.push(`            local _OnChild: boolean = false`);
        for (const kid of uiKids) {
          const kv  = vn(kid);
          const kb  = bounds(kid);
          const ox  = Math.round(kb.x) - Math.round(b.x);
          const oy  = Math.round(kb.y) - Math.round(b.y);
          L.push(`            do`);
          L.push(`                local _CP: Vector2 = E.${v}Pos + Vector2.new(${ox}, ${oy})`);
          if (kid.type === 'Slider') {
            L.push(`                if E.${kv}Dragging`);
            L.push(`                or (Mouse.X >= _CP.X and Mouse.X <= _CP.X + ${kid.w}`);
            L.push(`                and Mouse.Y >= _CP.Y - 8 and Mouse.Y <= _CP.Y + ${kid.h} + 8) then`);
          } else {
            L.push(`                if Mouse.X >= _CP.X and Mouse.X <= _CP.X + ${kid.w}`);
            L.push(`                and Mouse.Y >= _CP.Y and Mouse.Y <= _CP.Y + ${kid.h} then`);
          }
          L.push(`                    _OnChild = true`);
          L.push(`                end`);
          L.push(`            end`);
        }
        L.push(`            if LeftPressed and not _OnChild and (E.${v}DragActive or _OnSq) then`);
      } else {
        L.push(`            if LeftPressed and (E.${v}DragActive or _OnSq) then`);
      }
      L.push(`                if not E.${v}DragActive then`);
      L.push(`                    E.${v}DragActive     = true`);
      L.push(`                    E.${v}DragStartMouse = Mouse`);
      L.push(`                    E.${v}DragStartPos   = _SqPos`);
      L.push(`                end`);
      L.push(`            elseif not LeftPressed then`);
      L.push(`                E.${v}DragActive = false`);
      L.push(`            end`);
      // Update position immediately in PreLocal
      L.push(`            if E.${v}DragActive then`);
      L.push(`                E.${v}Pos = E.${v}DragStartPos + (Mouse - E.${v}DragStartMouse)`);
      L.push(`            end`);
      L.push(`        end`);
      L.push('');
    }

    // Dynamic text — all sources cache into E.<v>Text so Render is pure read.
    // Every branch is guarded so the string isn't re-built when the underlying
    // value is unchanged. playerName is session-constant and pre-populated in
    // the init block, so it never appears here.
    if (hasDynText) {
      L.push('');
      for (const el of dynTextEls) {
        const v   = vn(el);
        const src = el.dynamicSource || '';
        if (src.startsWith('keybind:')) {
          const kbId  = src.slice('keybind:'.length);
          const kbEl  = sorted.find(e => e.type === 'Keybind' && e.id === kbId);
          // Reuse the Keybind's cached DisplayText string ref — no per-frame concat.
          if (kbEl) L.push(`        E.${v}Text = E.${vn(kbEl)}DisplayText`);
        } else if (src === 'playerName') {
          // Written once at init; skip here.
        } else if (src === 'tabName') {
          L.push(`        if ActiveTab ~= E.${v}_Prev then`);
          L.push(`            E.${v}Text  = TabNames[ActiveTab] or ""`);
          L.push(`            E.${v}_Prev = ActiveTab`);
          L.push(`        end`);
        } else if (src === 'clock') {
          L.push(`        do`);
          L.push(`            local _sec: number = os.time()`);
          L.push(`            if _sec ~= E.${v}_Prev then`);
          L.push(`                E.${v}Text  = os.date("%H:%M:%S")`);
          L.push(`                E.${v}_Prev = _sec`);
          L.push(`            end`);
          L.push(`        end`);
        } else if (src === 'runtime') {
          L.push(`        do`);
          L.push(`            if _T0 == 0 then _T0 = tick() end`);
          L.push(`            local _sec: number = MathFloor(tick() - _T0)`);
          L.push(`            if _sec ~= E.${v}_Prev then`);
          L.push(`                E.${v}Text  = string.format("%02d:%02d", _sec // 60, _sec % 60)`);
          L.push(`                E.${v}_Prev = _sec`);
          L.push(`            end`);
          L.push(`        end`);
        } else if (src === 'custom' && (el.dynamicExpr || '').trim()) {
          L.push(`        do`);
          L.push(`            local _val: string = tostring(${el.dynamicExpr.trim()})`);
          L.push(`            if _val ~= E.${v}_Prev then`);
          L.push(`                E.${v}Text  = _val`);
          L.push(`                E.${v}_Prev = _val`);
          L.push(`            end`);
          L.push(`        end`);
        }
      }
    }

    // Pre-compute per-frame render state in PreLocal so Render is pure draw calls.
    // (Severe rule: Render must be DRAWING ONLY — no hit-tests, no state mutation.)
    // Buttons: cache hover + final fill color. Sliders: cache fill width.
    // Switches: cache TrackColor + KnobX based on Enabled flag.
    {
      const btns = sorted.filter(e => e.type === 'Button');
      const slds = sorted.filter(e => e.type === 'Slider');
      const sws  = sorted.filter(e => e.type === 'Switch');
      if (btns.length || slds.length || sws.length) L.push('');
      for (const el of btns) {
        const v  = vn(el);
        const b  = bounds(el);
        const cBg  = cachedColors.get(el.color);
        const cHv  = cachedColors.get(el.hoverColor || el.color);
        const cAc  = el.toggleMode ? cachedColors.get(el.activeColor || '#2a5ec4') : null;
        const cTbAc = el.tabActiveColor ? cachedColors.get(el.tabActiveColor) : null;
        const kbAct = el.action || 'CustomFunction';
        const isSwitchTab = kbAct.startsWith('switchTab:');
        const switchTabN  = isSwitchTab ? S.tabs.findIndex(t => t.id === kbAct.slice('switchTab:'.length)) + 1 : 0;
        // resolve button position (same logic as Render renderPos)
        let posExpr;
        if (isDragChild(el)) {
          const par = dragParent(el); const pb = bounds(par);
          const ox  = Math.round(b.x) - Math.round(pb.x);
          const oy  = Math.round(b.y) - Math.round(pb.y);
          posExpr = `E.${vn(par)}Pos + Vector2.new(${ox}, ${oy})`;
        } else if (el.draggable) {
          posExpr = `E.${v}Pos`;
        } else {
          posExpr = cachedV2Pos.get(`${Math.round(b.x)},${Math.round(b.y)}`);
        }
        L.push(`        do`);
        L.push(`            local _p: Vector2 = ${posExpr}`);
        L.push(`            local _ov: boolean = Mouse.X >= _p.X and Mouse.X <= _p.X + ${el.w}`);
        L.push(`                              and Mouse.Y >= _p.Y and Mouse.Y <= _p.Y + ${el.h}`);
        L.push(`            E.${v}Hover = _ov`);
        let colorExpr;
        if (isSwitchTab && cTbAc) {
          colorExpr = `if ActiveTab == ${switchTabN} then ${cTbAc} elseif _ov then ${cHv} else ${cBg}`;
        } else if (el.toggleMode && cAc) {
          colorExpr = `if E.${v}Toggled then ${cAc} elseif _ov then ${cHv} else ${cBg}`;
        } else {
          colorExpr = `if _ov then ${cHv} else ${cBg}`;
        }
        L.push(`            E.${v}BgColor = ${colorExpr}`);
        L.push(`        end`);
      }
      for (const el of slds) {
        const v    = vn(el);
        const minV = el.minVal || 0;
        const maxV = el.maxVal || 100;
        L.push(`        do`);
        L.push(`            local _T: number  = MathClamp((E.${v}Value - ${minV}) / ${maxV - minV}, 0, 1)`);
        L.push(`            E.${v}FillW       = ${el.w} * _T`);
        L.push(`        end`);
      }
      // Switches: pick TrackColor + KnobX from cached Color3 + constant pair via
      // if-expression. Two reads + two writes; no allocation. Cheaper than
      // gating on a _Prev flag for such a small computation.
      for (const el of sws) {
        const v   = vn(el);
        const cOn  = cachedColors.get(el.onColor || '#4d90ff');
        const cOff = cachedColors.get(el.color);
        const swKnobSize = el.h - 4;
        const knobOn  = el.w - swKnobSize - 2;
        const knobOff = 2;
        L.push(`        do`);
        L.push(`            local _en: boolean = E.${v}Enabled`);
        L.push(`            E.${v}TrackColor = if _en then ${cOn} else ${cOff}`);
        L.push(`            E.${v}KnobX      = if _en then ${knobOn} else ${knobOff}`);
        L.push(`        end`);
      }
    }

    if (hasKB) L.push('        PrevKeys        = Keys');
    L.push('        PrevLeftPressed = LeftPressed');
    L.push(connEnd);

    // ── PostLocal: unified event dispatch + every-frame polling bodies ───
    // All user callback bodies (event-driven for Keybind/Dropdown/Slider/Button,
    // polling for Checkbox/Switch/toggle-Button) run here. PreLocal stays pure
    // input + state mutation — user code never interleaves with the input hot path.
    emitPostLocalInteractive(L, sorted, vn, needsDestroy);

    L.push('');
  } // end needsInput

  // ── Render: DrawingImmediate ONLY — pure draw, no state mutation ──
  // Severe rule: Render must only dispatch DrawingImmediate.* calls.
  // Hit-tests, Mouse reads, slider math, and color selection are all pre-computed in
  // PreLocal and cached in E.<name>Hover / E.<name>BgColor / E.<name>FillW / E.<name>DisplayText.
  L.push('    @native');
  L.push('    local function _Render(): ()');
    L.push('        if not isrbxactive() then return end  -- skip draw when unfocused');
    if (hasToggleUI) {
      L.push('        if not UIVisible then return end');
      L.push('');
    }

    // Helper: resolve current position for an element in Render.
    // Text (and any widget using a center anchor) is cached by (b.wx, b.wy), not (b.x, b.y).
    // Keep the lookup key in sync with what `getP(...)` registered during the walk pass.
    const renderPos = (el) => {
      if (isDragChild(el)) {
        const par = dragParent(el);
        const b2  = bounds(el);
        const pb  = bounds(par);
        if (el.type === 'Text') {
          const ax = Math.round(b2.wx != null ? b2.wx : b2.x) - Math.round(pb.x);
          const ay = Math.round(b2.wy != null ? b2.wy : b2.y) - Math.round(pb.y);
          return { expr: `E.${vn(par)}Pos + Vector2.new(${ax}, ${ay})`, isLocal: true };
        }
        const ox  = Math.round(b2.x) - Math.round(pb.x);
        const oy  = Math.round(b2.y) - Math.round(pb.y);
        return { expr: `E.${vn(par)}Pos + Vector2.new(${ox}, ${oy})`, isLocal: true };
      }
      if (el.draggable) return { expr: `E.${vn(el)}Pos`, isLocal: false };
      const b2 = bounds(el);
      const kx = (el.type === 'Text' && b2.wx != null) ? b2.wx : b2.x;
      const ky = (el.type === 'Text' && b2.wy != null) ? b2.wy : b2.y;
      const key = `${Math.round(kx)},${Math.round(ky)}`;
      return { expr: cachedV2Pos.get(key), isLocal: false };
    };

    const fontArg = (el) => {
      const fMap = { 0: 'nil', 1: '"Gotham"', 2: '"JetBrains Mono"', 3: '"Arial"', 4: '"SourceSans"' };
      const f = fMap[el.font] || 'nil';
      return f === 'nil' ? '' : `, ${f}`;
    };
    // Raw font name (or 'nil') for DI_FitText, which needs the naked expression.
    const fontName = (el) => {
      const fMap = { 0: 'nil', 1: '"Gotham"', 2: '"JetBrains Mono"', 3: '"Arial"', 4: '"SourceSans"' };
      return fMap[el.font] || 'nil';
    };

    // Rounded filled-rectangle emulator.
    // DrawingImmediate.FilledRectangle has no rounding param — emulate with 2 rects + 4 corner circles.
    // Call with rounding<=0 for a plain FilledRectangle.
    const emitFilledRect = (ind, posExpr, w, h, colorName, opacity, rounding, hintTag) => {
      const W = Math.round(w), H = Math.round(h);
      const oStr = fn(opacity ?? 1);
      const sFull = getV(W, H, hintTag);
      if (!rounding || rounding <= 0) {
        L.push(`${ind}DI_FRect(${posExpr}, ${sFull}, ${colorName}, ${oStr})`);
        return;
      }
      const r = Math.max(0, Math.min(Math.round(rounding), Math.floor(W / 2), Math.floor(H / 2)));
      if (r <= 0) {
        L.push(`${ind}DI_FRect(${posExpr}, ${sFull}, ${colorName}, ${oStr})`);
        return;
      }
      // Full-pill degenerate cases: when the radius consumes the whole height
      // (or width), the central cross-bar in that axis is zero-size and the two
      // corner circles on that axis coincide. Skip the redundant draws — a pill
      // (the Switch default, h=22 r=11) drops from 6 draw calls to 3.
      const fullPillH = (2 * r >= H);   // horizontal pill — caps at left/right
      const fullPillW = (2 * r >= W);   // vertical pill   — caps at top/bottom
      // central bars (only the non-degenerate ones)
      if (W - 2 * r > 0) {
        const sHoriz = getV(W - 2 * r, H, hintTag + 'H');
        L.push(`${ind}DI_FRect(${posExpr} + Vector2.new(${r}, 0), ${sHoriz}, ${colorName}, ${oStr})`);
      }
      if (H - 2 * r > 0) {
        const sVert = getV(W, H - 2 * r, hintTag + 'V');
        L.push(`${ind}DI_FRect(${posExpr} + Vector2.new(0, ${r}), ${sVert}, ${colorName}, ${oStr})`);
      }
      // corner circles — dedupe coincident centers in the full-pill cases
      L.push(`${ind}DI_FCircle(${posExpr} + Vector2.new(${r}, ${r}), ${r}, ${colorName}, ${oStr})`);
      if (!fullPillW)                 L.push(`${ind}DI_FCircle(${posExpr} + Vector2.new(${W - r}, ${r}), ${r}, ${colorName}, ${oStr})`);
      if (!fullPillH)                 L.push(`${ind}DI_FCircle(${posExpr} + Vector2.new(${r}, ${H - r}), ${r}, ${colorName}, ${oStr})`);
      if (!fullPillW && !fullPillH)   L.push(`${ind}DI_FCircle(${posExpr} + Vector2.new(${W - r}, ${H - r}), ${r}, ${colorName}, ${oStr})`);
    };

    // Emit draw calls in sorted order
    for (const el of sorted) {
      if (!el.visible) continue;   // permanently invisible — skip entirely
      const v   = vn(el);
      const b   = bounds(el);
      const tg  = (multiTab && !el.shared) ? `ActiveTab == ${tabIdx(el)}` : '';

      if (tg) { L.push(`        if ${tg} then`); }
      const ind = tg ? '            ' : '        ';

      switch (el.type) {
        case 'Square': {
          const cName = cachedColors.get(el.color) || getC(el.color, v);
          if (isRotatedSquare(el)) {
            // Rotated square = quad. Filled → 2 FilledTriangles; outline → closed
            // Polyline. Corners come from cached _Q0..3 (static) or parent pos (child).
            const c = quadCorners(el, b);
            let ce;
            if (isDragChild(el)) {
              const par = dragParent(el); const pb = bounds(par); const lv = `_q${v}`;
              L.push(`${ind}local ${lv}: Vector2 = E.${vn(par)}Pos`);
              ce = c.map(p => `${lv} + Vector2.new(${Math.round(p[0] - pb.x)}, ${Math.round(p[1] - pb.y)})`);
            } else {
              ce = c.map(p => cachedV2Pos.get(`${Math.round(p[0])},${Math.round(p[1])}`));
            }
            const o = fn(el.opacity ?? 1);
            if (el.filled) {
              L.push(`${ind}DI_FTriangle(${ce[0]}, ${ce[1]}, ${ce[2]}, ${cName}, ${o})`);
              L.push(`${ind}DI_FTriangle(${ce[0]}, ${ce[2]}, ${ce[3]}, ${cName}, ${o})`);
            } else {
              L.push(`${ind}DI_Polyline({ ${ce[0]}, ${ce[1]}, ${ce[2]}, ${ce[3]}, ${ce[0]} }, ${cName}, ${o}, ${fn(el.thickness || 1)})`);
            }
            break;
          }
          const sName = cachedV2Sizes.get(`${Math.round(el.w)},${Math.round(el.h)}`);
          const rp    = renderPos(el);
          const pExpr = rp.isLocal ? (() => { const lv = `_p${v}`; L.push(`${ind}local ${lv}: Vector2 = ${rp.expr}`); return lv; })() : rp.expr;
          if (el.filled) {
            emitFilledRect(ind, pExpr, el.w, el.h, cName, el.opacity ?? 1, el.rounding || 0, v);
          } else {
            L.push(`${ind}DI_Rect(${pExpr}, ${sName}, ${cName}, ${fn(el.opacity ?? 1)}, ${fn(el.thickness || 1)})`);
          }
          break;
        }
        case 'Circle': {
          const cName = cachedColors.get(el.color);
          const pName = isDragChild(el)
            ? (() => { const par = dragParent(el); const pb = bounds(par); const lv = `_p${v}`; L.push(`${ind}local ${lv}: Vector2 = E.${vn(par)}Pos + Vector2.new(${Math.round(b.cx - pb.x)}, ${Math.round(b.cy - pb.y)})`); return lv; })()
            : cachedV2Pos.get(`${Math.round(b.cx)},${Math.round(b.cy)}`);
          if (el.filled) {
            L.push(`${ind}DI_FCircle(${pName}, ${fn(el.radius)}, ${cName}, ${fn(el.opacity ?? 1)})`);
          } else {
            L.push(`${ind}DI_Circle(${pName}, ${fn(el.radius)}, ${cName}, ${fn(el.opacity ?? 1)}, ${fn(el.thickness || 1)})`);
          }
          break;
        }
        case 'Triangle': {
          const cName = cachedColors.get(el.color);
          // triPoints == original vertices when rotation == 0 (byte-identical).
          const tp = triPoints(el, b);
          let pA, pB, pC;
          if (isDragChild(el)) {
            const par = dragParent(el); const pb = bounds(par); const pv = vn(par);
            const lv = `_p${v}`;
            L.push(`${ind}local ${lv}: Vector2 = E.${pv}Pos`);
            pA = `${lv} + Vector2.new(${Math.round(tp[0][0] - pb.x)}, ${Math.round(tp[0][1] - pb.y)})`;
            pB = `${lv} + Vector2.new(${Math.round(tp[1][0] - pb.x)}, ${Math.round(tp[1][1] - pb.y)})`;
            pC = `${lv} + Vector2.new(${Math.round(tp[2][0] - pb.x)}, ${Math.round(tp[2][1] - pb.y)})`;
          } else {
            pA = cachedV2Pos.get(`${Math.round(tp[0][0])},${Math.round(tp[0][1])}`);
            pB = cachedV2Pos.get(`${Math.round(tp[1][0])},${Math.round(tp[1][1])}`);
            pC = cachedV2Pos.get(`${Math.round(tp[2][0])},${Math.round(tp[2][1])}`);
          }
          if (el.filled) {
            L.push(`${ind}DI_FTriangle(${pA}, ${pB}, ${pC}, ${cName}, ${fn(el.opacity ?? 1)})`);
          } else {
            L.push(`${ind}DI_Triangle(${pA}, ${pB}, ${pC}, ${cName}, ${fn(el.opacity ?? 1)}, ${fn(el.thickness || 1)})`);
          }
          break;
        }
        case 'Line': {
          const cName = cachedColors.get(el.color);
          let pA, pB;
          if (isDragChild(el)) {
            const par = dragParent(el); const pb = bounds(par); const pv = vn(par);
            const lv = `_p${v}`;
            L.push(`${ind}local ${lv}: Vector2 = E.${pv}Pos`);
            pA = `${lv} + Vector2.new(${Math.round(b.wx1 - pb.x)}, ${Math.round(b.wy1 - pb.y)})`;
            pB = `${lv} + Vector2.new(${Math.round(b.wx2 - pb.x)}, ${Math.round(b.wy2 - pb.y)})`;
          } else {
            pA = cachedV2Pos.get(`${Math.round(b.wx1)},${Math.round(b.wy1)}`);
            pB = cachedV2Pos.get(`${Math.round(b.wx2)},${Math.round(b.wy2)}`);
          }
          L.push(`${ind}DI_Line(${pA}, ${pB}, ${cName}, ${fn(el.opacity ?? 1)}, 1, ${fn(el.thickness || 1)})`);
          break;
        }
        case 'Polyline': {
          const cName = cachedColors.get(el.color);
          let pA, pB;
          if (isDragChild(el)) {
            const par = dragParent(el); const pb = bounds(par); const pv = vn(par);
            const lv = `_p${v}`;
            L.push(`${ind}local ${lv}: Vector2 = E.${pv}Pos`);
            pA = `${lv} + Vector2.new(${Math.round(b.wx1 - pb.x)}, ${Math.round(b.wy1 - pb.y)})`;
            pB = `${lv} + Vector2.new(${Math.round(b.wx2 - pb.x)}, ${Math.round(b.wy2 - pb.y)})`;
          } else {
            pA = cachedV2Pos.get(`${Math.round(b.wx1)},${Math.round(b.wy1)}`);
            pB = cachedV2Pos.get(`${Math.round(b.wx2)},${Math.round(b.wy2)}`);
          }
          L.push(`${ind}DI_Polyline({ ${pA}, ${pB} }, ${cName}, ${fn(el.opacity ?? 1)}, ${fn(el.thickness || 1)})`);
          break;
        }
        case 'Text': {
          const cName = cachedColors.get(el.color);
          const rp    = renderPos(el);
          const pExpr = rp.isLocal ? (() => { const lv = `_p${v}`; L.push(`${ind}local ${lv}: Vector2 = ${rp.expr}`); return lv; })() : rp.expr;
          const src   = el.dynamicSource || '';
          // All dynamic sources cache into E.<v>Text in PreLocal (with change
          // guards). Render just reads the cached ref — no allocations.
          let textExpr;
          if (src && src !== '') {
            textExpr = `E.${v}Text`;
          } else {
            textExpr = `"${(el.text || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
          }
          const fn2 = fontArg(el);
          if (el.outline) {
            L.push(`${ind}DI_OText(${pExpr}, ${el.size || 16}, ${cName}, ${fn(el.opacity ?? 1)}, ${textExpr}, ${el.center ? 'true' : 'false'}${fn2})`);
          } else {
            L.push(`${ind}DI_Text(${pExpr}, ${el.size || 16}, ${cName}, ${fn(el.opacity ?? 1)}, ${textExpr}, ${el.center ? 'true' : 'false'}${fn2})`);
          }
          break;
        }
        case 'Checkbox': {
          const rp    = renderPos(el);
          const pExpr = rp.isLocal ? (() => { const lv = `_p${v}`; L.push(`${ind}local ${lv}: Vector2 = ${rp.expr}`); return lv; })() : rp.expr;
          const pad   = 3;
          const cBg   = cachedColors.get(el.color);
          const cFl   = cachedColors.get(el.checkedColor || '#00ff00');
          const cLb   = cachedColors.get(el.textColor || '#ffffff');
          const sBg   = cachedV2Sizes.get(`${Math.round(el.w)},${Math.round(el.h)}`);
          const sFl   = cachedV2Sizes.get(`${Math.round(el.w - pad*2)},${Math.round(el.h - pad*2)}`);
          const lx    = Math.round(el.w + 6);
          const ly    = Math.round(el.h / 2 - (el.textSize || 16) / 2);
          const fn3   = fontArg({ font: el.font });
          L.push(`${ind}DI_Rect(${pExpr}, ${sBg}, ${cBg}, ${fn(el.opacity ?? 1)}, ${fn(el.thickness || 1)})`);
          L.push(`${ind}if E.${v}Checked then`);
          L.push(`${ind}    DI_FRect(${pExpr} + Vector2.new(${pad}, ${pad}), ${sFl}, ${cFl}, 1)`);
          L.push(`${ind}end`);
          L.push(`${ind}DI_OText(${pExpr} + Vector2.new(${lx}, ${ly}), ${el.textSize || 16}, ${cLb}, ${fn(el.opacity ?? 1)}, "${(el.label || 'Checkbox').replace(/"/g, '\\"')}", false${fn3})`);
          break;
        }
        case 'Keybind': {
          const rp    = renderPos(el);
          const pExpr = rp.isLocal ? (() => { const lv = `_p${v}`; L.push(`${ind}local ${lv}: Vector2 = ${rp.expr}`); return lv; })() : rp.expr;
          const cBg   = cachedColors.get(el.color);
          const cTx   = cachedColors.get(el.textColor || '#ffffff');
          const sBg   = cachedV2Sizes.get(`${Math.round(el.w)},${Math.round(el.h)}`);
          const tx    = Math.round(el.w / 2);
          const ty    = Math.round(el.h / 2 - (el.textSize || 16) / 2);
          const fn3   = fontArg({ font: el.font });
          emitFilledRect(ind, pExpr, el.w, el.h, cBg, el.opacity ?? 1, el.rounding || 0, v + 'Kb');
          L.push(`${ind}DI_OText(${pExpr} + Vector2.new(${tx}, ${ty}), ${el.textSize || 16}, ${cTx}, ${fn(el.opacity ?? 1)}, E.${v}DisplayText, true${fn3})`);
          break;
        }
        case 'Dropdown': {
          const rp      = renderPos(el);
          const pExpr   = rp.isLocal ? (() => { const lv = `_p${v}`; L.push(`${ind}local ${lv}: Vector2 = ${rp.expr}`); return lv; })() : rp.expr;
          const cBg     = cachedColors.get(el.color);
          const cTx     = cachedColors.get(el.textColor || '#ffffff');
          const sBg     = cachedV2Sizes.get(`${Math.round(el.w)},${Math.round(el.h)}`);
          const isDynDD = !!(el.dynamicOptions && el.dynamicOptions.trim());
          const dtx     = 8;
          const dty     = Math.round(el.h / 2 - (el.textSize || 16) / 2);
          const atx     = Math.round(el.w - 16);
          const fn3     = fontArg({ font: el.font });
          const fnN     = fontName({ font: el.font });
          const tsz     = el.textSize || 16;
          const maxHdrW = Math.max(1, el.w - 28);
          const maxOptW = Math.max(1, el.w - 16);
          const lv      = `_dd${v}`;
          L.push(`${ind}local ${lv}: Vector2 = ${pExpr}`);
          emitFilledRect(ind, lv, el.w, el.h, cBg, el.opacity ?? 1, el.rounding || 0, v + 'Dd');
          L.push(`${ind}DI_OText(${lv} + Vector2.new(${dtx}, ${dty}), ${tsz}, ${cTx}, ${fn(el.opacity ?? 1)}, DI_FitText(E.${v}Selected, ${tsz}, ${fnN}, ${maxHdrW}), false${fn3})`);
          L.push(`${ind}DI_OText(${lv} + Vector2.new(${atx}, ${dty}), ${tsz}, ${cTx}, ${fn(el.opacity ?? 1)}, "v", false${fn3})`);
          L.push(`${ind}if E.${v}Open then`);
          const loopMax = isDynDD ? `E.${v}SlotCount` : `#E.${v}Options`;
          L.push(`${ind}    for _i = 1, ${loopMax} do`);
          L.push(`${ind}        local _oy: number = ${lv}.Y + ${el.h} * _i`);
          L.push(`${ind}        DI_FRect(Vector2.new(${lv}.X, _oy), ${sBg}, ${cBg}, ${fn(el.opacity ?? 1)})`);
          L.push(`${ind}        DI_OText(Vector2.new(${lv}.X + ${dtx}, _oy + ${dty}), ${tsz}, ${cTx}, ${fn(el.opacity ?? 1)}, DI_FitText(${isDynDD ? `tostring(E.${v}Options[_i] or "")` : `E.${v}Options[_i]`}, ${tsz}, ${fnN}, ${maxOptW}), false${fn3})`);
          L.push(`${ind}    end`);
          L.push(`${ind}end`);
          break;
        }
        case 'Slider': {
          const rp    = renderPos(el);
          const pExpr = rp.isLocal ? (() => { const lv = `_p${v}`; L.push(`${ind}local ${lv}: Vector2 = ${rp.expr}`); return lv; })() : rp.expr;
          const cTk   = cachedColors.get(el.color);
          const cKn   = cachedColors.get(el.knobColor || '#ffffff');
          const cLb   = cachedColors.get(el.textColor || '#ffffff');
          const sKn   = cachedV2Sizes.get(`10,${Math.round(el.h + 4)}`);
          const fn3   = fontArg({ font: el.font });
          const lbx   = Math.round(el.w / 2);
          const lv    = `_sl${v}`;
          // _FW is pre-computed in PreLocal as E.${v}FillW — Render just reads it.
          L.push(`${ind}local ${lv}: Vector2 = ${pExpr}`);
          L.push(`${ind}local _FW: number    = E.${v}FillW`);
          emitFilledRect(ind, lv, el.w, el.h, cTk, el.opacity ?? 1, el.rounding || 0, v + 'Sl');
          L.push(`${ind}DI_FRect(${lv}, Vector2.new(_FW, ${el.h}), ${cKn}, ${fn(el.opacity ?? 1)})`);
          L.push(`${ind}DI_FRect(Vector2.new(${lv}.X + _FW - 5, ${lv}.Y - 2), ${sKn}, ${cKn}, ${fn(el.opacity ?? 1)})`);
          L.push(`${ind}DI_OText(${lv} + Vector2.new(${lbx}, -16), 14, ${cLb}, ${fn(el.opacity ?? 1)}, DI_FitText(E.${v}LabelText, 14, ${fontName({ font: el.font })}, ${Math.max(1, el.w)}), true${fn3})`);
          break;
        }
        case 'Button': {
          const rp    = renderPos(el);
          const pExpr = rp.isLocal ? (() => { const lv2 = `_p${v}`; L.push(`${ind}local ${lv2}: Vector2 = ${rp.expr}`); return lv2; })() : rp.expr;
          const cTx   = cachedColors.get(el.textColor || '#ffffff');
          const tx    = Math.round(el.w / 2);
          const ty    = Math.round(el.h / 2 - (el.textSize || 16) / 2);
          const fn3   = fontArg({ font: el.font });
          const lv    = `_bt${v}`;
          // BgColor is pre-computed in PreLocal as E.${v}BgColor — Render is pure draw.
          L.push(`${ind}local ${lv}: Vector2 = ${pExpr}`);
          if (el.imageUrl && el.imageUrl.trim()) {
            // Image button: use DI_Image with E.<v>BgColor as tint so hover/toggle
            // still modulate the visual. The image URL string is a literal so it
            // re-uses the interned-string identity each frame — zero allocation.
            // Guarded: if this Severe build lacks DrawingImmediate.Image, fall back
            // to a plain coloured button so the menu still works (and the missing
            // builtin never aborts the whole Render).
            const sBg = cachedV2Sizes.get(`${Math.round(el.w)},${Math.round(el.h)}`);
            const safeUrl = el.imageUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            L.push(`${ind}if DI_Image then`);
            L.push(`${ind}    DI_Image("${safeUrl}", ${lv}, ${sBg}, E.${v}BgColor, ${fn(el.opacity ?? 1)}, false, ${el.rounding || 0})`);
            L.push(`${ind}else`);
            emitFilledRect(ind + '    ', lv, el.w, el.h, `E.${v}BgColor`, el.opacity ?? 1, el.rounding || 0, v + 'Bt');
            L.push(`${ind}end`);
          } else {
            emitFilledRect(ind, lv, el.w, el.h, `E.${v}BgColor`, el.opacity ?? 1, el.rounding || 0, v + 'Bt');
          }
          L.push(`${ind}DI_OText(${lv} + Vector2.new(${tx}, ${ty}), ${el.textSize || 16}, ${cTx}, ${fn(el.opacity ?? 1)}, DI_FitText("${(el.label || 'Button').replace(/"/g, '\\"')}", ${el.textSize || 16}, ${fontName({ font: el.font })}, ${Math.max(1, el.w - 8)}), true${fn3})`);
          break;
        }
        case 'Switch': {
          const rp    = renderPos(el);
          const pExpr = rp.isLocal ? (() => { const lv2 = `_p${v}`; L.push(`${ind}local ${lv2}: Vector2 = ${rp.expr}`); return lv2; })() : rp.expr;
          const cKn   = cachedColors.get(el.knobColor || '#ffffff');
          const cLb   = cachedColors.get(el.textColor || '#ffffff');
          const knobSize = el.h - 4;
          const knobR    = knobSize / 2;
          const lx       = el.w + 8;
          const ly       = Math.round(el.h / 2 - (el.textSize || 16) / 2);
          const fn3      = fontArg({ font: el.font });
          const rounding = el.rounding != null ? el.rounding : Math.floor(el.h / 2);
          const lv       = `_sw${v}`;
          // TrackColor + KnobX precomputed in PreLocal — Render reads cached refs only.
          L.push(`${ind}local ${lv}: Vector2 = ${pExpr}`);
          emitFilledRect(ind, lv, el.w, el.h, `E.${v}TrackColor`, el.opacity ?? 1, rounding, v + 'SwTk');
          L.push(`${ind}DI_FCircle(${lv} + Vector2.new(E.${v}KnobX + ${knobR}, ${2 + knobR}), ${knobR}, ${cKn}, ${fn(el.opacity ?? 1)})`);
          L.push(`${ind}DI_OText(${lv} + Vector2.new(${lx}, ${ly}), ${el.textSize || 16}, ${cLb}, ${fn(el.opacity ?? 1)}, "${(el.label || 'Switch').replace(/"/g, '\\"')}", false${fn3})`);
          break;
        }
        case 'Image': {
          const rp     = renderPos(el);
          const pExpr  = rp.isLocal ? (() => { const lv2 = `_p${v}`; L.push(`${ind}local ${lv2}: Vector2 = ${rp.expr}`); return lv2; })() : rp.expr;
          const sName  = cachedV2Sizes.get(`${Math.round(el.w)},${Math.round(el.h)}`);
          const cName  = cachedColors.get(el.color);
          const safeUrl = (el.url || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          // Image source is an interned string literal — same identity each frame.
          // Guarded: skip silently if DrawingImmediate.Image is unavailable in this
          // build, so a missing builtin can't abort the rest of the Render.
          L.push(`${ind}if DI_Image then DI_Image("${safeUrl}", ${pExpr}, ${sName}, ${cName}, ${fn(el.opacity ?? 1)}, ${!!el.gif}, ${el.rounding || 0}) end`);
          break;
        }
      }

      if (tg) L.push('        end');
    }

  L.push('    end');
  L.push(`${connPre}RunService.Render:Connect(_Render)${needsDestroy ? ')' : ''}`);
  L.push('end');

  L.push('');
  L.push('end)()');
  return L.join('\n');
}

/* ═══════════════════════════════════════════
   DRAWING MODE
═══════════════════════════════════════════ */
function setDrawingMode(val) {
  S.drawingMode = val;
  _codeDirty = true;
  updateModeUI();
  // Image tool + image-button props are Immediate-only \u2014 re-render dependent UI.
  if (typeof updateProps === 'function')  updateProps();
  if (typeof render === 'function')       render();
}

function updateModeUI() {
  const isImmediate = (S.drawingMode || 'static') === 'immediate';
  // Image tool is Immediate-only AND gated by the IMAGE_ENABLED feature flag.
  const imageOn = isImmediate && (typeof IMAGE_ENABLED !== 'undefined' && IMAGE_ENABLED);
  const label = isImmediate ? 'Immediate Mode' : 'Static Mode';
  const widgets = 'Checkbox / Keybind / Dropdown / Slider / Button / Switch'
    + (imageOn ? ' / Image' : '');
  const sbar = document.getElementById('sbar-mode');
  if (sbar) sbar.textContent = `v5 \u00b7 ${label} \u00b7 ${widgets}`;
  const val = S.drawingMode || 'static';
  const sel = document.getElementById('si-drawmode');
  if (sel) sel.value = val;
  const selBar = document.getElementById('si-drawmode-bar');
  if (selBar) selBar.value = val;
  // Show the Image tool button only when the feature is enabled and in Immediate mode.
  const imageBtn = document.querySelector('.tool[data-t="Image"]');
  if (imageBtn) imageBtn.style.display = imageOn ? '' : 'none';
}

/* ═══════════════════════════════════════════
   SETTINGS
═══════════════════════════════════════════ */
function loadSettings() {
  try {
    const s = localStorage.getItem('sevui4_sett');
    if (s) Object.assign(SETTINGS, JSON.parse(s));
  } catch {}
  applySettings();
  syncSettUI();
  updateModeUI();
}

function saveSettings() {
  try { localStorage.setItem('sevui4_sett', JSON.stringify(SETTINGS)); } catch {}
}

function applySettings() {
  const R  = document.documentElement.style;
  const pr = ACCENT_PRESETS[SETTINGS.accent] || ACCENT_PRESETS.blue;

  document.body.style.fontSize = SETTINGS.fontSize + 'px';
  R.setProperty('--f', `'${SETTINGS.font}', monospace`);

  R.setProperty('--acc',     pr.acc);
  R.setProperty('--acc-d',   pr.d);
  R.setProperty('--acc-g',   pr.g);
  R.setProperty('--acc-glo', pr.glo);

  document.getElementById('cvwrap').classList.toggle('no-grid', !SETTINGS.showGrid);
  R.setProperty('--grid-sz', SETTINGS.gridSize + 'px');

  document.body.classList.toggle('compact', SETTINGS.compact);

  // Drive the panel widths through CSS vars so the splitter drag can also update them
  R.setProperty('--lw', SETTINGS.leftWidth  + 'px');
  R.setProperty('--rw', SETTINGS.rightWidth + 'px');
  document.getElementById('left').style.width  = '';
  document.getElementById('right').style.width = '';
}

function syncSettUI() {
  const p = document.getElementById('sett');
  if (!p) return;
  const selOf = (sel, val) => { const s = p.querySelector(sel); if (s) s.value  = val; };
  const chkOf = (sel, val) => { const s = p.querySelector(sel); if (s) s.checked = val; };
  selOf('[onchange*="fontSize"]',   SETTINGS.fontSize);
  selOf('[onchange*="font"]',       SETTINGS.font);
  chkOf('[onchange*="compact"]',           SETTINGS.compact);
  chkOf('[onchange*="showGrid"]',          SETTINGS.showGrid);
  selOf('[onchange*="gridSize"]',          SETTINGS.gridSize);
  selOf('[onchange*="snapDist"]',          SETTINGS.snapDist);
  selOf('[onchange*="leftWidth"]',         SETTINGS.leftWidth);
  selOf('[onchange*="rightWidth"]',        SETTINGS.rightWidth);
  chkOf('[onchange*="centerOnViewport"]',  SETTINGS.centerOnViewport);

  const acc = document.getElementById('saccents');
  if (!acc) return;
  acc.innerHTML = '';
  for (const [key, preset] of Object.entries(ACCENT_PRESETS)) {
    const b = document.createElement('div');
    b.className = 'sacc' + (SETTINGS.accent === key ? ' act' : '');
    b.style.background = preset.acc;
    b.title = key[0].toUpperCase() + key.slice(1);
    b.onclick = () => setSett('accent', key);
    acc.appendChild(b);
  }
  updateModeUI();
}

function setSett(key, val) {
  SETTINGS[key] = val;
  // centerOnViewport changes the emitted Lua
  if (key === 'centerOnViewport') _codeDirty = true;
  saveSettings();
  applySettings();
  syncSettUI();
  if (typeof zFit === 'function') zFit();
  render();
}

function resetSett() {
  Object.assign(SETTINGS, {
    fontSize:12, font:'JetBrains Mono', compact:false,
    showGrid:true, gridSize:24, snapDist:7,
    leftWidth:192, rightWidth:250, accent:'blue',
    centerOnViewport:false,
  });
  _codeDirty = true;
  saveSettings();
  applySettings();
  syncSettUI();
  render();
  toast('Settings reset');
}

function showSett(e) {
  const p   = document.getElementById('sett');
  const btn = e.currentTarget;
  const r   = btn.getBoundingClientRect();
  p.style.top  = (r.bottom + 6) + 'px';
  p.style.left = Math.min(r.left, window.innerWidth - 256) + 'px';
  p.classList.toggle('on');
  if (p.classList.contains('on')) syncSettUI();
}

function hideSett() {
  document.getElementById('sett').classList.remove('on');
}

/* ═══════════════════════════════════════════
   CODE PANEL ACTIONS
═══════════════════════════════════════════ */
function genShow() {
  _codeDirty = true;
  switchTab('c');
}

function copyCode() {
  const ta = document.getElementById('co');
  ta.select();
  document.execCommand('copy');
  toast('Copied!');
}

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
window.addEventListener('load', () => {
  loadSettings();
  initSplitters();
  zFit();
  updateLayers();
  updateProps();
  render();
});

window.addEventListener('resize', zFit);

/* ═══════════════════════════════════════════
   SIDE-PANEL SPLITTERS
   Drag left/right splitter bars to resize the panels.
═══════════════════════════════════════════ */
function initSplitters() {
  // Apply persisted widths to CSS vars
  const rootStyle = document.documentElement.style;
  const lw = (SETTINGS && SETTINGS.leftWidth)  ? SETTINGS.leftWidth  : 192;
  const rw = (SETTINGS && SETTINGS.rightWidth) ? SETTINGS.rightWidth : 250;
  rootStyle.setProperty('--lw', lw + 'px');
  rootStyle.setProperty('--rw', rw + 'px');

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  const bind = (el, side) => {
    if (!el) return;
    el.addEventListener('mousedown', ev => {
      ev.preventDefault();
      el.classList.add('active');
      const startX = ev.clientX;
      const startW = side === 'left'
        ? (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--lw')) || 192)
        : (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--rw')) || 250);
      const onMove = e => {
        const dx = e.clientX - startX;
        const w  = side === 'left'
          ? clamp(startW + dx, 160, 500)
          : clamp(startW - dx, 160, 500);
        rootStyle.setProperty(side === 'left' ? '--lw' : '--rw', w + 'px');
        if (typeof zFit === 'function') zFit();
      };
      const onUp = () => {
        el.classList.remove('active');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
        // Persist
        const finalW = parseInt(getComputedStyle(document.documentElement)
          .getPropertyValue(side === 'left' ? '--lw' : '--rw')) || (side === 'left' ? 192 : 250);
        if (typeof SETTINGS !== 'undefined') {
          SETTINGS[side === 'left' ? 'leftWidth' : 'rightWidth'] = finalW;
          if (typeof saveSettings === 'function') saveSettings();
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  };

  bind(document.getElementById('splitL'), 'left');
  bind(document.getElementById('splitR'), 'right');
}

document.addEventListener('mousedown', e => {
  const p = document.getElementById('sett');
  if (p && p.classList.contains('on') &&
      !p.contains(e.target) &&
      !e.target.closest('[onclick*="showSett"]')) {
    hideSett();
  }
});
