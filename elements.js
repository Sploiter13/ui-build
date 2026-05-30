'use strict';

/* ═══════════════════════════════════════════
   ELEMENT FACTORY
═══════════════════════════════════════════ */
function mkEl(type, x, y) {
  S.cnt[type] = (S.cnt[type] || 0) + 1;
  const id   = type[0].toLowerCase() + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const base = {
    id, type,
    name:     type + S.cnt[type],
    visible:  true,
    locked:   false,
    zIndex:   0,
    opacity:  1,
    parentId: null,
    tabId:    S.activeTab,
    shared:   false,
  };
  x = Math.round(x);
  y = Math.round(y);

  switch (type) {
    case 'Square':
      return { ...base, x, y, w: 160, h: 60,
        color: '#ffffff', thickness: 1, filled: true, rounding: 0, draggable: false, rotation: 0 };

    case 'Circle':
      return { ...base, x, y, radius: 50,
        color: '#ffffff', thickness: 1, filled: false, numSides: 64 };

    case 'Text':
      return { ...base, x, y,
        text: 'Text', size: 16, font: 0,
        color: '#ffffff', center: false, outline: false, outlineColor: '#000000',
        dynamicSource: '', dynamicExpr: '' };

    case 'Triangle':
      return { ...base, x, y, w: 90, h: 70,
        color: '#ffffff', thickness: 1, filled: false, rotation: 0 };

    case 'Line':
      return { ...base, x1: x, y1: y, x2: x + 120, y2: y,
        color: '#ffffff', thickness: 1 };

    case 'Polyline':
      return { ...base, x1: x, y1: y, x2: x + 120, y2: y,
        color: '#ffffff', thickness: 1, filled: false };

    case 'Image':
      return { ...base, x, y, w: 120, h: 90,
        color: '#ffffff', url: '', rounding: 0 };

    // ── UI Widgets ──────────────────────────────────────────────

    case 'Checkbox':
      return { ...base, x, y, w: 20, h: 20,
        color: '#ffffff', rounding: 0, thickness: 1,
        defaultChecked: false, checkedColor: '#00ff00',
        outlineColor: '#000000', outlineThickness: 1,
        label: 'Checkbox', textSize: 16, textColor: '#ffffff',
        textOutline: true, font: 2,
        callback: 'Toggle', exclusiveGroup: '', callbackBody: '' };

    case 'Keybind':
      return { ...base, x, y, w: 100, h: 30,
        color: '#ffffff', rounding: 0, filled: true,
        defaultKey: 'Insert',
        action: 'CustomFunction',
        textSize: 16, textColor: '#000000', textOutline: true, font: 2,
        callback: 'Change', callbackBody: '' };

    case 'Dropdown':
      return { ...base, x, y, w: 150, h: 30,
        color: '#ffffff', rounding: 0, filled: true, thickness: 1,
        options: 'Option 1,Option 2,Option 3', defaultIndex: 0,
        dynamicOptions: '', maxOptions: 20,
        textSize: 16, textColor: '#000000', textOutline: true, font: 2,
        callback: 'Change', callbackBody: '' };

    case 'Slider':
      return { ...base, x, y, w: 200, h: 10,
        color: '#ffffff', rounding: 0, filled: true,
        minVal: 0, maxVal: 100, curVal: 50,
        knobColor: '#ffffff', suffix: '',
        step: 1, fireOnRelease: false,
        callback: 'Change', callbackBody: '' };

    case 'Button':
      return { ...base, x, y, w: 120, h: 34,
        color: '#4d90ff', rounding: 4, filled: true, thickness: 1,
        label: 'Button',
        textSize: 16, textColor: '#ffffff', textOutline: false, font: 2,
        hoverColor: '#6aa8ff', toggleMode: false, activeColor: '#2a5ec4',
        tabActiveColor: '', tabActiveTextColor: '',
        action: 'CustomFunction',
        imageUrl: '',
        callback: 'Click', callbackBody: '' };

    case 'Switch':
      return { ...base, x, y, w: 44, h: 22,
        color:     '#3a3a3a',
        onColor:   '#4d90ff',
        knobColor: '#ffffff',
        rounding:  11,
        defaultEnabled: false,
        label: 'Switch',
        textSize: 16, textColor: '#ffffff', textOutline: false, font: 0,
        callback: 'Toggle', exclusiveGroup: '', callbackBody: '' };
  }
}

/* ═══════════════════════════════════════════
   PARENTING
═══════════════════════════════════════════ */
function getPar(el) {
  return el.parentId ? S.els.find(e => e.id === el.parentId) || null : null;
}

function parOffset(el) {
  const p = getPar(el);
  if (!p) return { px: 0, py: 0 };
  const b = bounds(p);
  return { px: b.x, py: b.y };
}

/* ═══════════════════════════════════════════
   BOUNDS  (world-space)
═══════════════════════════════════════════ */
function bounds(el) {
  const p  = getPar(el);
  const px = p ? bounds(p).x : 0;
  const py = p ? bounds(p).y : 0;

  switch (el.type) {
    case 'Square':
    case 'Triangle':
    case 'Image':
    case 'Checkbox':
    case 'Keybind':
    case 'Dropdown':
    case 'Slider':
    case 'Button':
    case 'Switch':
      return { x: px + el.x, y: py + el.y, w: el.w, h: el.h };

    case 'Circle': {
      const cx = px + el.x, cy = py + el.y;
      return { x: cx - el.radius, y: cy - el.radius, w: el.radius * 2, h: el.radius * 2, cx, cy };
    }

    case 'Line':
    case 'Polyline': {
      const wx1 = px + el.x1, wy1 = py + el.y1;
      const wx2 = px + el.x2, wy2 = py + el.y2;
      return {
        x:   Math.min(wx1, wx2),
        y:   Math.min(wy1, wy2),
        w:   Math.max(Math.abs(wx2 - wx1), 14),
        h:   Math.max(Math.abs(wy2 - wy1), 14),
        wx1, wy1, wx2, wy2,
      };
    }

    case 'Text': {
      ctx.font = `${el.size || 16}px "JetBrains Mono"`;
      const tw = ctx.measureText(el.text || 'Text').width;
      const wx = px + el.x, wy = py + el.y;
      return {
        x:  el.center ? wx - tw / 2 : wx,
        y:  wy,
        w:  Math.max(tw, 30),
        h:  (el.size || 16) + 4,
        wx, wy,
      };
    }
  }

  return { x: px + el.x, y: py + el.y, w: 80, h: 30 };
}

/* ═══════════════════════════════════════════
   RENDER ORDER
═══════════════════════════════════════════ */
function sortedEls() {
  // Effective draw order. A child sits just above its parent BY DEFAULT (so a
  // checkbox placed in a window is visible), but a child explicitly given a lower
  // zIndex than its parent is respected and drops behind it. This is the fix for
  // "a square sent to z = -10000 still covered everything": the old rule bumped
  // EVERY child to parent.z + 1 unconditionally, overriding explicit low z and
  // collapsing siblings onto the same layer (the uneven over/under seen when a
  // container went semi-transparent).
  const zCache = new Map();
  const resolveZ = (e) => {
    if (zCache.has(e.id)) return zCache.get(e.id);
    const ez = e.zIndex || 0;
    if (!e.parentId) { zCache.set(e.id, ez); return ez; }
    const par = S.els.find(x => x.id === e.parentId);
    if (!par) { zCache.set(e.id, ez); return ez; }
    zCache.set(e.id, ez);                                  // cycle sentinel
    const z = (ez < (par.zIndex || 0)) ? ez                // explicit "behind parent"
            : Math.max(ez, resolveZ(par) + 1);             // default: above parent
    zCache.set(e.id, z);
    return z;
  };
  const depthCache = new Map();
  const depth = (e) => {
    if (depthCache.has(e.id)) return depthCache.get(e.id);
    if (!e.parentId) { depthCache.set(e.id, 0); return 0; }
    const par = S.els.find(x => x.id === e.parentId);
    if (!par) { depthCache.set(e.id, 0); return 0; }
    depthCache.set(e.id, 0);
    const d = depth(par) + 1;
    depthCache.set(e.id, d);
    return d;
  };
  return [...S.els].sort((a, b) => {
    const dz = resolveZ(a) - resolveZ(b);
    if (dz) return dz;
    const dd = depth(a) - depth(b);     // ties: descendant drawn on top of ancestor
    if (dd) return dd;
    return 0;
  });
}

/* ═══════════════════════════════════════════
   HANDLES
═══════════════════════════════════════════ */
function getHandles(el) {
  const b = bounds(el);
  return [
    { x: b.x - 5,           y: b.y - 5,           dir: 'nw', cur: 'nw-resize' },
    { x: b.x + b.w / 2 + 5, y: b.y - 5,           dir: 'n',  cur: 'n-resize'  },
    { x: b.x + b.w + 5,     y: b.y - 5,           dir: 'ne', cur: 'ne-resize' },
    { x: b.x - 5,           y: b.y + b.h / 2 + 5, dir: 'w',  cur: 'w-resize'  },
    { x: b.x + b.w + 5,     y: b.y + b.h / 2 + 5, dir: 'e',  cur: 'e-resize'  },
    { x: b.x - 5,           y: b.y + b.h + 5,     dir: 'sw', cur: 'sw-resize' },
    { x: b.x + b.w / 2 + 5, y: b.y + b.h + 5,     dir: 's',  cur: 's-resize'  },
    { x: b.x + b.w + 5,     y: b.y + b.h + 5,     dir: 'se', cur: 'se-resize' },
  ];
}

function handleAt(pos, el) {
  const thresh = 8 / S.zoom;  // 8 screen pixels regardless of zoom
  for (const h of getHandles(el)) {
    if (Math.abs(pos.x - h.x) < thresh && Math.abs(pos.y - h.y) < thresh) return h;
  }
  return null;
}

/* ═══════════════════════════════════════════
   Z-INDEX HELPERS
═══════════════════════════════════════════ */
function maxZ() { return S.els.reduce((m, e) => Math.max(m, e.zIndex || 0), 0); }
function minZ() { return S.els.reduce((m, e) => Math.min(m, e.zIndex || 0), 0); }

function bZ(id, d) {
  const el = S.els.find(e => e.id === id);
  if (!el) return;
  pushH();   // layer-order buttons are undoable
  if      (d ===  999) el.zIndex = maxZ() + 1;
  else if (d === -999) el.zIndex = minZ() - 1;
  else                 el.zIndex = (el.zIndex || 0) + d;
  updateLayers();
  render();
  updateProps();
}

/* ═══════════════════════════════════════════
   PROPERTY SETTER  (called from props panel)
═══════════════════════════════════════════ */
// Edit-burst tracking so property changes are undoable WITHOUT flooding history:
// a continuous drag (opacity slider, colour picker) coalesces into one undo step,
// while distinct edits — or edits after a short pause — each get their own step.
let _spBurstKey = null;
let _spBurstTime = 0;

function sp(id, k, v) {
  const el = S.els.find(e => e.id === id);
  if (!el) return;
  // Snapshot the pre-edit state once per burst (before mutating) so Ctrl+Z reverts it.
  const now = Date.now();
  const burstKey = id + ' ' + k;
  if (burstKey !== _spBurstKey || (now - _spBurstTime) > 600) pushH();
  _spBurstKey  = burstKey;
  _spBurstTime = now;
  el[k] = v;
  _codeDirty = true;
  if (k === 'url' && el.type === 'Image') loadImg(el);
  if (k === 'imageUrl' && el.type === 'Button') { el._img = null; el._ok = false; loadImg(el); }
  if (k === 'name' || k === 'visible' || k === 'zIndex') updateLayers();
  // Keys that affect what the Callbacks tab renders (name in header, action
  // toggles body-edit eligibility, toggleMode swaps Button signature,
  // callback/callbackBody are the primary content, tab/shared affect the
  // [tab] badge).
  if (k === 'name' || k === 'action' || k === 'toggleMode' ||
      k === 'callback' || k === 'callbackBody' ||
      k === 'tabId' || k === 'shared') {
    if (typeof updateCallbacks === 'function') updateCallbacks();
  }
  render();
  updateProps();
}

/* ═══════════════════════════════════════════
   RE-PARENTING  (world position preserved)
═══════════════════════════════════════════ */
// Re-parent every id in `ids` to `newParentId` (or null to unparent) WITHOUT
// moving anything on screen. Each type's coords mean a different anchor, so we
// snapshot the correct world anchor (circle CENTER, text ANCHOR, line ENDPOINTS,
// everything else TOP-LEFT) and re-express it relative to the new parent. Using
// bounds().x/y for circles/text was the old bug that shifted them on reparent.
// Returns how many elements were actually reparented. Caller handles pushH/render.
function reparentKeepWorld(ids, newParentId) {
  // Snapshot world anchors BEFORE touching any parentId — reparenting one element
  // changes the resolved bounds of its descendants.
  const snap = new Map();
  for (const eid of ids) {
    const el = S.els.find(e => e.id === eid);
    if (!el) continue;
    const b = bounds(el);
    if (el.type === 'Line' || el.type === 'Polyline')
      snap.set(eid, { line: true, wx1: b.wx1, wy1: b.wy1, wx2: b.wx2, wy2: b.wy2 });
    else if (el.type === 'Circle')
      snap.set(eid, { wx: b.cx, wy: b.cy });                          // el.x/y = center
    else if (el.type === 'Text')
      snap.set(eid, { wx: b.wx != null ? b.wx : b.x,                  // el.x/y = anchor
                      wy: b.wy != null ? b.wy : b.y });
    else
      snap.set(eid, { wx: b.x, wy: b.y });                            // el.x/y = top-left
  }

  const np = newParentId ? S.els.find(e => e.id === newParentId) : null;
  const nb = np ? bounds(np) : { x: 0, y: 0 };

  // True if parenting `childId` under `targetId` would form a cycle (target is the
  // child itself or one of its descendants).
  const wouldCycle = (childId, targetId) => {
    let cur = targetId;
    while (cur) {
      if (cur === childId) return true;
      const p = S.els.find(e => e.id === cur);
      cur = p ? p.parentId : null;
    }
    return false;
  };

  let n = 0;
  for (const eid of ids) {
    const el = S.els.find(e => e.id === eid);
    const s  = snap.get(eid);
    if (!el || !s) continue;
    if (newParentId && (eid === newParentId || wouldCycle(eid, newParentId))) continue;
    el.parentId = newParentId || null;
    if (s.line) {
      el.x1 = Math.round(s.wx1 - nb.x); el.y1 = Math.round(s.wy1 - nb.y);
      el.x2 = Math.round(s.wx2 - nb.x); el.y2 = Math.round(s.wy2 - nb.y);
    } else {
      el.x = Math.round(s.wx - nb.x); el.y = Math.round(s.wy - nb.y);
    }
    n++;
  }
  return n;
}

function spPar(id, val) {
  // The panel shows one element, but the user expects the WHOLE selection to
  // reparent. If the panel element is part of the selection, apply to all of it.
  const ids = (S.sel && S.sel.has(id)) ? Array.from(S.sel) : [id];
  pushH();
  reparentKeepWorld(ids, val || null);
  updateLayers();
  render();
  updateProps();
  if (typeof updateCallbacks === 'function') updateCallbacks();
}
