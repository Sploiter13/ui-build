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
        color: '#ffffff', thickness: 1, filled: true, rounding: 0, draggable: false };

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
        color: '#ffffff', thickness: 1, filled: false };

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
        callback: 'Click', callbackBody: '' };
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
  return [...S.els].sort((a, b) => {
    const dz = (a.zIndex || 0) - (b.zIndex || 0);
    if (dz) return dz;
    if (a.parentId === b.id) return  1;
    if (b.parentId === a.id) return -1;
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
  for (const h of getHandles(el)) {
    if (Math.abs(pos.x - h.x) < 9 && Math.abs(pos.y - h.y) < 9) return h;
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
function sp(id, k, v) {
  const el = S.els.find(e => e.id === id);
  if (!el) return;
  el[k] = v;
  _codeDirty = true;
  if (k === 'url' && el.type === 'Image') loadImg(el);
  if (k === 'name' || k === 'visible' || k === 'zIndex') updateLayers();
  render();
  updateProps();
}

function spPar(id, val) {
  const el = S.els.find(e => e.id === id);
  if (!el) return;
  pushH();
  if (val) {
    const par = S.els.find(e => e.id === val);
    if (!par) return;
    const ob = bounds(el), pb = bounds(par);
    if (el.type === 'Line' || el.type === 'Polyline') {
      el.x1 = Math.round(ob.wx1 - pb.x);
      el.y1 = Math.round(ob.wy1 - pb.y);
      el.x2 = Math.round(ob.wx2 - pb.x);
      el.y2 = Math.round(ob.wy2 - pb.y);
    } else {
      el.x = Math.round(ob.x - pb.x);
      el.y = Math.round(ob.y - pb.y);
    }
    el.parentId = val;
  } else if (el.parentId) {
    const ob = bounds(el);
    if (el.type === 'Line' || el.type === 'Polyline') {
      el.x1 = Math.round(ob.wx1); el.y1 = Math.round(ob.wy1);
      el.x2 = Math.round(ob.wx2); el.y2 = Math.round(ob.wy2);
    } else {
      el.x = Math.round(ob.x);
      el.y = Math.round(ob.y);
    }
    el.parentId = null;
  }
  updateLayers();
  render();
  updateProps();
}
