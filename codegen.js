'use strict';

/* ═══════════════════════════════════════════
   HISTORY
═══════════════════════════════════════════ */
function ser() {
  return JSON.stringify({
    tabs:        S.tabs,
    activeTab:   S.activeTab,
    drawingMode: S.drawingMode,
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
}

function undo() {
  if (!S.hist.length) return;
  _codeDirty = true;
  S.fut.push(ser());
  restoreSnap(S.hist.pop());
  S.els.filter(e => e.type === 'Image' && e.url).forEach(loadImg);
  S.sel.clear();
  _lastHit = null;
  updateTabBar(); updateLayers(); updateProps(); render();
  toast('Undo');
}

function redo() {
  if (!S.fut.length) return;
  _codeDirty = true;
  S.hist.push(ser());
  restoreSnap(S.fut.pop());
  S.els.filter(e => e.type === 'Image' && e.url).forEach(loadImg);
  S.sel.clear();
  _lastHit = null;
  updateTabBar(); updateLayers(); updateProps(); render();
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
  updateTabBar(); updateLayers(); updateProps(); render(); updateModeUI();
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
      S.els.filter(e => e.type === 'Image' && e.url).forEach(loadImg);
      updateTabBar(); updateLayers(); updateProps(); render(); updateModeUI();
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
    S.els.filter(e => e.type === 'Image' && e.url).forEach(loadImg);
  }
} catch {}

updateTabBar();

/* ═══════════════════════════════════════════
   TABS / STATUS / TOAST
═══════════════════════════════════════════ */
let _codeDirty = true;

function switchTab(t) {
  document.getElementById('pw').classList.toggle('on', t === 'p');
  document.getElementById('cw').classList.toggle('on', t === 'c');
  document.getElementById('tp').classList.toggle('act', t === 'p');
  document.getElementById('tc').classList.toggle('act', t === 'c');
  if (t === 'c' && _codeDirty) {
    document.getElementById('co').value = genLua();
    _codeDirty = false;
  }
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

function vn(el) {
  const raw = (el.name || el.type).replace(/[^a-zA-Z0-9]/g, ' ').trim();
  return raw
    .split(/\s+/)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join('')
    .replace(/^(\d)/, '_$1');
}

function genLua() {
  if ((S.drawingMode || 'static') === 'immediate') return genLuaImmediate();
  const L          = [];
  const sorted     = sortedEls();
  const hasDrag    = sorted.some(e => e.type === 'Square' && e.draggable);
  const hasCB      = sorted.some(e => e.type === 'Checkbox');
  const hasKB      = sorted.some(e => e.type === 'Keybind');
  const hasDD      = sorted.some(e => e.type === 'Dropdown');
  const hasSL      = sorted.some(e => e.type === 'Slider');
  const hasBT      = sorted.some(e => e.type === 'Button');
  const dynTextEls      = sorted.filter(e => e.type === 'Text' && e.dynamicSource && e.dynamicSource !== '');
  const hasDynText      = dynTextEls.length > 0;
  const needsTabNames   = dynTextEls.some(e => e.dynamicSource === 'tabName');
  const hasRuntimeText  = dynTextEls.some(e => e.dynamicSource === 'runtime');
  const needsInteractive = hasDrag || hasCB || hasKB || hasDD || hasSL || hasBT;
  const needsInput      = needsInteractive || hasDynText;
  const draggables  = sorted.filter(e => e.type === 'Square' && e.draggable);

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
  if (hasSL)            L.push('local MathClamp = math.clamp');
  if (hasSL)            L.push('local MathFloor = math.floor');
  if (hasKB)            L.push('local TableFind = table.find');
  if (hasSL || hasKB)   L.push('');

  // ── IIFE wrapper: one function scope so locals count against it, not the chunk
  //    All Drawing objects and state go in table E — zero local registers per element
  L.push(';(function(): ()');
  L.push('');
  L.push('local E = {} -- holds all Drawing objects and widget state');
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
      case 'Keybind':
        L.push(`E.${v}Background  = Drawing.new("Square")`);
        L.push(`E.${v}Text        = Drawing.new("Text")`);
        L.push(`E.${v}Key         = "${el.defaultKey || 'Insert'}"`);
        L.push(`E.${v}Waiting     = false`);
        L.push(`E.${v}WaitReady   = false`);
        break;
      case 'Dropdown': {
        const opts      = (el.options || 'Option 1').split(',').map(o => o.trim());
        const defIdx    = Math.max(0, Math.min(opts.length - 1, el.defaultIndex || 0));
        const isDynDD   = !!(el.dynamicOptions && el.dynamicOptions.trim());
        const slotCount = isDynDD ? (el.maxOptions || 20) : opts.length;
        L.push(`E.${v}Background = Drawing.new("Square")`);
        L.push(`E.${v}Text       = Drawing.new("Text")`);
        L.push(`E.${v}Arrow      = Drawing.new("Text")`);
        L.push(`E.${v}Selected   = "${opts[defIdx]}"`);
        L.push(`E.${v}Options    = { ${opts.map(o => `"${o}"`).join(', ')} }`);
        L.push(`E.${v}Open       = false`);
        if (isDynDD) L.push(`E.${v}SlotCount = 0`);
        for (let i = 0; i < slotCount; i++) {
          L.push(`E.${v}OptionBackground${i} = Drawing.new("Square")`);
          L.push(`E.${v}OptionText${i}       = Drawing.new("Text")`);
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
        break;
      case 'Button':
        L.push(`E.${v}Background = Drawing.new("Square")`);
        L.push(`E.${v}Text       = Drawing.new("Text")`);
        if (el.toggleMode) L.push(`E.${v}Toggled = false`);
        break;
      default:
        L.push(`E.${v} = Drawing.new("${el.type}")`);
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

  for (const el of sorted) {
    const v       = vn(el);
    const b       = bounds(el);
    const parentEl = el.parentId ? S.els.find(e => e.id === el.parentId) : null;
    const parentZ  = parentEl ? (parentEl.zIndex || 0) : 0;
    const safeZ    = el.parentId
      ? Math.max(el.zIndex || 0, parentZ + 1)
      : (el.zIndex || 0);

    L.push('');

    switch (el.type) {

      case 'Square':
        L.push(`    E.${v}.Position  = ${v2(b.x, b.y)}`);
        L.push(`    E.${v}.Size      = ${v2(el.w, el.h)}`);
        L.push(`    E.${v}.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}.Opacity   = ${fn(el.opacity ?? 1)}`);
        L.push(`    E.${v}.Filled    = ${!!el.filled}`);
        L.push(`    E.${v}.Thickness = ${fn(el.thickness || 1)}`);
        if (el.rounding) L.push(`    E.${v}.Rounding  = ${el.rounding}`);
        L.push(`    E.${v}.ZIndex    = ${safeZ}`);
        L.push(`    E.${v}.Visible   = ${!!el.visible}`);
        break;

      case 'Circle':
        L.push(`    E.${v}.Position  = ${v2(b.cx, b.cy)}`);
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
        L.push(`    E.${v}.Position     = ${v2(b.wx || b.x, b.wy || b.y)}`);
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

      case 'Triangle':
        L.push(`    E.${v}.PointA    = ${v2(b.x + b.w/2, b.y)}`);
        L.push(`    E.${v}.PointB    = ${v2(b.x, b.y + b.h)}`);
        L.push(`    E.${v}.PointC    = ${v2(b.x + b.w, b.y + b.h)}`);
        L.push(`    E.${v}.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}.Opacity   = ${fn(el.opacity ?? 1)}`);
        L.push(`    E.${v}.Filled    = ${!!el.filled}`);
        L.push(`    E.${v}.Thickness = ${fn(el.thickness || 1)}`);
        L.push(`    E.${v}.ZIndex    = ${safeZ}`);
        L.push(`    E.${v}.Visible   = ${!!el.visible}`);
        break;

      case 'Line':
        L.push(`    E.${v}.From      = ${v2(b.wx1, b.wy1)}`);
        L.push(`    E.${v}.To        = ${v2(b.wx2, b.wy2)}`);
        L.push(`    E.${v}.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}.Opacity   = ${fn(el.opacity ?? 1)}`);
        L.push(`    E.${v}.Thickness = ${fn(el.thickness || 1)}`);
        L.push(`    E.${v}.ZIndex    = ${safeZ}`);
        L.push(`    E.${v}.Visible   = ${!!el.visible}`);
        break;

      case 'Polyline':
        L.push(`    E.${v}.Points    = { ${v2(b.wx1, b.wy1)}, ${v2(b.wx2, b.wy2)} }`);
        L.push(`    E.${v}.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}.Opacity   = ${fn(el.opacity ?? 1)}`);
        L.push(`    E.${v}.Filled    = ${!!el.filled}`);
        L.push(`    E.${v}.Thickness = ${fn(el.thickness || 1)}`);
        L.push(`    E.${v}.ZIndex    = ${safeZ}`);
        L.push(`    E.${v}.Visible   = ${!!el.visible}`);
        break;

      case 'Image':
        L.push(`    E.${v}.Position = ${v2(b.x, b.y)}`);
        L.push(`    E.${v}.Size     = ${v2(Math.round(el.w), Math.round(el.h))}`);
        if (el.url) L.push(`    E.${v}.Url      = "${el.url}"`);
        L.push(`    E.${v}.Opacity  = ${fn(el.opacity ?? 1)}`);
        if (el.rounding) L.push(`    E.${v}.Rounding = ${el.rounding}`);
        L.push(`    E.${v}.ZIndex   = ${safeZ}`);
        L.push(`    E.${v}.Visible  = ${!!el.visible}`);
        break;

      case 'Checkbox': {
        const z   = el.zIndex || 0;
        const pad = 3;
        const lx  = Math.round(b.x + el.w + 6);
        const ly  = Math.round(b.y + el.h/2 - (el.textSize || 16)/2);
        const lbl = (el.label || 'Checkbox').replace(/"/g, '\\"');

        L.push(`    E.${v}Background.Position  = ${v2(b.x, b.y)}`);
        L.push(`    E.${v}Background.Size      = ${v2(el.w, el.h)}`);
        L.push(`    E.${v}Background.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}Background.Filled    = true`);
        L.push(`    E.${v}Background.Thickness = ${fn(el.outlineThickness || 1)}`);
        if (el.rounding) L.push(`    E.${v}Background.Rounding  = ${el.rounding}`);
        L.push(`    E.${v}Background.ZIndex    = ${z}`);
        L.push(`    E.${v}Background.Visible   = ${!!el.visible}`);
        L.push('');
        L.push(`    E.${v}Fill.Position  = ${v2(b.x + pad, b.y + pad)}`);
        L.push(`    E.${v}Fill.Size      = ${v2(el.w - pad*2, el.h - pad*2)}`);
        L.push(`    E.${v}Fill.Color     = ${c3(el.checkedColor || '#00ff00')}`);
        L.push(`    E.${v}Fill.Filled    = true`);
        if (el.rounding) L.push(`    E.${v}Fill.Rounding  = ${Math.max(0, el.rounding - 1)}`);
        L.push(`    E.${v}Fill.ZIndex    = ${z + 1}`);
        L.push(`    E.${v}Fill.Visible   = ${!!(el.defaultChecked && el.visible)}`);
        L.push('');
        L.push(`    E.${v}Label.Position     = ${v2(lx, ly)}`);
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
        const z  = el.zIndex || 0;
        const tx = Math.round(b.x + el.w/2);
        const ty = Math.round(b.y + el.h/2 - (el.textSize || 16)/2);

        L.push(`    E.${v}Background.Position  = ${v2(b.x, b.y)}`);
        L.push(`    E.${v}Background.Size      = ${v2(el.w, el.h)}`);
        L.push(`    E.${v}Background.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}Background.Filled    = ${!!el.filled}`);
        L.push(`    E.${v}Background.Thickness = 1`);
        if (el.rounding) L.push(`    E.${v}Background.Rounding  = ${el.rounding}`);
        L.push(`    E.${v}Background.ZIndex    = ${z}`);
        L.push(`    E.${v}Background.Visible   = ${!!el.visible}`);
        L.push('');
        L.push(`    E.${v}Text.Position     = ${v2(tx, ty)}`);
        L.push(`    E.${v}Text.Text         = "[" .. E.${v}Key .. "]"`);
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
        const z    = el.zIndex || 0;
        const opts = (el.options || 'Option 1').split(',').map(o => o.trim());
        const dtx  = Math.round(b.x + 8);
        const dty  = Math.round(b.y + el.h/2 - (el.textSize || 16)/2);
        const atx  = Math.round(b.x + el.w - 16);

        L.push(`    E.${v}Background.Position  = ${v2(b.x, b.y)}`);
        L.push(`    E.${v}Background.Size      = ${v2(el.w, el.h)}`);
        L.push(`    E.${v}Background.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}Background.Filled    = ${!!el.filled}`);
        L.push(`    E.${v}Background.Thickness = ${fn(el.thickness || 1)}`);
        if (el.rounding) L.push(`    E.${v}Background.Rounding  = ${el.rounding}`);
        L.push(`    E.${v}Background.ZIndex    = ${z}`);
        L.push(`    E.${v}Background.Visible   = ${!!el.visible}`);
        L.push('');
        L.push(`    E.${v}Text.Position  = ${v2(dtx, dty)}`);
        L.push(`    E.${v}Text.Text      = E.${v}Selected`);
        L.push(`    E.${v}Text.Size      = ${el.textSize || 16}`);
        L.push(`    E.${v}Text.Font      = ${el.font || 0}`);
        L.push(`    E.${v}Text.Color     = ${c3(el.textColor || '#000000')}`);
        L.push(`    E.${v}Text.Outline   = ${!!el.textOutline}`);
        if (el.textOutline)
          L.push(`    E.${v}Text.OutlineColor = ${outlineV3('#000000')}`);
        L.push(`    E.${v}Text.ZIndex    = ${z + 1}`);
        L.push(`    E.${v}Text.Visible   = ${!!el.visible}`);
        L.push('');
        L.push(`    E.${v}Arrow.Position = ${v2(atx, dty)}`);
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
          L.push(`    E.${v}OptionBackground${i}.Position  = ${v2(b.x, ory)}`);
          L.push(`    E.${v}OptionBackground${i}.Size      = ${v2(el.w, el.h)}`);
          L.push(`    E.${v}OptionBackground${i}.Color     = ${c3(el.color)}`);
          L.push(`    E.${v}OptionBackground${i}.Filled    = true`);
          if (el.rounding) L.push(`    E.${v}OptionBackground${i}.Rounding  = ${el.rounding}`);
          L.push(`    E.${v}OptionBackground${i}.ZIndex    = ${z + 2}`);
          L.push(`    E.${v}OptionBackground${i}.Visible   = false`);
          L.push('');
          L.push(`    E.${v}OptionText${i}.Position  = ${v2(Math.round(b.x + 8), oty)}`);
          L.push(`    E.${v}OptionText${i}.Text      = "${isDynDD3 ? '' : opts[i] || ''}"`);
          L.push(`    E.${v}OptionText${i}.Size      = ${el.textSize || 16}`);
          L.push(`    E.${v}OptionText${i}.Font      = ${el.font || 0}`);
          L.push(`    E.${v}OptionText${i}.Color     = ${c3(el.textColor || '#000000')}`);
          L.push(`    E.${v}OptionText${i}.ZIndex    = ${z + 3}`);
          L.push(`    E.${v}OptionText${i}.Visible   = false`);
        }
        break;
      }

      case 'Slider': {
        const z   = el.zIndex || 0;
        const pct = ((el.curVal || 0) - (el.minVal || 0)) / Math.max(1, (el.maxVal || 100) - (el.minVal || 0));
        const fw  = Math.max(0, el.w * pct);

        L.push(`    E.${v}Track.Position  = ${v2(b.x, b.y)}`);
        L.push(`    E.${v}Track.Size      = ${v2(el.w, el.h)}`);
        L.push(`    E.${v}Track.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}Track.Opacity   = ${fn((el.opacity ?? 1) * 0.3)}`);
        L.push(`    E.${v}Track.Filled    = ${!!el.filled}`);
        if (el.rounding) L.push(`    E.${v}Track.Rounding  = ${el.rounding}`);
        L.push(`    E.${v}Track.ZIndex    = ${z}`);
        L.push(`    E.${v}Track.Visible   = ${!!el.visible}`);
        L.push('');
        L.push(`    E.${v}Fill.Position   = ${v2(b.x, b.y)}`);
        L.push(`    E.${v}Fill.Size       = ${v2(Math.round(fw), el.h)}`);
        L.push(`    E.${v}Fill.Color      = ${c3(el.color)}`);
        L.push(`    E.${v}Fill.Filled     = true`);
        if (el.rounding) L.push(`    E.${v}Fill.Rounding   = ${el.rounding}`);
        L.push(`    E.${v}Fill.ZIndex     = ${z + 1}`);
        L.push(`    E.${v}Fill.Visible    = ${!!el.visible}`);
        L.push('');
        L.push(`    E.${v}Knob.Position   = ${v2(Math.round(b.x + fw - 5), b.y - 2)}`);
        L.push(`    E.${v}Knob.Size       = ${v2(10, el.h + 4)}`);
        L.push(`    E.${v}Knob.Color      = ${c3(el.knobColor || '#ffffff')}`);
        L.push(`    E.${v}Knob.Filled     = true`);
        L.push(`    E.${v}Knob.Rounding   = 2`);
        L.push(`    E.${v}Knob.ZIndex     = ${z + 2}`);
        L.push(`    E.${v}Knob.Visible    = ${!!el.visible}`);
        L.push('');
        L.push(`    E.${v}Label.Position  = ${v2(Math.round(b.x + el.w/2), b.y - 16)}`);
        L.push(`    E.${v}Label.Text      = tostring(E.${v}Value) .. "${el.suffix || ''}"`);
        L.push(`    E.${v}Label.Size      = 11`);
        L.push(`    E.${v}Label.Font      = 0`);
        L.push(`    E.${v}Label.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}Label.Center    = true`);
        L.push(`    E.${v}Label.ZIndex    = ${z + 2}`);
        L.push(`    E.${v}Label.Visible   = ${!!el.visible}`);
        break;
      }

      case 'Button': {
        const z   = el.zIndex || 0;
        const btx = Math.round(b.x + el.w/2);
        const bty = Math.round(b.y + el.h/2 - (el.textSize || 16)/2);
        const lbl = (el.label || 'Button').replace(/"/g, '\\"');

        L.push(`    E.${v}Background.Position  = ${v2(b.x, b.y)}`);
        L.push(`    E.${v}Background.Size      = ${v2(el.w, el.h)}`);
        L.push(`    E.${v}Background.Color     = ${c3(el.color)}`);
        L.push(`    E.${v}Background.Filled    = ${!!el.filled}`);
        L.push(`    E.${v}Background.Thickness = ${fn(el.thickness || 1)}`);
        if (el.rounding) L.push(`    E.${v}Background.Rounding  = ${el.rounding}`);
        L.push(`    E.${v}Background.ZIndex    = ${z}`);
        L.push(`    E.${v}Background.Visible   = ${!!el.visible}`);
        L.push('');
        L.push(`    E.${v}Text.Position     = ${v2(btx, bty)}`);
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
        break;
      }
    }
  }

  if (needsSetTab) L.push('    SetTab(1)');
  L.push('end');

  // ── PreLocal / PostLocal / Render ───────────────────────────
  // Helper: emit dynamic-text assignments (used in PreLocal so memory reads run every game tick)
  const emitDynTextLines = (indent) => {
    for (const el of dynTextEls) {
      const v   = vn(el);
      const src = el.dynamicSource || '';
      if (src.startsWith('keybind:')) {
        const kbEl = sorted.find(e => e.id === src.slice('keybind:'.length));
        if (kbEl) {
          const kv = vn(kbEl);
          L.push(`${indent}E.${v}.Text = if E.${kv}Waiting then "[...]" else "[" .. E.${kv}Key .. "]"`);
        }
      } else if (src === 'playerName') {
        L.push(`${indent}E.${v}.Text = game.Players.LocalPlayer.Name`);
      } else if (src === 'tabName') {
        L.push(`${indent}E.${v}.Text = TabNames[ActiveTab] or ""`);
      } else if (src === 'clock') {
        L.push(`${indent}E.${v}.Text = os.date("%H:%M:%S")`);
      } else if (src === 'runtime') {
        L.push(`${indent}if _T0 == 0 then _T0 = tick() end`);
        L.push(`${indent}E.${v}.Text = string.format("%02d:%02d", math.floor((tick()-_T0)/60), math.floor(tick()-_T0)%60)`);
      } else if (src === 'custom' && (el.dynamicExpr || '').trim()) {
        L.push(`${indent}E.${v}.Text = tostring(${el.dynamicExpr.trim()})`);
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

    // ── callback stubs + PreLocal + PostLocal (interactive elements only) ──
    if (needsInteractive) {
    // ── callback stubs (inside runtime do-block to stay under 200-local limit) ──
    for (const el of sorted.filter(e => UI_TYPES.has(e.type))) {
      const elAct = el.action || 'CustomFunction';
      if (el.type === 'Keybind' && (elAct === 'ToggleUI' || elAct.startsWith('switchTab:'))) continue;
      if (el.type === 'Button'  && elAct.startsWith('switchTab:')) continue;
      const fnName = `On${vn(el)}${el.callback}`;
      let sig = '';
      if (el.type === 'Checkbox') sig = 'state: boolean';
      if (el.type === 'Keybind')  sig = 'key: string';
      if (el.type === 'Dropdown') sig = 'selected: string, index: number';
      if (el.type === 'Slider')   sig = 'value: number';
      if (el.type === 'Button')   sig = el.toggleMode ? 'state: boolean' : '';
      L.push(`    local function ${fnName}(${sig}): ()`);
      // Checkbox and toggle-Button bodies run every frame in PostLocal — stub stays empty
      const bodyInPostLocal = el.type === 'Checkbox' || (el.type === 'Button' && el.toggleMode);
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
    L.push('    RunService.PreLocal:Connect(function()');
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
            L.push(`                    E.${pv}Checked = false`);
            L.push(`                    On${pv}${peer.callback}(false)`);
          }
          L.push(`                end`);
        }
      }
      L.push(`                On${v}${el.callback}(E.${v}Checked)`);
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
          default:
            L.push(`${p}E.${sv}.Visible = UIVisible and ${vis}`);
        }
      }
    };

    for (const el of sorted.filter(e => e.type === 'Keybind')) {
      const v            = vn(el);
      const kbAct        = el.action || 'CustomFunction';
      const isTogUI      = kbAct === 'ToggleUI';
      const isKbSwTab    = kbAct.startsWith('switchTab:');
      const kbSwTabIdx   = isKbSwTab
        ? S.tabs.findIndex(t => t.id === kbAct.slice('switchTab:'.length)) + 1
        : 0;
      // ToggleUI and switchTab keybinds fire from any tab; CustomFunction ones only on their tab
      const tg = (multiTab && !el.shared && !isTogUI && !isKbSwTab) ? `ActiveTab == ${tabIdx(el)} and ` : '';
      const clickTg = (multiTab && !el.shared) ? `ActiveTab == ${tabIdx(el)} and ` : '';
      L.push(`        if E.${v}Waiting then`);
      L.push(`            if E.${v}WaitReady then`);
      L.push(`                local Pressed: {string} = getpressedkeys()`);
      L.push(`                if #Pressed > 0 then`);
      L.push(`                    E.${v}Key       = Pressed[1]`);
      L.push(`                    E.${v}Waiting   = false`);
      L.push(`                    E.${v}WaitReady = false`);
      if (!isTogUI && !isKbSwTab) L.push(`                    On${v}${el.callback}(E.${v}Key)`);
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
      L.push(`                    E.${v}Waiting   = true`);
      L.push(`                    E.${v}WaitReady = false`);
      L.push(`                end`);
      L.push(`            end`);
      L.push(`            if ${tg}TableFind(Keys, E.${v}Key) and not TableFind(PrevKeys, E.${v}Key) then`);
      if (isTogUI) {
        L.push(`                UIVisible = not UIVisible`);
        emitStaticVis(16);
        if (needsSetTab) L.push(`                if UIVisible then SetTab(ActiveTab) end`);
      } else if (isKbSwTab) {
        L.push(`                SetTab(${kbSwTabIdx || 1})`);
      } else {
        L.push(`                On${v}${el.callback}(E.${v}Key)`);
      }
      L.push(`            end`);
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
        L.push(`                    if not E.${v}Open then`);
        L.push(`                        E.${v}Options   = ${el.dynamicOptions.trim()}`);
        L.push(`                        E.${v}SlotCount = math.min(#E.${v}Options, ${slotCnt})`);
        L.push(`                    end`);
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
        L.push(`                        E.${v}Selected = E.${v}Options[_i]`);
        L.push(`                        E.${v}Open     = false`);
        L.push(`                        On${v}${el.callback}(E.${v}Options[_i], _i)`);
        L.push(`                        break`);
        L.push(`                    end`);
        L.push(`                end`);
        L.push(`            end`);
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
          L.push(`                    On${v}${el.callback}("${opts[i]}", ${i + 1})`);
          L.push(`                end`);
          L.push(`            end`);
        }
        L.push(`        end`);
      }
      L.push('');
    }

    for (const el of sorted.filter(e => e.type === 'Slider')) {
      const v    = vn(el);
      const step = el.step && el.step > 1 ? el.step : null;
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
        L.push(`                E.${v}Value         = MathFloor(${el.minVal || 0} + T * (${el.maxVal || 100} - ${el.minVal || 0}))`);
      }
      if (!el.fireOnRelease) {
        L.push(`                On${v}${el.callback}(E.${v}Value)`);
      }
      L.push(`            elseif not LeftPressed then`);
      if (el.fireOnRelease) {
        L.push(`                if E.${v}Dragging then`);
        L.push(`                    On${v}${el.callback}(E.${v}Value)`);
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
      const switchTabIdx = isSwitchTab
        ? S.tabs.findIndex(t => t.id === btAct.slice('switchTab:'.length)) + 1
        : 0;
      // switchTab buttons are shared nav buttons — always clickable; others only on their tab
      const tg = (multiTab && !el.shared && !isSwitchTab) ? `ActiveTab == ${tabIdx(el)} and ` : '';
      L.push(`        do`);
      L.push(`            local Pos  = E.${v}Background.Position`);
      L.push(`            local Size = E.${v}Background.Size`);
      L.push(`            local Over: boolean = Mouse.X >= Pos.X and Mouse.X <= Pos.X + Size.X`);
      L.push(`                              and Mouse.Y >= Pos.Y and Mouse.Y <= Pos.Y + Size.Y`);
      L.push(`            if ${tg}Over and LeftClicked then`);
      if (isSwitchTab) {
        L.push(`                SetTab(${switchTabIdx || 1})`);
      } else if (el.toggleMode) {
        L.push(`                E.${v}Toggled = not E.${v}Toggled`);
        L.push(`                On${v}${el.callback}(E.${v}Toggled)`);
      } else {
        L.push(`                On${v}${el.callback}()`);
      }
      L.push(`            end`);
      L.push(`        end`);
      L.push('');
    }

    for (const el of draggables) {
      const v      = vn(el);
      const b      = bounds(el);
      const uiKids = S.els.filter(e => e.parentId === el.id && e.visible && UI_TYPES.has(e.type));
      const kidHitVar = kid => kid.type === 'Slider' ? `${vn(kid)}Track` : `${vn(kid)}Background`;

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
    L.push('    end)');

    // ── PostLocal: every-frame bodies with wait() throttle ───
    for (const el of sorted.filter(e =>
      (e.type === 'Checkbox' || (e.type === 'Button' && e.toggleMode)) &&
      (e.callbackBody || '').trim()
    )) {
      const v        = vn(el);
      const stateVar = el.type === 'Checkbox' ? `${v}Checked` : `${v}Toggled`;
      L.push('');
      L.push('    do');
      L.push('        local _wt: number = 0');
      L.push('        local function wait(s: number) _wt = os.clock() + s end');
      L.push('        RunService.PostLocal:Connect(function()');
      L.push('            if os.clock() < _wt then return end');
      L.push(`            local state: boolean = E.${stateVar}`);
      for (const line of el.callbackBody.trimEnd().split('\n')) L.push(`            ${line}`);
      L.push('        end)');
      L.push('    end');
    }
    } // end needsInteractive
    L.push('');

    // ── Standalone PreLocal for pure dynamic text (no interactive elements) ──
    if (hasDynText && !needsInteractive) {
      L.push('    RunService.PreLocal:Connect(function()');
      emitDynTextLines('        ');
      L.push('    end)');
      L.push('');
    }

    // ── Render: drawing updates only (only when there are interactive elements) ──
    if (needsInteractive) {
    L.push('    RunService.Render:Connect(function()');
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

    for (const el of sorted.filter(e => e.type === 'Keybind')) {
      const v = vn(el);
      L.push(`        E.${v}Text.Text = if E.${v}Waiting then "[...]" else "[" .. E.${v}Key .. "]"`);
    }
    if (hasKB) L.push('');

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
        L.push(`        do`);
        L.push(`            local _BgPos  = E.${v}Background.Position`);
        L.push(`            local _BgSize = E.${v}Background.Size`);
        L.push(`            E.${v}Text.Text  = E.${v}Selected`);
        L.push(`            E.${v}Arrow.Text = if E.${v}Open then "\u25b2" else "\u25bc"`);
        L.push(`            for _i = 1, ${slotCnt} do`);
        L.push(`                local _show: boolean = ${uiGate}${tabGate}E.${v}Open and _i <= E.${v}SlotCount`);
        L.push(`                E["${v}OptionBackground" .. tostring(_i - 1)].Visible = _show`);
        L.push(`                E["${v}OptionText"       .. tostring(_i - 1)].Visible = _show`);
        L.push(`                if _show then`);
        L.push(`                    E["${v}OptionBackground" .. tostring(_i - 1)].Position = Vector2.new(_BgPos.X, _BgPos.Y + _BgSize.Y * _i)`);
        L.push(`                    E["${v}OptionBackground" .. tostring(_i - 1)].Size     = _BgSize`);
        L.push(`                    E["${v}OptionText"       .. tostring(_i - 1)].Text     = E.${v}Options[_i] or ""`);
        L.push(`                    E["${v}OptionText"       .. tostring(_i - 1)].Position = Vector2.new(_BgPos.X + 6, _BgPos.Y + _BgSize.Y * _i + 4)`);
        L.push(`                end`);
        L.push(`            end`);
        L.push(`        end`);
      } else {
        L.push(`        E.${v}Text.Text  = E.${v}Selected`);
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
      L.push(`            E.${v}Label.Text    = tostring(E.${v}Value) .. "${el.suffix || ''}"`);
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
        const actBg   = el.tabActiveColor   || el.hoverColor || el.color;
        const actText = el.tabActiveTextColor || el.textColor || '#ffffff';
        L.push(`        do`);
        L.push(`            local Pos  = E.${v}Background.Position`);
        L.push(`            local Size = E.${v}Background.Size`);
        L.push(`            local Over:  boolean = Mouse.X >= Pos.X and Mouse.X <= Pos.X + Size.X`);
        L.push(`                              and Mouse.Y >= Pos.Y and Mouse.Y <= Pos.Y + Size.Y`);
        L.push(`            local IsAct: boolean = ActiveTab == ${switchTabIdx}`);
        L.push(`            E.${v}Background.Color = if IsAct then ${c3(actBg)} elseif Over then ${c3(el.hoverColor || el.color)} else ${c3(el.color)}`);
        L.push(`            E.${v}Text.Color       = if IsAct then ${c3(actText)} else ${c3(el.textColor || '#ffffff')}`);
        L.push(`        end`);
      } else if (el.toggleMode) {
        L.push(`        E.${v}Background.Color = if E.${v}Toggled then ${c3(el.activeColor || '#2a5ec4')} else ${c3(el.color)}`);
      } else {
        L.push(`        do`);
        L.push(`            local Pos  = E.${v}Background.Position`);
        L.push(`            local Size = E.${v}Background.Size`);
        L.push(`            local Over: boolean = Mouse.X >= Pos.X and Mouse.X <= Pos.X + Size.X`);
        L.push(`                              and Mouse.Y >= Pos.Y and Mouse.Y <= Pos.Y + Size.Y`);
        L.push(`            E.${v}Background.Color = if Over then ${c3(el.hoverColor || el.color)} else ${c3(el.color)}`);
        L.push(`        end`);
      }
    }
    if (hasBT) L.push('');

    for (const el of draggables) {
      const v       = vn(el);
      const b       = bounds(el);
      const allKids = S.els.filter(e => e.parentId === el.id && e.visible);

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
        } else if (kid.type === 'Circle') {
          const ocx = Math.round(kb.cx) - Math.round(b.x);
          const ocy = Math.round(kb.cy) - Math.round(b.y);
          L.push(`            E.${kv}.Position = NewPos + Vector2.new(${ocx}, ${ocy})`);
        } else if (kid.type === 'Triangle') {
          L.push(`            E.${kv}.PointA = NewPos + Vector2.new(${ox + Math.round(kid.w / 2)}, ${oy})`);
          L.push(`            E.${kv}.PointB = NewPos + Vector2.new(${ox}, ${oy + kid.h})`);
          L.push(`            E.${kv}.PointC = NewPos + Vector2.new(${ox + kid.w}, ${oy + kid.h})`);
        } else if (kid.type === 'Line') {
          const kb2 = bounds(kid);
          const dx2 = Math.round(kb2.wx2) - Math.round(kb2.wx1);
          const dy2 = Math.round(kb2.wy2) - Math.round(kb2.wy1);
          L.push(`            E.${kv}.From = NewPos + Vector2.new(${ox}, ${oy})`);
          L.push(`            E.${kv}.To   = NewPos + Vector2.new(${ox + dx2}, ${oy + dy2})`);
        } else if (kid.type === 'Polyline') {
          const kb2 = bounds(kid);
          const dx2 = Math.round(kb2.wx2) - Math.round(kb2.wx1);
          const dy2 = Math.round(kb2.wy2) - Math.round(kb2.wy1);
          L.push(`            E.${kv}.Points = { NewPos + Vector2.new(${ox}, ${oy}), NewPos + Vector2.new(${ox + dx2}, ${oy + dy2}) }`);
        } else {
          L.push(`            E.${kv}.Position = NewPos + Vector2.new(${ox}, ${oy})`);
        }
      }

      L.push(`        end`);
      L.push('');
    }

    L.push('    end)');
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
  const L      = [];
  const sorted = sortedEls();

  // ── flags (mirrors genLua) ───────────────────────────────────
  const hasDrag    = sorted.some(e => e.type === 'Square' && e.draggable);
  const hasCB      = sorted.some(e => e.type === 'Checkbox');
  const hasKB      = sorted.some(e => e.type === 'Keybind');
  const hasDD      = sorted.some(e => e.type === 'Dropdown');
  const hasSL      = sorted.some(e => e.type === 'Slider');
  const hasBT      = sorted.some(e => e.type === 'Button');
  const dynTextEls     = sorted.filter(e => e.type === 'Text' && e.dynamicSource && e.dynamicSource !== '');
  const hasDynText     = dynTextEls.length > 0;
  const needsTabNames  = dynTextEls.some(e => e.dynamicSource === 'tabName');
  const hasRuntimeText = dynTextEls.some(e => e.dynamicSource === 'runtime');
  const needsInteractive = hasDrag || hasCB || hasKB || hasDD || hasSL || hasBT;
  const needsInput     = needsInteractive || hasDynText;
  const draggables     = sorted.filter(e => e.type === 'Square' && e.draggable);
  const multiTab       = S.tabs.length > 1;
  const tabIdx         = el => Math.max(1, S.tabs.findIndex(t => t.id === el.tabId) + 1 || 1);
  const hasSwitchTabAction = sorted.some(e =>
    (e.type === 'Button' || e.type === 'Keybind') && (e.action || '').startsWith('switchTab:')
  );
  const hasToggleUI  = sorted.some(e => e.type === 'Keybind' && (e.action || 'CustomFunction') === 'ToggleUI');
  const needsMouse   = hasBT || hasDrag || hasSwitchTabAction;

  if (!sorted.length) {
    return ['--!strict', '--!optimize 2', '', 'local RunService = game:GetService("RunService")'].join('\n');
  }

  // ── helpers ───────────────────────────────────────────────────
  const isDragChild = el => {
    if (!el.parentId) return false;
    const par = S.els.find(e => e.id === el.parentId);
    return !!(par && par.type === 'Square' && par.draggable);
  };
  const dragParent = el => S.els.find(e => e.id === el.parentId);

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
      cacheLines.push(`local ${nm}: Vector2 = Vector2.new(${Math.round(x)}, ${Math.round(y)})`);
    }
    return cachedV2Pos.get(key);
  };

  // Walk elements once to register all constants
  for (const el of sorted) {
    const v   = vn(el);
    const b   = bounds(el);
    const idc = isDragChild(el);

    switch (el.type) {
      case 'Square':
        getC(el.color, v);
        getV(el.w, el.h, v);
        if (!idc && !el.draggable) getP(b.x, b.y, v);
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
      case 'Triangle':
        getC(el.color, v);
        if (!idc) {
          getP(b.x + b.w / 2, b.y,       v + 'A');
          getP(b.x,           b.y + b.h,  v + 'B');
          getP(b.x + b.w,     b.y + b.h,  v + 'C');
        }
        break;
      case 'Line':
        getC(el.color, v);
        if (!idc) { getP(b.wx1, b.wy1, v + 'A'); getP(b.wx2, b.wy2, v + 'B'); }
        break;
      case 'Polyline':
        getC(el.color, v);
        if (!idc) { getP(b.wx1, b.wy1, v + 'A'); getP(b.wx2, b.wy2, v + 'B'); }
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
        if (!idc) {
          getP(b.x, b.y, v + 'Bg');
          getP(b.x + Math.round(el.w / 2), b.y + Math.round(el.h / 2 - (el.textSize || 16) / 2), v + 'Tx');
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
  if (hasSL)          L.push('local MathClamp = math.clamp');
  if (hasSL)          L.push('local MathFloor = math.floor');
  if (hasKB)          L.push('local TableFind = table.find');
  if (hasSL || hasKB) L.push('');

  // Emit pre-cached constants
  for (const line of cacheLines) L.push(line);
  if (cacheLines.length) L.push('');

  // ── IIFE ──────────────────────────────────────────────────────
  L.push(';(function(): ()');
  L.push('');
  L.push('local E = {} -- widget state and draggable positions');
  L.push('');

  // ── E table ── state only, no Drawing.new ─────────────────────
  for (const el of sorted) {
    const v = vn(el);
    const b = bounds(el);
    switch (el.type) {
      case 'Square':
        if (el.draggable) {
          L.push(`E.${v}Pos  = Vector2.new(${Math.round(b.x)}, ${Math.round(b.y)})`);
          L.push(`E.${v}Size = Vector2.new(${Math.round(el.w)}, ${Math.round(el.h)})`);
        }
        break;
      case 'Text':
        if (el.dynamicSource && el.dynamicSource !== '') L.push(`E.${v}Text = ""`);
        break;
      case 'Checkbox':
        L.push(`E.${v}Checked = ${!!el.defaultChecked}`);
        break;
      case 'Keybind':
        L.push(`E.${v}Key         = "${el.defaultKey || 'Insert'}"`);
        L.push(`E.${v}Waiting     = false`);
        L.push(`E.${v}WaitReady   = false`);
        L.push(`E.${v}DisplayText = "[${el.defaultKey || 'Insert'}]"`);
        break;
      case 'Dropdown': {
        const opts   = (el.options || 'Option 1').split(',').map(o => o.trim());
        const defIdx = Math.max(0, Math.min(opts.length - 1, el.defaultIndex || 0));
        L.push(`E.${v}Selected = "${opts[defIdx]}"`);
        L.push(`E.${v}Options  = { ${opts.map(o => `"${o.replace(/"/g, '\\"')}"`).join(', ')} }`);
        L.push(`E.${v}Open     = false`);
        if (el.dynamicOptions && el.dynamicOptions.trim()) L.push(`E.${v}SlotCount = 0`);
        break;
      }
      case 'Slider':
        L.push(`E.${v}Value     = ${el.curVal || 0}`);
        L.push(`E.${v}Dragging  = false`);
        L.push(`E.${v}LabelText = "${el.curVal || 0}${el.suffix || ''}"`);
        break;
      case 'Button':
        if (el.toggleMode) L.push(`E.${v}Toggled = false`);
        break;
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
    L.push(`    E.${v}LabelText = tostring(E.${v}Value) .. "${el.suffix || ''}"`);
  }
  for (const el of sorted.filter(e => e.type === 'Keybind')) {
    const v = vn(el);
    L.push(`    E.${v}DisplayText = "[" .. E.${v}Key .. "]"`);
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
    // ── Callback stubs ───────────────────────────────────────────
    for (const el of sorted.filter(e => UI_TYPES.has(e.type))) {
      const v       = vn(el);
      const kbAct   = el.action || 'CustomFunction';
      const isTogUI = el.type === 'Keybind' && kbAct === 'ToggleUI';
      const isSwTab = (el.type === 'Keybind' || el.type === 'Button') && kbAct.startsWith('switchTab:');
      if (isTogUI || isSwTab) continue;
      const bodyInPost = el.type === 'Checkbox' || (el.type === 'Button' && el.toggleMode);
      let sig = '';
      if (el.type === 'Checkbox')  sig = 'state: boolean';
      if (el.type === 'Keybind')   sig = 'key: string';
      if (el.type === 'Dropdown')  sig = 'selected: string, index: number';
      if (el.type === 'Slider')    sig = 'value: number';
      if (el.type === 'Button')    sig = el.toggleMode ? 'state: boolean' : '';
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
    L.push('    RunService.PreLocal:Connect(function()');
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
        // uncheck others in same group
        const peers = sorted.filter(e => e.type === 'Checkbox' && e.id !== el.id && e.exclusiveGroup === el.exclusiveGroup);
        for (const p of peers) L.push(`                E.${vn(p)}Checked = false`);
        L.push(`                if not E.${v}Checked then`);
        L.push(`                    E.${v}Checked = true`);
        L.push(`                    On${v}${el.callback}(true)`);
        L.push(`                end`);
      } else {
        L.push(`                E.${v}Checked = not E.${v}Checked`);
        L.push(`                On${v}${el.callback}(E.${v}Checked)`);
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
      const isKbSwTab = kbAct.startsWith('switchTab:');
      const kbSwTabIdx = isKbSwTab ? S.tabs.findIndex(t => t.id === kbAct.slice('switchTab:'.length)) + 1 : 0;
      const tg       = (multiTab && !el.shared && !isTogUI && !isKbSwTab) ? `ActiveTab == ${tabIdx(el)} and ` : '';
      const clickTg  = (multiTab && !el.shared) ? `ActiveTab == ${tabIdx(el)} and ` : '';
      const posExpr  = hitPosExpr(el);
      L.push(`        if E.${v}Waiting then`);
      L.push(`            if E.${v}WaitReady then`);
      L.push(`                local Pressed: {string} = getpressedkeys()`);
      L.push(`                if #Pressed > 0 then`);
      L.push(`                    E.${v}Key       = Pressed[1]`);
      L.push(`                    E.${v}Waiting   = false`);
      L.push(`                    E.${v}WaitReady = false`);
      if (!isTogUI && !isKbSwTab) L.push(`                    On${v}${el.callback}(E.${v}Key)`);
      L.push(`                end`);
      L.push(`            elseif not LeftPressed then`);
      L.push(`                E.${v}WaitReady = true`);
      L.push(`            end`);
      L.push(`        else`);
      L.push(`            if ${clickTg}LeftClicked then`);
      L.push(`                local _Pos = ${posExpr}`);
      L.push(`                if Mouse.X >= _Pos.X and Mouse.X <= _Pos.X + ${el.w}`);
      L.push(`                and Mouse.Y >= _Pos.Y and Mouse.Y <= _Pos.Y + ${el.h} then`);
      L.push(`                    E.${v}Waiting   = true`);
      L.push(`                    E.${v}WaitReady = false`);
      L.push(`                end`);
      L.push(`            end`);
      L.push(`            if ${tg}TableFind(Keys, E.${v}Key) and not TableFind(PrevKeys, E.${v}Key) then`);
      if (isTogUI) {
        L.push(`                UIVisible = not UIVisible`);
      } else if (isKbSwTab) {
        L.push(`                SetTab(${kbSwTabIdx || 1})`);
      } else {
        L.push(`                On${v}${el.callback}(E.${v}Key)`);
      }
      L.push(`            end`);
      L.push(`        end`);
      // Precompute display text for Render
      L.push(`        E.${v}DisplayText = if E.${v}Waiting then "[...]" else "[" .. E.${v}Key .. "]"`);
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
      if (isDynDD) {
        L.push(`                    if not E.${v}Open then`);
        L.push(`                        E.${v}Options   = ${el.dynamicOptions.trim()}`);
        L.push(`                        E.${v}SlotCount = math.min(#E.${v}Options, ${el.maxOptions || 20})`);
        L.push(`                    end`);
      }
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
      L.push(`                        E.${v}Selected = E.${v}Options[_i]`);
      L.push(`                        E.${v}Open     = false`);
      L.push(`                        On${v}${el.callback}(E.${v}Options[_i], _i)`);
      L.push(`                        break`);
      L.push(`                    end`);
      L.push(`                end`);
      L.push(`            end`);
      L.push(`        end`);
      L.push('');
    }

    // Sliders
    for (const el of sorted.filter(e => e.type === 'Slider')) {
      const v       = vn(el);
      const b       = bounds(el);
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
        L.push(`                    On${v}${el.callback}(E.${v}Value)`);
        L.push(`                end`);
        L.push(`            elseif ${activeGuard} then`);
        L.push(`                E.${v}Dragging = true`);
        L.push(`                local _T: number = MathClamp((Mouse.X - _TkPos.X) / ${el.w}, 0, 1)`);
        L.push(`                E.${v}Value    = MathFloor(${el.minVal || 0} + _T * ${(el.maxVal || 100) - (el.minVal || 0)})`);
        L.push(`            end`);
      } else {
        L.push(`            if not LeftPressed then`);
        L.push(`                E.${v}Dragging = false`);
        L.push(`            elseif ${activeGuard} then`);
        L.push(`                E.${v}Dragging = true`);
        L.push(`                local _T: number = MathClamp((Mouse.X - _TkPos.X) / ${el.w}, 0, 1)`);
        L.push(`                E.${v}Value    = MathFloor(${el.minVal || 0} + _T * ${(el.maxVal || 100) - (el.minVal || 0)})`);
        L.push(`                On${v}${el.callback}(E.${v}Value)`);
        L.push(`            end`);
      }
      // Precompute label text
      L.push(`            E.${v}LabelText = tostring(E.${v}Value) .. "${el.suffix || ''}"`);
      L.push(`        end`);
      L.push('');
    }

    // Buttons
    for (const el of sorted.filter(e => e.type === 'Button')) {
      const v         = vn(el);
      const b         = bounds(el);
      const kbAct     = el.action || 'CustomFunction';
      const isSwitchTab = kbAct.startsWith('switchTab:');
      const switchTabIdx = isSwitchTab ? S.tabs.findIndex(t => t.id === kbAct.slice('switchTab:'.length)) + 1 : 0;
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
      } else if (el.toggleMode) {
        L.push(`                E.${v}Toggled = not E.${v}Toggled`);
        L.push(`                On${v}${el.callback}(E.${v}Toggled)`);
      } else {
        L.push(`                On${v}${el.callback}()`);
      }
      L.push(`            end`);
      L.push(`        end`);
      L.push('');
    }

    // Draggable squares
    for (const el of draggables) {
      const v       = vn(el);
      const b       = bounds(el);
      const uiKids  = S.els.filter(e => e.parentId === el.id && e.visible && UI_TYPES.has(e.type));
      const kidHitVar = kid => kid.type === 'Slider' ? `Pos_${vn(kid)}Tk` : `Pos_${vn(kid)}Bg`;
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

    // Dynamic text
    if (hasDynText) {
      L.push('');
      for (const el of dynTextEls) {
        const v   = vn(el);
        const src = el.dynamicSource || '';
        if (src.startsWith('keybind:')) {
          const kbId  = src.slice('keybind:'.length);
          const kbEl  = sorted.find(e => e.type === 'Keybind' && e.id === kbId);
          if (kbEl) L.push(`        E.${v}Text = "[" .. E.${vn(kbEl)}Key .. "]"`);
        } else if (src === 'playerName') {
          L.push(`        E.${v}Text = game.Players.LocalPlayer.Name`);
        } else if (src === 'tabName') {
          L.push(`        E.${v}Text = TabNames[ActiveTab] or ""`);
        } else if (src === 'custom' && (el.dynamicExpr || '').trim()) {
          L.push(`        E.${v}Text = tostring(${el.dynamicExpr.trim()})`);
        }
        // clock and runtime are safe to compute inline in Render — skip here
      }
    }

    if (hasKB) L.push('        PrevKeys        = Keys');
    L.push('        PrevLeftPressed = LeftPressed');
    L.push('    end)');

    // ── PostLocal: callback bodies for Checkbox / toggle-Button ──
    for (const el of sorted.filter(e =>
      (e.type === 'Checkbox' || (e.type === 'Button' && e.toggleMode)) &&
      (e.callbackBody || '').trim()
    )) {
      const v        = vn(el);
      const stateVar = el.type === 'Checkbox' ? `${v}Checked` : `${v}Toggled`;
      L.push('');
      L.push('    do');
      L.push('        local _wt: number = 0');
      L.push('        local function wait(s: number) _wt = os.clock() + s end');
      L.push('        RunService.PostLocal:Connect(function()');
      L.push('            if os.clock() < _wt then return end');
      L.push(`            local state: boolean = E.${stateVar}`);
      for (const line of el.callbackBody.trimEnd().split('\n')) L.push(`            ${line}`);
      L.push('        end)');
      L.push('    end');
    }

    L.push('');
  } // end needsInput

  // ── Render: DrawingImmediate ONLY — pure draw, no state mutation ──
  L.push('    @native');
  L.push('    local function _Render(): ()');
    if (hasToggleUI) {
      L.push('        if not UIVisible then return end');
      L.push('');
    }
    if (needsMouse) {
      L.push('        local Mouse: Vector2 = UserInputService:GetMouseLocation()');
      L.push('');
    }

    // Helper: resolve current position for an element in Render
    const renderPos = (el) => {
      if (isDragChild(el)) {
        const par = dragParent(el);
        const b2  = bounds(el);
        const pb  = bounds(par);
        const ox  = Math.round(b2.x) - Math.round(pb.x);
        const oy  = Math.round(b2.y) - Math.round(pb.y);
        return { expr: `E.${vn(par)}Pos + Vector2.new(${ox}, ${oy})`, isLocal: true };
      }
      if (el.draggable) return { expr: `E.${vn(el)}Pos`, isLocal: false };
      const b2 = bounds(el);
      const key = `${Math.round(b2.x)},${Math.round(b2.y)}`;
      return { expr: cachedV2Pos.get(key), isLocal: false };
    };

    const fontArg = (el) => {
      const fMap = { 0: 'nil', 1: '"Gotham"', 2: '"JetBrains Mono"', 3: '"Arial"', 4: '"SourceSans"' };
      const f = fMap[el.font] || 'nil';
      return f === 'nil' ? '' : `, ${f}`;
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
          const sName = cachedV2Sizes.get(`${Math.round(el.w)},${Math.round(el.h)}`);
          const rp    = renderPos(el);
          const pExpr = rp.isLocal ? (() => { const lv = `_p${v}`; L.push(`${ind}local ${lv}: Vector2 = ${rp.expr}`); return lv; })() : rp.expr;
          if (el.filled) {
            L.push(`${ind}DrawingImmediate.FilledRectangle(${pExpr}, ${sName}, ${cName}, ${fn(el.opacity ?? 1)})`);
          } else {
            L.push(`${ind}DrawingImmediate.Rectangle(${pExpr}, ${sName}, ${cName}, ${fn(el.opacity ?? 1)}, ${fn(el.thickness || 1)})`);
          }
          break;
        }
        case 'Circle': {
          const cName = cachedColors.get(el.color);
          const pName = isDragChild(el)
            ? (() => { const par = dragParent(el); const pb = bounds(par); const lv = `_p${v}`; L.push(`${ind}local ${lv}: Vector2 = E.${vn(par)}Pos + Vector2.new(${Math.round(b.cx - pb.x)}, ${Math.round(b.cy - pb.y)})`); return lv; })()
            : cachedV2Pos.get(`${Math.round(b.cx)},${Math.round(b.cy)}`);
          if (el.filled) {
            L.push(`${ind}DrawingImmediate.FilledCircle(${pName}, ${fn(el.radius)}, ${cName}, ${fn(el.opacity ?? 1)})`);
          } else {
            L.push(`${ind}DrawingImmediate.Circle(${pName}, ${fn(el.radius)}, ${cName}, ${fn(el.opacity ?? 1)}, ${fn(el.thickness || 1)})`);
          }
          break;
        }
        case 'Triangle': {
          const cName = cachedColors.get(el.color);
          let pA, pB, pC;
          if (isDragChild(el)) {
            const par = dragParent(el); const pb = bounds(par); const pv = vn(par);
            const lv = `_p${v}`;
            L.push(`${ind}local ${lv}: Vector2 = E.${pv}Pos`);
            pA = `${lv} + Vector2.new(${Math.round(b.x + b.w/2 - pb.x)}, ${Math.round(b.y - pb.y)})`;
            pB = `${lv} + Vector2.new(${Math.round(b.x - pb.x)}, ${Math.round(b.y + b.h - pb.y)})`;
            pC = `${lv} + Vector2.new(${Math.round(b.x + b.w - pb.x)}, ${Math.round(b.y + b.h - pb.y)})`;
          } else {
            pA = cachedV2Pos.get(`${Math.round(b.x + b.w/2)},${Math.round(b.y)}`);
            pB = cachedV2Pos.get(`${Math.round(b.x)},${Math.round(b.y + b.h)}`);
            pC = cachedV2Pos.get(`${Math.round(b.x + b.w)},${Math.round(b.y + b.h)}`);
          }
          if (el.filled) {
            L.push(`${ind}DrawingImmediate.FilledTriangle(${pA}, ${pB}, ${pC}, ${cName}, ${fn(el.opacity ?? 1)})`);
          } else {
            L.push(`${ind}DrawingImmediate.Triangle(${pA}, ${pB}, ${pC}, ${cName}, ${fn(el.opacity ?? 1)}, ${fn(el.thickness || 1)})`);
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
          L.push(`${ind}DrawingImmediate.Line(${pA}, ${pB}, ${cName}, ${fn(el.opacity ?? 1)}, 1, ${fn(el.thickness || 1)})`);
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
          L.push(`${ind}DrawingImmediate.Polyline({ ${pA}, ${pB} }, ${cName}, ${fn(el.opacity ?? 1)}, ${fn(el.thickness || 1)})`);
          break;
        }
        case 'Text': {
          const cName = cachedColors.get(el.color);
          const rp    = renderPos(el);
          const pExpr = rp.isLocal ? (() => { const lv = `_p${v}`; L.push(`${ind}local ${lv}: Vector2 = ${rp.expr}`); return lv; })() : rp.expr;
          const src   = el.dynamicSource || '';
          let textExpr;
          if (src === 'clock') {
            textExpr = `os.date("%H:%M:%S")`;
          } else if (src === 'runtime') {
            textExpr = `string.format("%02d:%02d", math.floor((tick()-_T0)/60), math.floor(tick()-_T0)%60)`;
            // _T0 lazy init goes in a local before this draw call — emit guard
            L.push(`${ind}if _T0 == 0 then _T0 = tick() end`);
          } else if (src && src !== '') {
            textExpr = `E.${v}Text`;
          } else {
            textExpr = `"${(el.text || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
          }
          const fn2 = fontArg(el);
          if (el.outline) {
            L.push(`${ind}DrawingImmediate.OutlinedText(${pExpr}, ${el.size || 16}, ${cName}, ${fn(el.opacity ?? 1)}, ${textExpr}, ${el.center ? 'true' : 'false'}${fn2})`);
          } else {
            L.push(`${ind}DrawingImmediate.Text(${pExpr}, ${el.size || 16}, ${cName}, ${fn(el.opacity ?? 1)}, ${textExpr}, ${el.center ? 'true' : 'false'}${fn2})`);
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
          L.push(`${ind}DrawingImmediate.Rectangle(${pExpr}, ${sBg}, ${cBg}, ${fn(el.opacity ?? 1)}, ${fn(el.thickness || 1)})`);
          L.push(`${ind}if E.${v}Checked then`);
          L.push(`${ind}    DrawingImmediate.FilledRectangle(${pExpr} + Vector2.new(${pad}, ${pad}), ${sFl}, ${cFl}, 1)`);
          L.push(`${ind}end`);
          L.push(`${ind}DrawingImmediate.OutlinedText(${pExpr} + Vector2.new(${lx}, ${ly}), ${el.textSize || 16}, ${cLb}, ${fn(el.opacity ?? 1)}, "${(el.label || 'Checkbox').replace(/"/g, '\\"')}", false${fn3})`);
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
          L.push(`${ind}DrawingImmediate.FilledRectangle(${pExpr}, ${sBg}, ${cBg}, ${fn(el.opacity ?? 1)})`);
          L.push(`${ind}DrawingImmediate.OutlinedText(${pExpr} + Vector2.new(${tx}, ${ty}), ${el.textSize || 16}, ${cTx}, ${fn(el.opacity ?? 1)}, E.${v}DisplayText, true${fn3})`);
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
          const lv      = `_dd${v}`;
          L.push(`${ind}local ${lv}: Vector2 = ${pExpr}`);
          L.push(`${ind}DrawingImmediate.FilledRectangle(${lv}, ${sBg}, ${cBg}, ${fn(el.opacity ?? 1)})`);
          L.push(`${ind}DrawingImmediate.OutlinedText(${lv} + Vector2.new(${dtx}, ${dty}), ${el.textSize || 16}, ${cTx}, ${fn(el.opacity ?? 1)}, E.${v}Selected, false${fn3})`);
          L.push(`${ind}DrawingImmediate.OutlinedText(${lv} + Vector2.new(${atx}, ${dty}), ${el.textSize || 16}, ${cTx}, ${fn(el.opacity ?? 1)}, "v", false${fn3})`);
          L.push(`${ind}if E.${v}Open then`);
          const loopMax = isDynDD ? `E.${v}SlotCount` : `#E.${v}Options`;
          L.push(`${ind}    for _i = 1, ${loopMax} do`);
          L.push(`${ind}        local _oy: number = ${lv}.Y + ${el.h} * _i`);
          L.push(`${ind}        DrawingImmediate.FilledRectangle(Vector2.new(${lv}.X, _oy), ${sBg}, ${cBg}, ${fn(el.opacity ?? 1)})`);
          L.push(`${ind}        DrawingImmediate.OutlinedText(Vector2.new(${lv}.X + ${dtx}, _oy + ${dty}), ${el.textSize || 16}, ${cTx}, ${fn(el.opacity ?? 1)}, E.${v}Options[_i], false${fn3})`);
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
          const sTk   = cachedV2Sizes.get(`${Math.round(el.w)},${Math.round(el.h)}`);
          const sKn   = cachedV2Sizes.get(`10,${Math.round(el.h + 4)}`);
          const fn3   = fontArg({ font: el.font });
          const lbx   = Math.round(el.w / 2);
          const lv    = `_sl${v}`;
          L.push(`${ind}local ${lv}: Vector2 = ${pExpr}`);
          L.push(`${ind}local _T${v}: number = MathClamp((E.${v}Value - ${el.minVal || 0}) / ${(el.maxVal || 100) - (el.minVal || 0)}, 0, 1)`);
          L.push(`${ind}local _FW${v}: number = ${el.w} * _T${v}`);
          L.push(`${ind}DrawingImmediate.FilledRectangle(${lv}, ${sTk}, ${cTk}, ${fn(el.opacity ?? 1)})`);
          L.push(`${ind}DrawingImmediate.FilledRectangle(${lv}, Vector2.new(_FW${v}, ${el.h}), ${cKn}, ${fn(el.opacity ?? 1)})`);
          L.push(`${ind}DrawingImmediate.FilledRectangle(Vector2.new(${lv}.X + _FW${v} - 5, ${lv}.Y - 2), ${sKn}, ${cKn}, ${fn(el.opacity ?? 1)})`);
          L.push(`${ind}DrawingImmediate.OutlinedText(${lv} + Vector2.new(${lbx}, -16), 14, ${cLb}, ${fn(el.opacity ?? 1)}, E.${v}LabelText, true${fn3})`);
          break;
        }
        case 'Button': {
          const rp    = renderPos(el);
          const pExpr = rp.isLocal ? (() => { const lv2 = `_p${v}`; L.push(`${ind}local ${lv2}: Vector2 = ${rp.expr}`); return lv2; })() : rp.expr;
          const cBg   = cachedColors.get(el.color);
          const cHv   = cachedColors.get(el.hoverColor || el.color);
          const cTx   = cachedColors.get(el.textColor || '#ffffff');
          const cAc   = el.toggleMode ? cachedColors.get(el.activeColor || '#2a5ec4') : null;
          const cTbAc = el.tabActiveColor ? cachedColors.get(el.tabActiveColor) : null;
          const sBg   = cachedV2Sizes.get(`${Math.round(el.w)},${Math.round(el.h)}`);
          const kbAct = el.action || 'CustomFunction';
          const isSwitchTab = kbAct.startsWith('switchTab:');
          const switchTabN  = isSwitchTab ? S.tabs.findIndex(t => t.id === kbAct.slice('switchTab:'.length)) + 1 : 0;
          const tx    = Math.round(el.w / 2);
          const ty    = Math.round(el.h / 2 - (el.textSize || 16) / 2);
          const fn3   = fontArg({ font: el.font });
          const lv    = `_bt${v}`;
          L.push(`${ind}local ${lv}: Vector2 = ${pExpr}`);
          L.push(`${ind}local _ov${v}: boolean = Mouse.X >= ${lv}.X and Mouse.X <= ${lv}.X + ${el.w}`);
          L.push(`${ind}                     and Mouse.Y >= ${lv}.Y and Mouse.Y <= ${lv}.Y + ${el.h}`);
          // color expression
          let colorExpr;
          if (isSwitchTab && cTbAc) {
            colorExpr = `if ActiveTab == ${switchTabN} then ${cTbAc} elseif _ov${v} then ${cHv} else ${cBg}`;
          } else if (el.toggleMode && cAc) {
            colorExpr = `if E.${v}Toggled then ${cAc} elseif _ov${v} then ${cHv} else ${cBg}`;
          } else {
            colorExpr = `if _ov${v} then ${cHv} else ${cBg}`;
          }
          L.push(`${ind}local _bc${v}: Color3 = ${colorExpr}`);
          L.push(`${ind}DrawingImmediate.FilledRectangle(${lv}, ${sBg}, _bc${v}, ${fn(el.opacity ?? 1)})`);
          L.push(`${ind}DrawingImmediate.OutlinedText(${lv} + Vector2.new(${tx}, ${ty}), ${el.textSize || 16}, ${cTx}, ${fn(el.opacity ?? 1)}, "${(el.label || 'Button').replace(/"/g, '\\"')}", true${fn3})`);
          break;
        }
      }

      if (tg) L.push('        end');
    }

  L.push('    end');
  L.push('    RunService.Render:Connect(_Render)');
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
}

function updateModeUI() {
  const label = (S.drawingMode || 'static') === 'immediate' ? 'Immediate Mode' : 'Static Mode';
  const sbar = document.getElementById('sbar-mode');
  if (sbar) sbar.textContent = `v4 \u00b7 ${label} \u00b7 Checkbox / Keybind / Dropdown / Slider / Button`;
  const val = S.drawingMode || 'static';
  const sel = document.getElementById('si-drawmode');
  if (sel) sel.value = val;
  const selBar = document.getElementById('si-drawmode-bar');
  if (selBar) selBar.value = val;
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

  document.getElementById('left').style.width  = SETTINGS.leftWidth  + 'px';
  document.getElementById('right').style.width = SETTINGS.rightWidth + 'px';
}

function syncSettUI() {
  const p = document.getElementById('sett');
  if (!p) return;
  const selOf = (sel, val) => { const s = p.querySelector(sel); if (s) s.value  = val; };
  const chkOf = (sel, val) => { const s = p.querySelector(sel); if (s) s.checked = val; };
  selOf('[onchange*="fontSize"]',   SETTINGS.fontSize);
  selOf('[onchange*="font"]',       SETTINGS.font);
  chkOf('[onchange*="compact"]',    SETTINGS.compact);
  chkOf('[onchange*="showGrid"]',   SETTINGS.showGrid);
  selOf('[onchange*="gridSize"]',   SETTINGS.gridSize);
  selOf('[onchange*="snapDist"]',   SETTINGS.snapDist);
  selOf('[onchange*="leftWidth"]',  SETTINGS.leftWidth);
  selOf('[onchange*="rightWidth"]', SETTINGS.rightWidth);

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
  saveSettings();
  applySettings();
  syncSettUI();
  render();
}

function resetSett() {
  Object.assign(SETTINGS, {
    fontSize:12, font:'JetBrains Mono', compact:false,
    showGrid:true, gridSize:24, snapDist:7,
    leftWidth:192, rightWidth:250, accent:'blue',
  });
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
  zFit();
  updateLayers();
  updateProps();
  render();
});

window.addEventListener('resize', zFit);

document.addEventListener('mousedown', e => {
  const p = document.getElementById('sett');
  if (p && p.classList.contains('on') &&
      !p.contains(e.target) &&
      !e.target.closest('[onclick*="showSett"]')) {
    hideSett();
  }
});
