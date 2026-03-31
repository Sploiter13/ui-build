'use strict';

/* ═══════════════════════════════════════════
   CANVAS REFERENCES
═══════════════════════════════════════════ */
const CV  = document.getElementById('cv');
const ctx = CV.getContext('2d');
const CW  = document.getElementById('cvwrap');

/* ═══════════════════════════════════════════
   ZOOM / RESIZE
═══════════════════════════════════════════ */
function resizeCV() {
  CV.width  = +document.getElementById('icw').value || 1920;
  CV.height = +document.getElementById('ich').value || 1080;
  applyZ();
  render();
}

function applyZ() {
  CV.style.transform = `translate(-50%,-50%) scale(${S.zoom})`;
  document.getElementById('zll').textContent = Math.round(S.zoom * 100) + '%';
}

function doZoom(f) {
  S.zoom = Math.min(Math.max(S.zoom * f, 0.06), 8);
  applyZ();
}

function zFit() {
  S.zoom = Math.min(
    (CW.clientWidth  - 40) / CV.width,
    (CW.clientHeight - 40) / CV.height
  );
  applyZ();
}

/** Convert a mouse event to canvas-space coordinates. */
function cvP(e) {
  const r = CV.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / S.zoom,
    y: (e.clientY - r.top)  / S.zoom,
  };
}

/* ═══════════════════════════════════════════
   DRAW HELPERS
═══════════════════════════════════════════ */
/** Parse a #RRGGBB hex colour into an rgba() CSS string. */
function rgba(hex, a = 1) {
  if (!hex || hex.length < 4) return `rgba(255,255,255,${a})`;
  if (hex.length === 4) {
    hex = '#' + hex[1]+hex[1] + hex[2]+hex[2] + hex[3]+hex[3];
  }
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** Draw a rounded rectangle path (does not fill/stroke). */
function rrect(bx, by, bw, bh, r) {
  r = Math.min(r || 0, Math.min(bw, bh) / 2);
  if (r <= 0) {
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + bw - r, by);
  ctx.arcTo(bx + bw, by,      bx + bw, by + r,      r);
  ctx.lineTo(bx + bw, by + bh - r);
  ctx.arcTo(bx + bw, by + bh, bx + bw - r, by + bh, r);
  ctx.lineTo(bx + r, by + bh);
  ctx.arcTo(bx,      by + bh, bx,      by + bh - r, r);
  ctx.lineTo(bx,     by + r);
  ctx.arcTo(bx,      by,      bx + r,  by,           r);
  ctx.closePath();
}

/** Draw a selection handle square at (x, y). */
function hdl(x, y) {
  ctx.fillStyle   = '#4d90ff';
  ctx.strokeStyle = '#080b14';
  ctx.lineWidth   = 1.5;
  ctx.fillRect(x - 4, y - 4, 8, 8);
  ctx.strokeRect(x - 4, y - 4, 8, 8);
}

/* ═══════════════════════════════════════════
   RENDER
═══════════════════════════════════════════ */
function render() {
  const W = CV.width, H = CV.height;

  // Background + grid
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0b0d15';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,.012)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Elements
  for (const el of sortedEls().filter(e => e.shared || !e.tabId || e.tabId === S.activeTab)) {
    if (!el.visible) continue;
    ctx.save();
    ctx.globalAlpha = el.opacity ?? 1;
    const b = bounds(el);

    switch (el.type) {

      case 'Square':
        ctx.strokeStyle = rgba(el.color);
        ctx.fillStyle   = rgba(el.color);
        ctx.lineWidth   = el.thickness || 1;
        rrect(b.x, b.y, b.w, b.h, el.rounding || 0);
        el.filled ? ctx.fill() : ctx.stroke();
        if (el.draggable) {
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = '#4d90ff';
          ctx.fillRect(b.x + b.w - 16, b.y, 16, 16);
          ctx.fillStyle = '#fff';
          ctx.font = '9px monospace';
          ctx.textBaseline = 'middle';
          ctx.textAlign    = 'center';
          ctx.fillText('\u283f', b.x + b.w - 8, b.y + 8);
          ctx.restore();
        }
        break;

      case 'Circle':
        ctx.strokeStyle = rgba(el.color);
        ctx.fillStyle   = rgba(el.color);
        ctx.lineWidth   = el.thickness || 1;
        ctx.beginPath();
        ctx.arc(b.cx, b.cy, el.radius, 0, Math.PI * 2);
        el.filled ? ctx.fill() : ctx.stroke();
        break;

      case 'Text': {
        ctx.font         = `${el.size || 16}px "JetBrains Mono"`;
        ctx.textBaseline = 'top';
        const tx = el.center
          ? b.wx - ctx.measureText(el.text || '').width / 2
          : b.wx;
        if (el.outline) {
          ctx.strokeStyle = rgba(el.outlineColor);
          ctx.lineWidth   = 2;
          ctx.strokeText(el.text || '', tx, b.wy);
        }
        ctx.fillStyle = rgba(el.color);
        ctx.fillText(el.text || '', tx, b.wy);
        break;
      }

      case 'Triangle':
        ctx.strokeStyle = rgba(el.color);
        ctx.fillStyle   = rgba(el.color);
        ctx.lineWidth   = el.thickness || 1;
        ctx.beginPath();
        ctx.moveTo(b.x + b.w / 2, b.y);
        ctx.lineTo(b.x,           b.y + b.h);
        ctx.lineTo(b.x + b.w,     b.y + b.h);
        ctx.closePath();
        el.filled ? ctx.fill() : ctx.stroke();
        break;

      case 'Line':
        ctx.strokeStyle = rgba(el.color);
        ctx.lineWidth   = el.thickness || 1;
        ctx.beginPath();
        ctx.moveTo(b.wx1, b.wy1);
        ctx.lineTo(b.wx2, b.wy2);
        ctx.stroke();
        break;

      case 'Polyline':
        ctx.strokeStyle = rgba(el.color);
        ctx.fillStyle   = rgba(el.color);
        ctx.lineWidth   = el.thickness || 1;
        ctx.beginPath();
        ctx.moveTo(b.wx1, b.wy1);
        ctx.lineTo(b.wx2, b.wy2);
        el.filled ? ctx.fill() : ctx.stroke();
        break;

      case 'Image':
        if (el.url && !el._img) loadImg(el);
        if (el._img && el._ok) {
          ctx.globalAlpha = 1;
          ctx.drawImage(el._img, b.x, b.y, b.w, b.h);
        } else {
          ctx.fillStyle   = '#161d2e';
          ctx.fillRect(b.x, b.y, b.w, b.h);
          ctx.strokeStyle = '#232d48';
          ctx.lineWidth   = 1;
          ctx.strokeRect(b.x, b.y, b.w, b.h);
          ctx.fillStyle    = '#374060';
          ctx.font         = '10px monospace';
          ctx.textBaseline = 'middle';
          ctx.textAlign    = 'center';
          ctx.fillText('\u2b1a Image', b.x + b.w / 2, b.y + b.h / 2);
        }
        break;

      // ── UI WIDGETS ──────────────────────────────────────────────

      case 'Checkbox': {
        const pad = 3;
        ctx.strokeStyle = rgba(el.outlineColor || '#000');
        ctx.lineWidth   = el.outlineThickness || 1;
        rrect(b.x, b.y, b.w, b.h, el.rounding || 0);
        ctx.fillStyle = rgba(el.color);
        ctx.fill();
        ctx.stroke();
        if (el.defaultChecked) {
          ctx.fillStyle = rgba(el.checkedColor || '#00ff00');
          rrect(b.x + pad, b.y + pad, b.w - pad*2, b.h - pad*2,
                Math.max(0, (el.rounding || 0) - 1));
          ctx.fill();
        }
        if (el.label) {
          ctx.font         = `${el.textSize || 16}px "JetBrains Mono"`;
          ctx.textBaseline = 'middle';
          if (el.textOutline) {
            ctx.strokeStyle = rgba('#000000');
            ctx.lineWidth   = 2;
            ctx.strokeText(el.label, b.x + b.w + 6, b.y + b.h / 2);
          }
          ctx.fillStyle = rgba(el.textColor || '#ffffff');
          ctx.fillText(el.label, b.x + b.w + 6, b.y + b.h / 2);
        }
        break;
      }

      case 'Keybind': {
        ctx.strokeStyle = rgba(el.color);
        ctx.fillStyle   = rgba(el.color);
        ctx.lineWidth   = 1;
        rrect(b.x, b.y, b.w, b.h, el.rounding || 0);
        el.filled ? ctx.fill() : ctx.stroke();
        const kText = `[${el.defaultKey || '?'}]`;
        ctx.font         = `${el.textSize || 16}px "JetBrains Mono"`;
        ctx.textBaseline = 'middle';
        ctx.textAlign    = 'center';
        if (el.textOutline) {
          ctx.strokeStyle = rgba('#000000');
          ctx.lineWidth   = 2;
          ctx.strokeText(kText, b.x + b.w / 2, b.y + b.h / 2);
        }
        ctx.fillStyle = rgba(el.textColor || '#000000');
        ctx.fillText(kText, b.x + b.w / 2, b.y + b.h / 2);
        ctx.textAlign = 'left';
        break;
      }

      case 'Dropdown': {
        ctx.strokeStyle = rgba(el.color);
        ctx.fillStyle   = rgba(el.color);
        ctx.lineWidth   = el.thickness || 1;
        rrect(b.x, b.y, b.w, b.h, el.rounding || 0);
        el.filled ? ctx.fill() : ctx.stroke();
        const dText = el.selected || (el.options || '').split(',')[0] || 'Option 1';
        ctx.font         = `${el.textSize || 16}px "JetBrains Mono"`;
        ctx.textBaseline = 'middle';
        if (el.textOutline) {
          ctx.strokeStyle = rgba('#000');
          ctx.lineWidth   = 2;
          ctx.strokeText(dText, b.x + 8, b.y + b.h / 2);
        }
        ctx.fillStyle = rgba(el.textColor || '#000');
        ctx.fillText(dText, b.x + 8, b.y + b.h / 2);
        // arrow
        ctx.fillStyle = rgba(el.textColor || '#000');
        ctx.font      = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText('\u25bc', b.x + b.w - 6, b.y + b.h / 2);
        ctx.textAlign = 'left';
        // faint option rows preview
        const dopts = (el.options || '').split(',').map(o => o.trim());
        ctx.save();
        ctx.globalAlpha = 0.45;
        for (let i = 0; i < dopts.length; i++) {
          const ry = b.y + b.h * (i + 1);
          ctx.fillStyle   = rgba(el.color);
          ctx.strokeStyle = rgba(el.color);
          rrect(b.x, ry, b.w, b.h, el.rounding || 0);
          el.filled ? ctx.fill() : ctx.stroke();
          ctx.fillStyle    = rgba(el.textColor || '#000');
          ctx.font         = `${el.textSize || 16}px "JetBrains Mono"`;
          ctx.textBaseline = 'middle';
          ctx.fillText(dopts[i], b.x + 8, ry + b.h / 2);
        }
        ctx.restore();
        break;
      }

      case 'Slider': {
        ctx.fillStyle   = rgba(el.color, 0.2);
        ctx.strokeStyle = rgba(el.color);
        ctx.lineWidth   = 1;
        rrect(b.x, b.y, b.w, b.h, el.rounding || 0);
        el.filled ? ctx.fill() : ctx.stroke();
        const pct   = ((el.curVal || 0) - (el.minVal || 0)) / Math.max(1, (el.maxVal || 100) - (el.minVal || 0));
        const fillW = Math.max(0, b.w * pct);
        if (fillW > 0) {
          ctx.fillStyle = rgba(el.color);
          rrect(b.x, b.y, fillW, b.h, el.rounding || 0);
          ctx.fill();
        }
        const kx = b.x + fillW;
        ctx.fillStyle   = rgba(el.knobColor || '#ffffff');
        ctx.strokeStyle = rgba('#000');
        ctx.lineWidth   = 1;
        rrect(kx - 5, b.y - 2, 10, b.h + 4, 2);
        ctx.fill();
        ctx.stroke();
        ctx.font         = '10px "JetBrains Mono"';
        ctx.textBaseline = 'bottom';
        ctx.textAlign    = 'center';
        ctx.fillStyle    = rgba('#ffffff', 0.7);
        ctx.fillText((el.curVal || 0) + (el.suffix || ''), b.x + b.w / 2, b.y - 2);
        ctx.textAlign = 'left';
        break;
      }

      case 'Button': {
        ctx.fillStyle   = rgba(el.color);
        ctx.strokeStyle = rgba(el.color);
        ctx.lineWidth   = el.thickness || 1;
        rrect(b.x, b.y, b.w, b.h, el.rounding || 0);
        el.filled ? ctx.fill() : ctx.stroke();
        // subtle highlight strip
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle   = '#ffffff';
        rrect(b.x + 2, b.y + 2, b.w - 4, Math.min(8, b.h / 3), Math.max(0, (el.rounding || 0) - 1));
        ctx.fill();
        ctx.restore();
        ctx.font         = `${el.textSize || 16}px "JetBrains Mono"`;
        ctx.textBaseline = 'middle';
        ctx.textAlign    = 'center';
        if (el.textOutline) {
          ctx.strokeStyle = rgba('#000');
          ctx.lineWidth   = 2;
          ctx.strokeText(el.label || 'Button', b.x + b.w / 2, b.y + b.h / 2);
        }
        ctx.fillStyle = rgba(el.textColor || '#ffffff');
        ctx.fillText(el.label || 'Button', b.x + b.w / 2, b.y + b.h / 2);
        ctx.textAlign = 'left';
        // hover colour hint
        ctx.font      = '8px "JetBrains Mono"';
        ctx.fillStyle = rgba(el.hoverColor || '#6aa8ff', 0.6);
        ctx.textAlign = 'right';
        ctx.fillText(
          'hover\u2192' + rgba(el.hoverColor || '#6aa8ff').slice(0, 16),
          b.x + b.w - 3, b.y + b.h - 3
        );
        ctx.textAlign = 'left';
        break;
      }
    }

    ctx.restore();

    // Parent connector line
    if (el.parentId) {
      const par = S.els.find(e => e.id === el.parentId);
      if (par) {
        const pb = bounds(par);
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = '#9b6fff';
        ctx.lineWidth   = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(pb.x + pb.w / 2, pb.y + pb.h / 2);
        ctx.lineTo(b.x  + b.w  / 2, b.y  + b.h  / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // Selection handles
    if (S.sel.has(el.id)) {
      ctx.strokeStyle = '#4d90ff';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(b.x - 5, b.y - 5, b.w + 10, b.h + 10);
      ctx.setLineDash([]);
      for (const h of getHandles(el)) hdl(h.x, h.y);
    }
  }

  // Snap guides
  ctx.strokeStyle = 'rgba(255,80,200,.5)';
  ctx.lineWidth   = 1;
  for (const g of snaps) {
    ctx.beginPath();
    if (g.x !== undefined) {
      ctx.moveTo(g.x, 0); ctx.lineTo(g.x, H);
    } else {
      ctx.moveTo(0, g.y); ctx.lineTo(W, g.y);
    }
    ctx.stroke();
  }
  snaps = [];

  updateStatus();
}

/* ═══════════════════════════════════════════
   IMAGE LOADER
═══════════════════════════════════════════ */
function loadImg(el) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload  = () => { el._img = img; el._ok = true;  render(); };
  img.onerror = () => {                el._ok = false; render(); };
  el._img = img;
  el._ok  = false;
  img.src = el.url;
}
