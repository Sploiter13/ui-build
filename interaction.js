'use strict';

/* ═══════════════════════════════════════════
   TOOL
═══════════════════════════════════════════ */
function setTool(t) {
  S.tool = t;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('act', b.dataset.t === t));
  CV.style.cursor = t === 'sel' ? 'default' : 'crosshair';
}

/* ═══════════════════════════════════════════
   HIT TEST
   Highest ZIndex first; children before parents.
   Clicking the same spot cycles through overlapping elements.
═══════════════════════════════════════════ */
function ptSegDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function hitTest(pos) {
  const hits = [];
  for (const el of S.els) {
    if (!el.visible || el.locked) continue;
    if (!el.shared && el.tabId && el.tabId !== S.activeTab) continue;
    const b   = bounds(el);
    const pad = Math.max(el.thickness || 1, 5);

    if (el.type === 'Circle') {
      // Distance from center; unfilled = ring-only hit zone
      const dist = Math.hypot(pos.x - b.cx, pos.y - b.cy);
      const hit  = el.filled
        ? dist <= el.radius + pad
        : Math.abs(dist - el.radius) <= Math.max(el.thickness || 1, pad);
      if (hit) hits.push(el);
    } else if (el.type === 'Line' || el.type === 'Polyline') {
      // Perpendicular distance to segment
      if (ptSegDist(pos.x, pos.y, b.wx1, b.wy1, b.wx2, b.wy2) <= Math.max(el.thickness || 1, pad)) {
        hits.push(el);
      }
    } else if (!el.filled && ['Square', 'Triangle'].includes(el.type)) {
      // Unfilled shapes: hit only if near the border
      const inner = {
        x: b.x + pad, y: b.y + pad,
        w: b.w - pad * 2, h: b.h - pad * 2,
      };
      const onOuter = pos.x >= b.x - pad && pos.x <= b.x + b.w + pad &&
                      pos.y >= b.y - pad && pos.y <= b.y + b.h + pad;
      const onInner = inner.w > 0 && inner.h > 0 &&
                      pos.x >= inner.x && pos.x <= inner.x + inner.w &&
                      pos.y >= inner.y && pos.y <= inner.y + inner.h;
      if (onOuter && !onInner) hits.push(el);
    } else {
      if (pos.x >= b.x - pad && pos.x <= b.x + b.w + pad &&
          pos.y >= b.y - pad && pos.y <= b.y + b.h + pad) {
        hits.push(el);
      }
    }
  }
  if (!hits.length) { _lastHit = null; return null; }

  hits.sort((a, b) => {
    const dz = (b.zIndex || 0) - (a.zIndex || 0);
    if (dz) return dz;
    if (a.parentId === b.id) return -1;
    if (b.parentId === a.id) return  1;
    return 0;
  });

  if (_lastHit) {
    const idx = hits.findIndex(e => e.id === _lastHit);
    if (idx >= 0) {
      const next = hits[(idx + 1) % hits.length];
      _lastHit = next.id;
      return next;
    }
  }
  _lastHit = hits[0].id;
  return hits[0];
}

/* ═══════════════════════════════════════════
   SNAP
═══════════════════════════════════════════ */
function doSnap(el) {
  if (!el || el.type === 'Line' || el.type === 'Polyline') return;
  const DIST = SETTINGS.snapDist / S.zoom;
  const b    = bounds(el);
  for (const o of S.els) {
    if (o.id === el.id || !o.visible) continue;
    const ob = bounds(o);
    for (const [a, r] of [
      [b.x,       ob.x],
      [b.x,       ob.x + ob.w],
      [b.x + b.w, ob.x],
      [b.x + b.w, ob.x + ob.w],
    ]) {
      if (Math.abs(a - r) < DIST) { el.x -= (a - r); snaps.push({ x: r }); break; }
    }
    for (const [a, r] of [
      [b.y,       ob.y],
      [b.y,       ob.y + ob.h],
      [b.y + b.h, ob.y],
      [b.y + b.h, ob.y + ob.h],
    ]) {
      if (Math.abs(a - r) < DIST) { el.y -= (a - r); snaps.push({ y: r }); break; }
    }
  }
}

/* ═══════════════════════════════════════════
   TOP SQUARE AT POS  (for auto-parenting)
═══════════════════════════════════════════ */
function topSqAt(pos) {
  const hits = [];
  for (const el of S.els) {
    if (el.type !== 'Square' || !el.visible) continue;
    if (!el.shared && el.tabId && el.tabId !== S.activeTab) continue;
    const b = bounds(el);
    if (pos.x >= b.x && pos.x <= b.x + b.w &&
        pos.y >= b.y && pos.y <= b.y + b.h) {
      hits.push(el);
    }
  }
  return hits.sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0))[0] || null;
}

/* ═══════════════════════════════════════════
   MOUSE EVENTS
═══════════════════════════════════════════ */
CV.addEventListener('mousedown', e => {
  const pos = cvP(e);

  // Right-click → context menu
  if (e.button === 2) {
    const hit = hitTest(pos);
    if (hit && !S.sel.has(hit.id)) { S.sel.clear(); S.sel.add(hit.id); }
    ctxEl = hit;
    showCtx(e.clientX, e.clientY);
    e.preventDefault();
    return;
  }

  // Placing a new element
  if (S.tool !== 'sel') {
    pushH();
    const el = mkEl(S.tool, pos.x, pos.y);
    if (!['Square', 'Line', 'Polyline'].includes(el.type)) {
      const sq = topSqAt(pos);
      if (sq) {
        const sb = bounds(sq);
        el.parentId = sq.id;
        el.x = Math.round(pos.x - sb.x);
        el.y = Math.round(pos.y - sb.y);
      }
    }
    S.els.push(el);
    S.sel.clear();
    S.sel.add(el.id);
    _lastHit = el.id;
    setTool('sel');
    updateLayers();
    updateProps();
    render();
    return;
  }

  // Check resize handles first
  for (const id of S.sel) {
    const el = S.els.find(e => e.id === id);
    if (!el) continue;
    const h = handleAt(pos, el);
    if (h) {
      const b = bounds(el);
      drg = {
        type: 'resize',
        start: pos,
        handle: h,
        s0: {
          x: el.x, y: el.y,
          w: el.w || b.w, h: el.h || b.h,
          radius: el.radius,
          x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2,
        },
      };
      pushH();
      return;
    }
  }

  // Hit test for move / selection
  const hit = hitTest(pos);
  if (hit) {
    if (e.ctrlKey) {
      S.sel.has(hit.id) ? S.sel.delete(hit.id) : S.sel.add(hit.id);
    } else if (!S.sel.has(hit.id)) {
      S.sel.clear();
      S.sel.add(hit.id);
    }
    _lastHit = hit.id;

    // Children whose parent is also selected must be skipped —
    // they follow automatically because their x/y are relative to the parent.
    const selIds = new Set(S.sel);
    const offs = [];
    for (const id of S.sel) {
      const el = S.els.find(e => e.id === id);
      if (!el || el.locked) continue;
      if (el.parentId && selIds.has(el.parentId)) continue;
      offs.push(
        (el.type === 'Line' || el.type === 'Polyline')
          ? { id, x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2 }
          : { id, x: el.x, y: el.y }
      );
    }
    drg = { type: 'move', start: pos, offs };
    pushH();
  } else {
    S.sel.clear();
    _lastHit = null;
  }

  updateLayers();
  updateProps();
  render();
});

CV.addEventListener('mousemove', e => {
  const pos = cvP(e);
  document.getElementById('sm').textContent = `${Math.round(pos.x)},${Math.round(pos.y)}`;

  if (!drg) {
    if (S.tool === 'sel') {
      let cur = 'default';
      for (const id of S.sel) {
        const el = S.els.find(e => e.id === id);
        if (!el) continue;
        const h = handleAt(pos, el);
        if (h) { cur = h.cur; break; }
      }
      if (cur === 'default' && hitTest(pos)) cur = 'move';
      CV.style.cursor = cur;
    } else {
      CV.style.cursor = 'crosshair';
    }
    return;
  }

  const dx = pos.x - drg.start.x;
  const dy = pos.y - drg.start.y;

  if (drg.type === 'move') {
    for (let i = 0; i < drg.offs.length; i++) {
      const off = drg.offs[i];
      const el = S.els.find(e => e.id === off.id);
      if (!el) continue;
      if (el.type === 'Line' || el.type === 'Polyline') {
        el.x1 = off.x1 + dx; el.y1 = off.y1 + dy;
        el.x2 = off.x2 + dx; el.y2 = off.y2 + dy;
      } else {
        el.x = off.x + dx;
        el.y = off.y + dy;
      }
      // Only snap the primary (first) element to avoid guide-line clutter
      if (!e.altKey && i === 0) doSnap(el);
    }
  } else if (drg.type === 'resize') {
    const el  = S.els.find(e => S.sel.has(e.id));
    if (!el) return;
    const s   = drg.s0;
    const dir = drg.handle.dir;
    if (el.type === 'Circle') {
      el.radius = Math.max(4, s.radius + Math.max(dx, dy) / 2);
    } else if (el.type === 'Line' || el.type === 'Polyline') {
      if (dir.includes('nw') || dir.includes('w') || dir.includes('sw')) {
        el.x1 = s.x1 + dx; el.y1 = s.y1 + dy;
      } else {
        el.x2 = s.x2 + dx; el.y2 = s.y2 + dy;
      }
    } else {
      if (dir.includes('e'))  el.w  = Math.max(8, s.w  + dx);
      if (dir.includes('s'))  el.h  = Math.max(8, s.h  + dy);
      if (dir.includes('w')) { el.x = s.x + dx; el.w = Math.max(8, s.w - dx); }
      if (dir.includes('n')) { el.y = s.y + dy; el.h = Math.max(8, s.h - dy); }
    }
  }

  render();
});

CV.addEventListener('mouseup',       ()  => { drg = null; updateProps(); });
CV.addEventListener('contextmenu',   e   => e.preventDefault());

/* ═══════════════════════════════════════════
   CONTEXT MENU
═══════════════════════════════════════════ */
function showCtx(cx, cy) {
  const m = document.getElementById('ctx');
  m.style.left = cx + 'px';
  m.style.top  = cy + 'px';
  m.classList.add('on');
}

function hideCtx() {
  document.getElementById('ctx').classList.remove('on');
}

document.addEventListener('mousedown', e => {
  if (!e.target.closest('#ctx')) hideCtx();
});

function ctxDo(a) {
  hideCtx();

  if (a === 'setParent') {
    const sq = S.els.find(e => S.sel.has(e.id) && e.type === 'Square');
    if (!sq) { toast('Need a Square selected'); return; }
    pushH();
    let n = 0;
    for (const id of S.sel) {
      const el = S.els.find(e => e.id === id);
      if (!el || el.id === sq.id) continue;
      const ob = bounds(el), pb = bounds(sq);
      if (el.type === 'Line' || el.type === 'Polyline') {
        el.x1 = Math.round(ob.wx1 - pb.x); el.y1 = Math.round(ob.wy1 - pb.y);
        el.x2 = Math.round(ob.wx2 - pb.x); el.y2 = Math.round(ob.wy2 - pb.y);
      } else {
        el.x = Math.round(ob.x - pb.x);
        el.y = Math.round(ob.y - pb.y);
      }
      el.parentId = sq.id;
      n++;
    }
    toast(`Parented ${n} to ${sq.name}`);
    updateLayers(); updateProps(); render();
    return;
  }

  if (a === 'unparent') {
    pushH();
    for (const id of S.sel) {
      const el = S.els.find(e => e.id === id);
      if (!el || !el.parentId) continue;
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
    updateLayers(); updateProps(); render();
    toast('Unparented');
    return;
  }

  if (a === 'front') {
    pushH();
    for (const id of S.sel) {
      const el = S.els.find(e => e.id === id);
      if (el) el.zIndex = maxZ() + 1;
    }
    updateLayers(); render();
    return;
  }

  if (a === 'back') {
    pushH();
    for (const id of S.sel) {
      const el = S.els.find(e => e.id === id);
      if (el) el.zIndex = minZ() - 1;
    }
    updateLayers(); render();
    return;
  }

  if (a === 'dup')   { doCopy(); doPaste(); }
  if (a === 'copy')  { doCopy(); }
  if (a === 'paste') { doPaste(); }
  if (a === 'del')   { delSel(); }
}

/* ═══════════════════════════════════════════
   COPY / PASTE / DELETE
═══════════════════════════════════════════ */
function doCopy() {
  clip = [];
  for (const id of S.sel) {
    const el = S.els.find(e => e.id === id);
    if (el) clip.push(JSON.parse(JSON.stringify(el)));
  }
}

function doPaste() {
  pushH();
  S.sel.clear();
  for (const el of clip) {
    const n = JSON.parse(JSON.stringify(el));
    n.id    = el.type[0] + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    n.name  = el.name + ' copy';
    n.tabId = S.activeTab;
    delete n._img;
    delete n._ok;
    if (n.type === 'Line' || n.type === 'Polyline') {
      n.x1 += 20; n.y1 += 20;
      n.x2 += 20; n.y2 += 20;
    } else {
      n.x = (n.x || 0) + 20;
      n.y = (n.y || 0) + 20;
    }
    S.els.push(n);
    S.sel.add(n.id);
    if (n.type === 'Image' && n.url) loadImg(n);
  }
  updateLayers(); updateProps(); render();
}

function delSel() {
  if (!S.sel.size) return;
  pushH();
  // Unparent any children of deleted elements
  for (const id of S.sel) {
    for (const el of S.els) {
      if (el.parentId === id) el.parentId = null;
    }
  }
  S.els = S.els.filter(e => !S.sel.has(e.id));
  S.sel.clear();
  _lastHit = null;
  updateLayers(); updateProps(); render();
}

/* ═══════════════════════════════════════════
   KEYBOARD SHORTCUTS
═══════════════════════════════════════════ */
document.addEventListener('keydown', e => {
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (e.key === 'Delete' || e.key === 'Backspace') delSel();
  if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
  if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
  if (e.ctrlKey && e.key === 'c') { e.preventDefault(); doCopy(); }
  if (e.ctrlKey && e.key === 'v') { e.preventDefault(); doPaste(); }
  if (e.ctrlKey && e.key === 'd') { e.preventDefault(); doCopy(); doPaste(); }
  if (e.key === 'Escape') {
    S.sel.clear();
    _lastHit = null;
    updateLayers(); updateProps(); render();
  }

  // Arrow-key nudge (Shift = ×10)
  const step = e.shiftKey ? 10 : 1;
  const dx   = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
  const dy   = e.key === 'ArrowUp'   ? -step : e.key === 'ArrowDown'  ? step : 0;
  if (dx || dy) {
    e.preventDefault();
    const nudgeIds = new Set(S.sel);
    for (const id of S.sel) {
      const el = S.els.find(e => e.id === id);
      if (!el || el.locked) continue;
      // Skip children whose parent is also selected — they follow automatically
      if (el.parentId && nudgeIds.has(el.parentId)) continue;
      if (el.type === 'Line' || el.type === 'Polyline') {
        el.x1 += dx; el.y1 += dy;
        el.x2 += dx; el.y2 += dy;
      } else {
        el.x = (el.x || 0) + dx;
        el.y = (el.y || 0) + dy;
      }
    }
    render(); updateProps();
  }
});
