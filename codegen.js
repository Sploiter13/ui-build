'use strict';

/* ═══════════════════════════════════════════
   HISTORY
═══════════════════════════════════════════ */
function ser() {
  return JSON.stringify({
    tabs:      S.tabs,
    activeTab: S.activeTab,
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
  S.els       = d.els || d;   // support old flat-array format
  S.tabs      = d.tabs      || [{ id: 'tab1', name: 'Tab 1' }];
  S.activeTab = d.activeTab || S.tabs[0].id;
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
  S.cnt       = {};
  _lastHit    = null;
  updateTabBar(); updateLayers(); updateProps(); render();
}

function saveJSON() {
  const d = JSON.stringify({
    v: 5,
    w: CV.width,
    h: CV.height,
    tabs:      S.tabs,
    activeTab: S.activeTab,
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
      S.els       = d.elements || [];
      S.tabs      = d.tabs      || [{ id: 'tab1', name: 'Tab 1' }];
      S.activeTab = d.activeTab || S.tabs[0].id;
      S.sel.clear();
      rebuildCnt();
      if (d.w) { document.getElementById('icw').value = d.w; CV.width  = d.w; }
      if (d.h) { document.getElementById('ich').value = d.h; CV.height = d.h; }
      S.els.filter(e => e.type === 'Image' && e.url).forEach(loadImg);
      updateTabBar(); updateLayers(); updateProps(); render();
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
    S.els       = d.els || d;   // support old flat format
    S.tabs      = d.tabs      || [{ id: 'tab1', name: 'Tab 1' }];
    S.activeTab = d.activeTab || S.tabs[0].id;
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
  const needsInteractive = hasDrag || hasCB || hasKB || hasDD || hasSL || hasBT;
  const needsInput      = needsInteractive || hasDynText;
  const draggables = sorted.filter(e => e.type === 'Square' && e.draggable);

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
        const opts   = (el.options || 'Option 1').split(',').map(o => o.trim());
        const defIdx = Math.max(0, Math.min(opts.length - 1, el.defaultIndex || 0));
        L.push(`E.${v}Background = Drawing.new("Square")`);
        L.push(`E.${v}Text       = Drawing.new("Text")`);
        L.push(`E.${v}Arrow      = Drawing.new("Text")`);
        L.push(`E.${v}Selected   = "${opts[defIdx]}"`);
        L.push(`E.${v}Options    = { ${opts.map(o => `"${o}"`).join(', ')} }`);
        L.push(`E.${v}Open       = false`);
        for (let i = 0; i < opts.length; i++) {
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
              const opts = (el.options || 'Option 1').split(',').map(o => o.trim());
              L.push(`    E.${v}Background.Visible = ${g} and ${vis}`);
              L.push(`    E.${v}Text.Visible       = ${g} and ${vis}`);
              L.push(`    E.${v}Arrow.Visible      = ${g} and ${vis}`);
              for (let oi = 0; oi < opts.length; oi++) {
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

        for (let i = 0; i < opts.length; i++) {
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
          L.push(`    E.${v}OptionText${i}.Text      = "${opts[i]}"`);
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
  if (needsInput) {
    const needsMouse    = hasBT || hasDrag || hasSwitchTabAction;

    L.push('');
    L.push('do');
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
      const v    = vn(el);
      const opts = (el.options || 'Option 1').split(',').map(o => o.trim());
      const N    = opts.length;
      const tg   = (multiTab && !el.shared) ? `ActiveTab == ${tabIdx(el)} and ` : '';
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

    // ── Render: drawing updates only ─────────────────────────
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
      const v    = vn(el);
      const opts = (el.options || 'Option 1').split(',').map(o => o.trim());
      const N    = opts.length;
      const ti   = tabIdx(el);
      const tabGate = (multiTab && !el.shared) ? `ActiveTab == ${ti} and ` : '';
      const uiGate  = hasToggleUI ? `UIVisible and ` : '';
      L.push(`        E.${v}Text.Text  = E.${v}Selected`);
      L.push(`        E.${v}Arrow.Text = if E.${v}Open then "\u25b2" else "\u25bc"`);
      for (let i = 0; i < N; i++) {
        L.push(`        E.${v}OptionBackground${i}.Visible = ${uiGate}${tabGate}E.${v}Open`);
        L.push(`        E.${v}OptionText${i}.Visible       = ${uiGate}${tabGate}E.${v}Open`);
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
          const dopts = (kid.options || 'Option 1').split(',').map(o => o.trim());
          L.push(`            E.${kv}Background.Position = NewPos + Vector2.new(${ox}, ${oy})`);
          L.push(`            E.${kv}Text.Position       = NewPos + Vector2.new(${ox + 8}, ${oy + Math.round(kid.h/2 - (kid.textSize||16)/2)})`);
          L.push(`            E.${kv}Arrow.Position      = NewPos + Vector2.new(${ox + kid.w - 16}, ${oy + Math.round(kid.h/2 - (kid.textSize||16)/2)})`);
          for (let i = 0; i < dopts.length; i++) {
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

    // ── Dynamic Text: live value updates ───────────────────────
    if (hasDynText) {
      for (const el of dynTextEls) {
        const v   = vn(el);
        const src = el.dynamicSource || '';
        if (src.startsWith('keybind:')) {
          const kbEl = sorted.find(e => e.id === src.slice('keybind:'.length));
          if (kbEl) {
            const kv = vn(kbEl);
            L.push(`        E.${v}.Text = if E.${kv}Waiting then "[...]" else "[" .. E.${kv}Key .. "]"`);
          }
        } else if (src === 'playerName') {
          L.push(`        E.${v}.Text = game.Players.LocalPlayer.Name`);
        } else if (src === 'tabName') {
          L.push(`        E.${v}.Text = TabNames[ActiveTab] or ""`);
        } else if (src === 'clock') {
          L.push(`        E.${v}.Text = os.date("%H:%M:%S")`);
        } else if (src === 'custom' && (el.dynamicExpr || '').trim()) {
          L.push(`        E.${v}.Text = tostring(${el.dynamicExpr.trim()})`);
        }
      }
      L.push('');
    }

    L.push('    end)');
    L.push('end');
  } else {
    // no runtime block — close IIFE after init block
    L.push('');
  }

  L.push('end)()');

  return L.join('\n');
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
