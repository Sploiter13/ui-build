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
    if (!el.visible) continue;
    if (!el.shared && el.tabId && el.tabId !== S.activeTab) continue;
    const b   = bounds(el);
    const pad = Math.max(el.thickness || 1, 5 / S.zoom);

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
  if (!hits.length) { _lastHit = null; _lastClickPos = null; return null; }

  hits.sort((a, b) => {
    const dz = (b.zIndex || 0) - (a.zIndex || 0);
    if (dz) return dz;
    if (a.parentId === b.id) return -1;
    if (b.parentId === a.id) return  1;
    return 0;
  });

  // Locked elements are transparent to canvas clicks — pass-through to what's under them.
  // (Select via the Layers panel row if you need property access on a locked element.)
  const candidates = hits.filter(e => !e.locked);
  if (!candidates.length) { _lastHit = null; _lastClickPos = null; return null; }

  // Cycle only when the new click is essentially on the same spot as the previous one.
  const CYCLE_PX = 4 / S.zoom;
  const samePos = _lastClickPos &&
                  Math.abs(pos.x - _lastClickPos.x) <= CYCLE_PX &&
                  Math.abs(pos.y - _lastClickPos.y) <= CYCLE_PX;

  if (samePos && _lastHit) {
    const idx = candidates.findIndex(e => e.id === _lastHit);
    if (idx >= 0) {
      const next = candidates[(idx + 1) % candidates.length];
      _lastHit = next.id;
      _lastClickPos = pos;
      return next;
    }
  }
  _lastHit = candidates[0].id;
  _lastClickPos = pos;
  return candidates[0];
}

/* ═══════════════════════════════════════════
   SNAP
═══════════════════════════════════════════ */
function doSnap(el) {
  if (!el || el.type === 'Line' || el.type === 'Polyline') return;
  const DIST = SETTINGS.snapDist / S.zoom;
  const b    = bounds(el);
  let snappedX = false, snappedY = false;
  for (const o of S.els) {
    if (o.id === el.id || !o.visible) continue;
    const ob = bounds(o);
    if (!snappedX) {
      for (const [a, r] of [
        [b.x,       ob.x      ],
        [b.x,       ob.x+ob.w ],
        [b.x + b.w, ob.x      ],
        [b.x + b.w, ob.x+ob.w ],
      ]) {
        if (Math.abs(a - r) < DIST) {
          el.x -= (a - r);
          snaps.push({ x: r, refY: ob.y + ob.h / 2 });
          snappedX = true; break;
        }
      }
    }
    if (!snappedY) {
      for (const [a, r] of [
        [b.y,       ob.y      ],
        [b.y,       ob.y+ob.h ],
        [b.y + b.h, ob.y      ],
        [b.y + b.h, ob.y+ob.h ],
      ]) {
        if (Math.abs(a - r) < DIST) {
          el.y -= (a - r);
          snaps.push({ y: r, refX: ob.x + ob.w / 2 });
          snappedY = true; break;
        }
      }
    }
    if (snappedX && snappedY) break;
  }
}

/* ═══════════════════════════════════════════
   SNAP RESIZE — snap only moving edges
   dir: 'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw'
═══════════════════════════════════════════ */
function doSnapResize(el, dir) {
  if (!el || el.type === 'Line' || el.type === 'Polyline' || el.type === 'Circle') return;
  const DIST = SETTINGS.snapDist / S.zoom;
  const b    = bounds(el);
  const moveE = dir.includes('e');
  const moveW = dir.includes('w');
  const moveN = dir.includes('n');
  const moveS = dir.includes('s');
  let snappedX = false, snappedY = false;
  for (const o of S.els) {
    if (o.id === el.id || !o.visible) continue;
    const ob = bounds(o);
    if (!snappedX) {
      const edgesToCheck = [];
      if (moveE) edgesToCheck.push(['e', b.x + b.w]);
      if (moveW) edgesToCheck.push(['w', b.x]);
      for (const [edge, a] of edgesToCheck) {
        for (const r of [ob.x, ob.x + ob.w]) {
          if (Math.abs(a - r) < DIST) {
            if (edge === 'e') { el.w = Math.max(1, el.w + (r - a)); }
            else              { const newX = r; const newW = Math.max(1, (b.x + b.w) - newX); el.x = (b.x + b.w) - newW; el.w = newW; }
            snaps.push({ x: r, refY: ob.y + ob.h / 2 });
            snappedX = true;
            break;
          }
        }
        if (snappedX) break;
      }
    }
    if (!snappedY) {
      const edgesToCheck = [];
      if (moveS) edgesToCheck.push(['s', b.y + b.h]);
      if (moveN) edgesToCheck.push(['n', b.y]);
      for (const [edge, a] of edgesToCheck) {
        for (const r of [ob.y, ob.y + ob.h]) {
          if (Math.abs(a - r) < DIST) {
            if (edge === 's') { el.h = Math.max(1, el.h + (r - a)); }
            else              { const newY = r; const newH = Math.max(1, (b.y + b.h) - newY); el.y = (b.y + b.h) - newH; el.h = newH; }
            snaps.push({ y: r, refX: ob.x + ob.w / 2 });
            snappedY = true;
            break;
          }
        }
        if (snappedY) break;
      }
    }
    if (snappedX && snappedY) break;
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
  // Middle mouse or Space+left → pan
  if (e.button === 1 || (e.button === 0 && _spaceDown)) {
    _panning = true;
    _panLast = { x: e.clientX, y: e.clientY };
    CW.style.cursor = 'grabbing';
    e.preventDefault();
    return;
  }

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

  // Check resize handles first.  If the pointer is on ANY selected element's
  // handle, start a multi-element resize using per-element snapshots.
  for (const id of S.sel) {
    const el = S.els.find(e => e.id === id);
    if (!el || el.locked) continue;
    const h = handleAt(pos, el);
    if (h) {
      const s0s = {};
      // The element whose handle was grabbed is the "primary" — snap uses it.
      const primaryId = el.id;
      for (const sid of S.sel) {
        const e2 = S.els.find(x => x.id === sid);
        if (!e2 || e2.locked) continue;
        const eb = bounds(e2);
        s0s[sid] = {
          x: e2.x, y: e2.y,
          w: e2.w || eb.w, h: e2.h || eb.h,
          radius: e2.radius,
          x1: e2.x1, y1: e2.y1, x2: e2.x2, y2: e2.y2,
        };
      }
      drg = { type: 'resize', start: pos, handle: h, s0s, primaryId };
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

    // hitTest already filters locked elements out (pass-through).
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
    // pushH deferred to first actual pixel moved (avoids undo entry on plain click)
    drg = offs.length ? { type: 'move', start: pos, offs, pushed: false } : null;
  } else {
    S.sel.clear();
    _lastHit = null;
    _lastClickPos = null;
  }

  updateLayers();
  updateProps();
  render();
});

document.addEventListener('mousemove', e => {
  // Pan
  if (_panning && _panLast) {
    _panX += e.clientX - _panLast.x;
    _panY += e.clientY - _panLast.y;
    _panLast = { x: e.clientX, y: e.clientY };
    applyZ();
    return;
  }

  if (!drg) return;

  const pos = cvP(e);
  // Update cursor position display when dragging
  document.getElementById('sm').textContent = `${Math.round(pos.x)},${Math.round(pos.y)}`;

  const dx = pos.x - drg.start.x;
  const dy = pos.y - drg.start.y;

  if (drg.type === 'move') {
    // Defer history push + position writes to past the click-vs-drag threshold
    // so pure clicks never shift elements even slightly.
    if (!drg.pushed) {
      if (Math.abs(dx) <= 4 && Math.abs(dy) <= 4) return;
      pushH();
      drg.pushed = true;
    }
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
      // Only snap the primary (first) element
      if (!e.altKey && i === 0) doSnap(el);
    }
  } else if (drg.type === 'resize') {
    const dir = drg.handle.dir;
    // Resize every non-locked selected element using its own start snapshot.
    for (const id of Object.keys(drg.s0s)) {
      const el = S.els.find(e => e.id === id);
      if (!el) continue;
      const s  = drg.s0s[id];

      // Shift = axis-lock (use dominant axis only)
      // Ctrl  = preserve original aspect ratio
      let ddx = dx, ddy = dy;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) ddy = 0; else ddx = 0;
      }
      if (e.ctrlKey && s.w && s.h) {
        const r = s.w / s.h;
        if (Math.abs(ddx) > Math.abs(ddy)) ddy = ddx / r;
        else                                ddx = ddy * r;
      }

      if (el.type === 'Circle') {
        el.radius = Math.max(1, s.radius + Math.max(ddx, ddy) / 2);
      } else if (el.type === 'Line' || el.type === 'Polyline') {
        if (dir.includes('nw') || dir.includes('w') || dir.includes('sw')) {
          el.x1 = s.x1 + ddx; el.y1 = s.y1 + ddy;
        } else {
          el.x2 = s.x2 + ddx; el.y2 = s.y2 + ddy;
        }
      } else {
        // Clamp width/height at 1 px (tiny shapes are allowed — e.g. eyes/dots);
        // mirror the position shift by how much the dimension ACTUALLY shrank —
        // not by the raw delta — so the element doesn't slide past its own edge.
        if (dir.includes('e'))  el.w  = Math.max(1, s.w  + ddx);
        if (dir.includes('s'))  el.h  = Math.max(1, s.h  + ddy);
        if (dir.includes('w')) {
          const newW = Math.max(1, s.w - ddx);
          el.x = s.x + (s.w - newW);
          el.w = newW;
        }
        if (dir.includes('n')) {
          const newH = Math.max(1, s.h - ddy);
          el.y = s.y + (s.h - newH);
          el.h = newH;
        }
        // Snap moving edges — only on the primary to avoid conflicting pulls.
        if (!e.altKey && id === drg.primaryId) doSnapResize(el, dir);
      }
    }
  }

  render();
});

CV.addEventListener('mousemove', e => {
  if (_panning || drg) return;  // handled above
  const pos = cvP(e);
  document.getElementById('sm').textContent = `${Math.round(pos.x)},${Math.round(pos.y)}`;
  if (S.tool === 'sel') {
    let cur = 'default';
    for (const id of S.sel) {
      const el = S.els.find(e => e.id === id);
      if (!el) continue;
      const h = handleAt(pos, el);
      if (h) { cur = h.cur; break; }
    }
    if (cur === 'default' && hitTest(pos)) cur = 'move';
    CV.style.cursor = _spaceDown ? 'grab' : cur;
  } else {
    CV.style.cursor = 'crosshair';
  }
});

document.addEventListener('mouseup', e => {
  if (_panning) {
    _panning = false;
    _panLast = null;
    CW.style.cursor = _spaceDown ? 'grab' : '';
    return;
  }
  if (drg) { drg = null; updateProps(); }
});

CV.addEventListener('contextmenu', e => e.preventDefault());

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
    updateLayers(); updateProps(); updateCallbacks(); render();
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
    updateLayers(); updateProps(); updateCallbacks(); render();
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

    // Strip any trailing " copy" or " copy N" to find the base name,
    // then find the next unused "base copy", "base copy 2", "base copy 3"...
    const base = (el.name || '').replace(/ copy( \d+)?$/, '');
    let candidate = `${base} copy`;
    let k = 2;
    while (S.els.some(e => e.name === candidate)) candidate = `${base} copy ${k++}`;
    n.name  = candidate;
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
  updateLayers(); updateProps(); updateCallbacks(); render();
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
  _lastClickPos = null;
  updateLayers(); updateProps(); updateCallbacks(); render();
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
    _lastClickPos = null;
    updateLayers(); updateProps(); updateCallbacks(); render();
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
