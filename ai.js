'use strict';

const AI_KEY_STORE  = 'sevui_ai_key';
const AI_CFG_STORE  = 'sevui_ai_cfg';
const AI_SALT_STORE = 'sevui_ai_salt';

const AI = {
  enabled:  false,
  provider: 'openrouter',
  model:    '',
  key:      '',
  models:   [],
  account:  null,
  busy:     false,
  abort:    null,
  err:      '',
};

const AI_PROVIDERS = {
  openrouter: {
    label:     'OpenRouter',
    keyHelp:   'https://openrouter.ai/keys',
    keyHint:   'sk-or-...',
    chatUrl:   'https://openrouter.ai/api/v1/chat/completions',
    keyUrl:    'https://openrouter.ai/api/v1/key',
    modelsUrl: 'https://openrouter.ai/api/v1/models',
    headers(key) {
      const ref = (location && location.origin && location.origin !== 'null')
        ? location.origin : 'https://severe.uibuilder';
      return {
        'Authorization': `Bearer ${key}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  ref,
        'X-Title':       'Severe UI Builder',
      };
    },
  },
};

function _aiSalt() {
  let s = '';
  try { s = localStorage.getItem(AI_SALT_STORE) || ''; } catch {}
  if (!s) {
    const b = new Uint8Array(24);
    try {
      (window.crypto || window.msCrypto).getRandomValues(b);
    } catch {
      for (let i = 0; i < b.length; i++) b[i] = (Math.random() * 256) | 0;
    }
    let raw = '';
    for (let i = 0; i < b.length; i++) raw += String.fromCharCode(b[i]);
    s = btoa(raw);
    try { localStorage.setItem(AI_SALT_STORE, s); } catch {}
  }
  return s;
}
function _aiEnc(s) {
  try {
    const k = _aiSalt(); let o = '';
    for (let i = 0; i < s.length; i++) o += String.fromCharCode(s.charCodeAt(i) ^ k.charCodeAt(i % k.length));
    return btoa(unescape(encodeURIComponent(o)));
  } catch { return ''; }
}
function _aiDec(b) {
  try {
    const k = _aiSalt();
    const o = decodeURIComponent(escape(atob(b))); let s = '';
    for (let i = 0; i < o.length; i++) s += String.fromCharCode(o.charCodeAt(i) ^ k.charCodeAt(i % k.length));
    return s;
  } catch { return ''; }
}

function aiInit() {
  try {
    const cfg = JSON.parse(localStorage.getItem(AI_CFG_STORE) || '{}');
    if (cfg.provider && AI_PROVIDERS[cfg.provider]) AI.provider = cfg.provider;
    if (typeof cfg.model === 'string') AI.model = cfg.model;
  } catch {}
  const raw = localStorage.getItem(AI_KEY_STORE);
  if (raw) AI.key = _aiDec(raw);
}
function aiSaveCfg() {
  try { localStorage.setItem(AI_CFG_STORE, JSON.stringify({ provider: AI.provider, model: AI.model })); } catch {}
}
function aiStoreKey(key) {
  AI.key = key || '';
  try {
    if (key) localStorage.setItem(AI_KEY_STORE, _aiEnc(key));
    else     localStorage.removeItem(AI_KEY_STORE);
  } catch {}
}
function aiForgetKey() {
  aiStoreKey('');
  AI.account = null;
  AI.models  = [];
  AI.err     = '';
  aiRender();
}

async function aiConnect(key) {
  const prov = AI_PROVIDERS[AI.provider];
  AI.err = '';
  let res;
  try {
    res = await fetch(prov.keyUrl, { headers: prov.headers(key) });
  } catch (e) {
    AI.err = 'Network error — if you opened this file directly (file://), serve it over http or check your connection.';
    aiRender(); return false;
  }
  if (!res.ok) {
    AI.err = aiHttpMessage(res.status);
    aiRender(); return false;
  }
  let info = null;
  try { info = (await res.json()).data; } catch {}
  AI.account = {
    label:     (info && info.label) || 'OpenRouter key',
    remaining: info ? info.limit_remaining : null,
    free:      info ? info.is_free_tier : null,
  };
  aiStoreKey(key);
  await aiFetchModels();
  aiRender();
  return true;
}

async function aiFetchModels() {
  const prov = AI_PROVIDERS[AI.provider];
  try {
    const res = await fetch(prov.modelsUrl, { headers: prov.headers(AI.key) });
    if (!res.ok) return;
    const data = await res.json();
    AI.models = (data.data || [])
      .map(m => ({ id: m.id, name: m.name || m.id }))
      .filter(m => typeof m.id === 'string')
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {}
}

function aiHttpMessage(status) {
  switch (status) {
    case 400: return 'Bad request — the model may not accept these options. Try another model.';
    case 401: return 'Invalid API key. Double-check the key and try again.';
    case 402: return 'Out of credits on this key. Add credits at openrouter.ai and retry.';
    case 403: return 'Forbidden — this key or model isn’t permitted for this request.';
    case 404: return 'Model not found. Pick a different model.';
    case 408: return 'The request timed out. Try again.';
    case 429: return 'Rate limited. Wait a moment and try again.';
    case 502: return 'The model provider had an error. Try again or pick another model.';
    case 503: return 'No provider available for that model right now. Try another model.';
    default:  return `Request failed (HTTP ${status}).`;
  }
}

function aiSystemPrompt() {
  const W = (typeof CV !== 'undefined' && CV.width)  ? CV.width  : 1920;
  const H = (typeof CV !== 'undefined' && CV.height) ? CV.height : 1080;
  return [
`You are the lead UI designer for "Severe UI Builder". Severe draws floating overlay menus on top of a Roblox game — the kind of polished config panel a player toggles open to flip switches, drag sliders, pick options, bind keys and click buttons. Design ONE beautiful, well-organised menu and return it as a single JSON object.`,
`Output JSON ONLY — never Lua, code, prose, comments, or markdown fences.`,
``,
`OUTPUT — EXACTLY this shape:`,
`{ "tabs": ["Main", ...], "elements": [ { "type": <Type>, "name": <unique>, ...fields }, ... ] }`,
``,
`HOW IT RENDERS: the same JSON is drawn by two engines (a retained one and an immediate one), so design with plain shapes, widgets and colours — no animations or per-frame tricks. What you place is exactly what the player sees, in both.`,
``,
`CANVAS: ${W} x ${H} px. Origin top-left, +x right, +y down. Keep everything on-canvas.`,
``,
`TYPES — use ONLY these, never invent a type or a field:`,
`  Shapes:  Square, Circle, Triangle, Line, Polyline, Text`,
`  Widgets: Checkbox, Switch, Slider, Dropdown, Keybind, Button   (interactive — the player actually uses them)`,
`  (Image and Lua are unavailable.)`,
``,
`COORDINATES`,
`  Square / Triangle / Checkbox / Switch / Slider / Dropdown / Keybind / Button -> x,y = top-left, with w,h.`,
`  Circle -> x,y = CENTRE, with radius.`,
`  Text   -> x,y = anchor (left edge, or horizontally centred if "center":true).`,
`  Line / Polyline -> x1,y1 to x2,y2.`,
``,
`PARENTING (always)`,
`  - Make ONE container Square = the window, with "draggable": true.`,
`  - Every other element sets "parent":"<window name>". A child's x,y are RELATIVE to its parent's top-left (0,0 = the parent's corner).`,
`  - You may nest deeper (a "row" or "card" Square inside the window, widgets inside it) to group things cleanly.`,
`  - A child renders above its parent, and dragging the window carries all children with it.`,
``,
`LAYERING (zIndex)`,
`  - Children sit above their parent by default and stack by zIndex (higher = in front).`,
`  - To tuck something BEHIND its parent — e.g. a soft glow / backdrop Square behind the window — give it a zIndex LOWER than the parent's.`,
``,
`TABS / PAGES`,
`  - "tabs" = page names in order. Each element chooses its page with "tab":"<name>".`,
`  - Frame elements shown on EVERY page (window, top bar, title, nav buttons) set "shared":true (their "tab" is ignored).`,
`  - Give each tab one nav Button with "action":"switchTab:<tab name>".`,
``,
`FIELDS BY TYPE (use only these; typical ranges in parens)`,
`  Common:   name(unique), parent, tab | shared, color "#RRGGBB", opacity(0-1), zIndex(int), rotation(deg — Square & Triangle ONLY; a rotated shape can't be dragged, so never rotate the window).`,
`  Square:   x,y,w,h, filled, thickness, rounding(0-16), draggable.`,
`  Circle:   x,y(centre), radius, filled, thickness, numSides(smoothness ~32-64).`,
`  Triangle: x,y,w,h, filled, thickness, rotation.`,
`  Line:     x1,y1,x2,y2, thickness.    Polyline: + filled.`,
`  Text:     text, size(10-24), font, color, center(bool), outline(bool), outlineColor.`,
`  Checkbox: w,h(~16), label, color(box), checkedColor, outlineColor, defaultChecked, textColor, textSize, font, exclusiveGroup(radio-group id).`,
`  Switch:   w(~44),h(~22), label, color(off track), onColor, knobColor, rounding(~11), defaultEnabled, textColor, textSize, font, exclusiveGroup.`,
`  Slider:   w(120-240),h(6-10), color(= fill AND the value-label colour), knobColor, minVal, maxVal, curVal, step, suffix.`,
`  Dropdown: w(120-220),h(26-30), options("A,B,C"), defaultIndex, autoSelectDefault(bool), color(bg), textColor, textSize, font, rounding.`,
`  Keybind:  w(90-130),h(26-30), defaultKey("Insert","F","RightShift"…), action, color, textColor, rounding.`,
`  Button:   w,h(26-36), label, color, hoverColor, textColor, textSize, font, rounding, action, toggleMode, activeColor.`,
`  font: prefer 0 — the clean default, and the one that renders identically in both engines. (0-31 are accepted, but the default reads best.)`,
`  Actions (Keybind & Button): "CustomFunction"(default) | "switchTab:<tab>" | "DestroyUI"(closes the menu). Keybind ALSO: "ToggleUI"(show/hide the menu) | "toggleTarget:<widget name>". Buttons may NOT use ToggleUI or toggleTarget.`,
``,
`DESIGN — make it genuinely good-looking, and vary it (never ship the same template twice)`,
`  - Structure: a clear TOP BAR (full-width Square + a 1-2px accent Line beneath it + a Text title + the nav buttons), then grouped SECTIONS down the body.`,
`  - Section = a small muted Text header (size 10-11) + a thin separator Line + that group's controls, evenly spaced.`,
`  - Grid & spacing: pick a padding (14-18px) and reuse it everywhere; align labels and controls into clean columns (one or two). Leave breathing room — never crowd.`,
`  - Palette: a dark window (around #0b0e14 to #1b212e), optional slightly-lighter section panels, near-white primary text (~#e8ecf2), muted secondary text (~#8a93a6), and ONE vivid accent reused for every highlight (checkedColor, switch onColor, knob, slider fill/colour, active nav, title underline, accent dots).`,
`  - Personality: choose a distinct vibe each time — neon-on-charcoal, frosted slate, cyber-magenta, minimal mono, warm amber, ocean teal… and add tasteful detail: a pair of accent dots in the top bar, a corner accent Line, a thin outlined "card" Square behind a group, a tiny status Text.`,
`  - Typography & rhythm: title 18-24, section headers 10-11, control labels 12-14; consistent rounding; symmetric margins. Aim for balanced, intentional, product-quality layout.`,
``,
`STRICT RULES (never break)`,
`  - JSON only. Only the listed types and fields. Colours "#RRGGBB". Numbers plain. Booleans true/false.`,
`  - Every name unique. Every element inside the canvas and inside the window. parent / tab / action must reference names you actually defined.`,
`  - Widgets are controls — place them where a player would click or drag; never bury them behind an opaque shape.`,
``,
`EDITING (when a CURRENT_UI is provided)`,
`  - It is the existing design; read its ACTUAL values — they are your reference point. First decide the edit kind:`,
`    RELATIVE / INCREMENTAL (less, more, a bit, slightly, too, darker, lighter, bigger, smaller, tighter, softer, reduce, increase, tone down…): keep the design and move ONLY the requested properties a MODERATE step from their CURRENT values. Never overshoot or flip to the opposite — "less light" on a light theme means a little darker, NOT a dark theme. Leave the theme, layout and everything else untouched.`,
`    ABSOLUTE / RESTYLE (names a new theme, accent, colour or look, or says redesign): change those everywhere they apply; do NOT keep the old values.`,
`  - When unsure, treat it as RELATIVE: make the SMALLEST change that satisfies the instruction.`,
`  - Keep element names stable to preserve identity. Always return the COMPLETE updated document, not a diff.`,
  ].join('\n');
}

function docToAi() {
  const tabName = id => (S.tabs.find(t => t.id === id) || {}).name || '';
  const idName  = id => (S.els.find(e => e.id === id) || {}).name || '';
  const keep = ['color','opacity','filled','rounding','thickness','rotation','radius','numSides',
    'text','size','font','center','outline','outlineColor','draggable',
    'label','textColor','textSize','textOutline','hoverColor','activeColor','toggleMode',
    'checkedColor','outlineColor','outlineThickness','defaultChecked','exclusiveGroup',
    'onColor','knobColor','defaultEnabled',
    'minVal','maxVal','curVal','suffix','step',
    'options','defaultIndex','autoSelectDefault','dynamicOptions','maxOptions',
    'defaultKey','tabActiveColor','tabActiveTextColor','dynamicSource','dynamicExpr'];
  return {
    tabs: S.tabs.map(t => t.name),
    elements: S.els.map(e => {
      const o = { type: e.type, name: e.name };
      if (e.shared) o.shared = true; else if (e.tabId) o.tab = tabName(e.tabId);
      if (e.parentId) o.parent = idName(e.parentId);
      if (e.type === 'Line' || e.type === 'Polyline') { o.x1 = e.x1; o.y1 = e.y1; o.x2 = e.x2; o.y2 = e.y2; }
      else if (e.type === 'Circle') { o.x = e.x; o.y = e.y; }
      else { o.x = e.x; o.y = e.y; if (e.w != null) o.w = e.w; if (e.h != null) o.h = e.h; }
      for (const k of keep) if (e[k] !== undefined && e[k] !== '') o[k] = e[k];
      if (typeof o.action === 'undefined' && typeof e.action === 'string') o.action = e.action;
      if (typeof o.action === 'string') {
        if (o.action.startsWith('switchTab:'))    o.action = 'switchTab:'    + tabName(o.action.slice(10));
        else if (o.action.startsWith('toggleTarget:')) o.action = 'toggleTarget:' + idName(o.action.slice(13));
      }
      return o;
    }),
  };
}

const AI_TYPES = new Set(['Square','Circle','Text','Line','Polyline','Triangle',
  'Checkbox','Keybind','Dropdown','Slider','Button','Switch']);

function aiExtractJson(text) {
  if (!text) throw new Error('empty response');
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
  throw new Error('no JSON object found in the response');
}

function aiHex(v, fallback) {
  if (typeof v !== 'string') return fallback;
  let s = v.trim();
  if (/^[0-9a-fA-F]{6}$/.test(s)) s = '#' + s;
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return '#' + s.slice(1).toLowerCase();
  if (/^#?[0-9a-fA-F]{3}$/.test(s)) { const h = s.replace('#', ''); return '#' + h.split('').map(c => c + c).join('').toLowerCase(); }
  return fallback;
}

function aiSet(el, key, val) {
  if (!(key in el)) return;
  const cur = el[key];
  if (/color$/i.test(key)) { el[key] = aiHex(val, cur); return; }
  if (typeof cur === 'boolean') { el[key] = (val === true || val === 'true' || val === 1); return; }
  if (typeof cur === 'number') {
    let n = Number(val);
    if (!isFinite(n)) return;
    if (key === 'opacity') n = Math.max(0, Math.min(1, n));
    else if (key === 'font') n = Math.max(0, Math.min(31, Math.round(n)));
    else if (key === 'w' || key === 'h' || key === 'radius') n = Math.max(1, n);
    else if (key === 'numSides') n = Math.max(3, Math.min(128, Math.round(n)));
    el[key] = n; return;
  }
  if (typeof cur === 'string') { el[key] = String(val).slice(0, 600); return; }
}

function aiBuildDoc(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('response was not a UI object');
  const rEls = Array.isArray(raw.elements) ? raw.elements : [];
  if (!rEls.length) throw new Error('the response contained no elements');

  const stamp = Date.now().toString(36);
  let tabNames = Array.isArray(raw.tabs) ? raw.tabs.filter(n => typeof n === 'string') : [];
  tabNames = tabNames.map(n => n.trim().slice(0, 24)).filter(Boolean).slice(0, 8);
  if (!tabNames.length) tabNames = ['Main'];
  const tabs = tabNames.map((name, i) => ({ id: `tab${stamp}${i}${Math.random().toString(36).slice(2, 5)}`, name }));
  const tabByName = {};
  tabs.forEach(t => { tabByName[t.name.toLowerCase()] = t.id; });

  const els = [];
  const nameToId = {};
  const META = new Set(['type', 'tab', 'shared', 'parent', 'action']);
  for (const r of rEls.slice(0, 400)) {
    if (!r || typeof r !== 'object') continue;
    const type = String(r.type || '').trim();
    if (!AI_TYPES.has(type)) continue;

    const x = Number(r.x) || 0, y = Number(r.y) || 0;
    const el = mkEl(type, x, y);
    if (typeof r.name === 'string' && r.name.trim()) el.name = r.name.trim().slice(0, 60);

    for (const k in r) {
      if (META.has(k)) continue;
      aiSet(el, k, r[k]);
    }

    el.shared = (r.shared === true);
    const tn = typeof r.tab === 'string' ? r.tab.trim().toLowerCase() : '';
    el.tabId = (tn && tabByName[tn]) ? tabByName[tn] : tabs[0].id;

    el.parentId = null;
    el._aiParent = (typeof r.parent === 'string') ? r.parent.trim().toLowerCase() : '';
    el._aiAction = (typeof r.action === 'string') ? r.action.trim() : '';

    els.push(el);
    if (!(el.name.toLowerCase() in nameToId)) nameToId[el.name.toLowerCase()] = el.id;
  }
  if (!els.length) throw new Error('no valid elements (unknown types?)');

  const wouldCycle = (childId, targetId) => {
    let cur = targetId, guard = 0;
    while (cur && guard++ < 999) {
      if (cur === childId) return true;
      const p = els.find(e => e.id === cur);
      cur = p ? p.parentId : null;
    }
    return false;
  };
  for (const el of els) {
    if (el._aiParent && nameToId[el._aiParent]) {
      const pid = nameToId[el._aiParent];
      if (pid !== el.id && !wouldCycle(el.id, pid)) el.parentId = pid;
    }
    if ('action' in el && el._aiAction !== undefined) {
      const a = el._aiAction;
      if (a.startsWith('switchTab:')) {
        const tid = tabByName[a.slice(10).trim().toLowerCase()];
        el.action = tid ? 'switchTab:' + tid : 'CustomFunction';
      } else if (a.startsWith('toggleTarget:')) {
        const id = nameToId[a.slice(13).trim().toLowerCase()];
        el.action = id ? 'toggleTarget:' + id : 'CustomFunction';
      } else if (['CustomFunction', 'ToggleUI', 'DestroyUI'].includes(a)) {
        el.action = a;
      } else if (a) {
        el.action = 'CustomFunction';
      }
      if (el.type === 'Button' && (el.action === 'ToggleUI' || String(el.action).startsWith('toggleTarget:')))
        el.action = 'CustomFunction';
    }
    delete el._aiParent;
    delete el._aiAction;
  }

  return { tabs, activeTab: tabs[0].id, els };
}

function aiApply(doc) {
  pushH();
  S.els       = doc.els;
  S.tabs      = doc.tabs;
  S.activeTab = doc.activeTab;
  S.sel.clear();
  _lastHit = null; _lastClickPos = null;
  if (typeof rebuildCnt === 'function') rebuildCnt();
  if (typeof elNeedsImg === 'function') S.els.filter(elNeedsImg).forEach(loadImg);
  _codeDirty = true;
  updateTabBar(); updateLayers(); updateProps(); updateCallbacks(); render();
  if (typeof updateModeUI === 'function') updateModeUI();
}

const AI_RELATIVE_WORDS = [
  'less','more','bit','slightly','little','too','somewhat','marginally','moderately',
  'subtle','subtler','touch','tad','smidge','notch','barely','tweak','nudge','adjust',
  'darker','lighter','brighter','dimmer','bigger','smaller','larger','wider','narrower',
  'taller','shorter','thinner','thicker','rounder','sharper','bolder','softer','harder',
  'cleaner','tighter','looser','closer','warmer','cooler','duller','calmer','smoother',
  'simpler','denser','neater','stronger','weaker','fainter','heavier','dimmer',
  'increase','decrease','reduce','raise','lower','boost','brighten','darken','lighten',
  'soften','harden','shrink','enlarge','expand','tighten','loosen','mute','calm',
  'intensify','minimize','maximize','dial','tone','desaturate','saturate',
];

function aiIsRelative(text) {
  const t = ' ' + String(text || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  for (let i = 0; i < AI_RELATIVE_WORDS.length; i++) {
    if (t.indexOf(' ' + AI_RELATIVE_WORDS[i] + ' ') !== -1) return true;
  }
  return /\b(not (so|too)|too much|too little|a bit|a little|a touch)\b/.test(t);
}

async function aiGenerate(promptText) {
  const prov = AI_PROVIDERS[AI.provider];
  const hasBase = S.els.length > 0 && S.els.length <= 280;
  const relative = hasBase && aiIsRelative(promptText);
  const messages = [{ role: 'system', content: aiSystemPrompt() }];
  if (hasBase) {
    messages.push({
      role: 'user',
      content: (relative
        ? 'CURRENT_UI (this is your baseline — keep it and nudge ONLY what the instruction asks, measured from these exact values):\n'
        : 'CURRENT_UI (the existing design; restyle, recolor, resize, move, add or remove anything to satisfy the instruction below):\n')
        + JSON.stringify(docToAi()),
    });
  }
  messages.push({
    role: 'user',
    content: (relative
      ? 'INSTRUCTION (a RELATIVE adjustment — apply it as a MODERATE step from the current values; do not overshoot, do not flip to the opposite, keep everything else identical):\n'
      : 'INSTRUCTION (apply fully, overriding the current design where they differ):\n')
      + promptText,
  });

  AI.abort = new AbortController();
  let res;
  try {
    res = await fetch(prov.chatUrl, {
      method: 'POST',
      headers: prov.headers(AI.key),
      signal: AI.abort.signal,
      body: JSON.stringify({
        model: AI.model,
        messages,
        // Fresh build -> creative & varied; full restyle -> still adventurous;
        // relative nudge -> tight so it doesn't overshoot.
        temperature: !hasBase ? 0.85 : (relative ? 0.2 : 0.7),
        response_format: { type: 'json_object' },
      }),
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('Cancelled.');
    throw new Error('Network error reaching the provider. If you opened the file directly (file://), serve it over http.');
  }
  if (!res.ok) {
    let extra = '';
    try { const j = await res.json(); if (j && j.error && j.error.message) extra = ' ' + j.error.message; } catch {}
    throw new Error(aiHttpMessage(res.status) + extra);
  }
  const data = await res.json();
  if (data && data.error && data.error.message) throw new Error(data.error.message);
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content : '';
  let json;
  try { json = aiExtractJson(content); }
  catch (e) { throw new Error('The model did not return valid JSON. Try again, or pick a stronger model.'); }
  const doc = aiBuildDoc(json);
  aiApply(doc);
  const cost = (data.usage && typeof data.usage.cost === 'number') ? ` · ~$${data.usage.cost.toFixed(4)}` : '';
  return { count: doc.els.length, tabs: doc.tabs.length, cost };
}

function aiOpen() {
  if (!SETTINGS.aiExperimental) { toast('Enable the AI Designer in Settings'); return; }
  document.getElementById('ai-modal').classList.add('on');
  aiRender();
  setTimeout(() => {
    const f = document.querySelector('#ai-body input, #ai-body textarea');
    if (f) f.focus();
  }, 30);
}
function aiClose() {
  const m = document.getElementById('ai-modal');
  if (m) m.classList.remove('on');
}

function _esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function aiRender() {
  const body = document.getElementById('ai-body');
  if (!body) return;
  const prov = AI_PROVIDERS[AI.provider];

  if (!AI.key) {
    body.innerHTML = `
      <div class="ai-sec">
        <div class="ai-step">Step 1 — Connect your AI key</div>
        <div class="ai-prov">
          <span class="ai-prov-dot"></span>
          <span>${_esc(prov.label)}</span>
          <span class="ai-prov-soon">more providers soon</span>
        </div>
        <input id="ai-key" class="ai-input" type="password" autocomplete="off" spellcheck="false"
               placeholder="${_esc(prov.keyHint)}" onkeydown="if(event.key==='Enter')aiSaveKey()">
        <div class="ai-priv">&#x1F512; Your key is stored only on this device and sent only to ${_esc(prov.label)} — never saved in projects or seen by anyone else.</div>
        ${AI.err ? `<div class="ai-err">${_esc(AI.err)}</div>` : ''}
        <div class="ai-actions">
          <a class="ai-link" href="${prov.keyHelp}" target="_blank" rel="noreferrer">Get a key &#x2197;</a>
          <div style="flex:1"></div>
          <button class="ai-primary" id="ai-connect" onclick="aiSaveKey()">Connect</button>
        </div>
      </div>`;
    return;
  }

  if (!AI.model) {
    const opts = AI.models.map(m => `<option value="${_esc(m.id)}">${_esc(m.name)}</option>`).join('');
    const pop  = aiSuggestedModels();
    body.innerHTML = `
      <div class="ai-sec">
        ${aiAccountChip()}
        <div class="ai-step" style="margin-top:10px">Step 2 — Choose a model</div>
        <input id="ai-model" class="ai-input" list="ai-models" spellcheck="false"
               placeholder="search a model id, e.g. anthropic/claude-sonnet-4.6"
               onkeydown="if(event.key==='Enter')aiPickModel()">
        <datalist id="ai-models">${opts}</datalist>
        ${pop.length ? `<div class="ai-suggest">${pop.map(id => `<button class="ai-chip" onclick="aiPickModel('${_esc(id)}')">${_esc(id)}</button>`).join('')}</div>` : ''}
        <div class="ai-hint">${AI.models.length ? AI.models.length + ' models available — type to filter.' : 'Type any OpenRouter model id.'} Bigger models design better; cheaper ones cost less.</div>
        <div class="ai-actions">
          <button class="ai-ghost" onclick="aiForgetKey()">Forget key</button>
          <div style="flex:1"></div>
          <button class="ai-primary" onclick="aiPickModel()">Use model</button>
        </div>
      </div>`;
    return;
  }

  const dirtyWarn = S.els.length
    ? `<div class="ai-warn">This replaces the current canvas (${S.els.length} element${S.els.length === 1 ? '' : 's'}). Undo (Ctrl+Z) restores it.</div>` : '';
  body.innerHTML = `
    <div class="ai-sec">
      <div class="ai-chips">
        <button class="ai-chip act" title="Change model" onclick="aiChangeModel()">&#x25C9; ${_esc(AI.model)}</button>
        <button class="ai-chip" title="Manage key" onclick="aiForgetKey()">${_esc(AI.account ? AI.account.label : prov.label)} &#x2715;</button>
      </div>
      <textarea id="ai-prompt" class="ai-prompt" spellcheck="false"
        placeholder="Describe the menu you want…&#10;e.g. A dark aimbot menu named PHANTOM with Aim and Visuals tabs: enable toggle, FOV slider, target-bone dropdown, a purple accent, draggable window, and an Insert keybind to toggle it."></textarea>
      <div class="ai-examples">
        ${aiExamples().map(x => `<button class="ai-ex" onclick="aiFillExample(this)">${_esc(x)}</button>`).join('')}
      </div>
      ${dirtyWarn}
      <div id="ai-status" class="ai-status"></div>
      <div class="ai-actions">
        <span class="ai-note">Uses your ${_esc(prov.label)} credits.</span>
        <div style="flex:1"></div>
        <button class="ai-primary" id="ai-go" onclick="aiDoGenerate()">&#x2726; Generate UI</button>
      </div>
    </div>`;
}

function aiAccountChip() {
  if (!AI.account) return '';
  const rem = (AI.account.remaining != null) ? ` · ${AI.account.remaining} credits left` : '';
  return `<div class="ai-ok">&#x2713; Connected — ${_esc(AI.account.label)}${_esc(rem)}</div>`;
}

function aiSuggestedModels() {
  if (!AI.models.length) return [];
  const want = ['claude', 'gpt-4o', 'gpt-5', 'gemini', 'deepseek', 'grok'];
  const out = [];
  for (const w of want) {
    const m = AI.models.find(x => x.id.toLowerCase().includes(w) && !out.includes(x.id));
    if (m) out.push(m.id);
    if (out.length >= 6) break;
  }
  return out;
}

function aiExamples() {
  return [
    'A sleek 2-tab aimbot + visuals menu, cyan-on-charcoal with accent dots',
    'A minimal single-tab ESP panel: 5 toggles and an FOV slider, magenta accent',
    'A frosted-slate config menu with a Combat / Visuals / Misc tab bar',
    'Recolor everything to a warm amber on near-black theme',
    'Make it more compact and tighten the spacing',
    'Add a Visuals tab with chams, box and skeleton switches',
  ];
}
function aiFillExample(btn) {
  const ta = document.getElementById('ai-prompt');
  if (ta) { ta.value = btn.textContent; ta.focus(); }
}

function aiChangeModel() { AI.model = ''; aiSaveCfg(); aiRender(); }

async function aiSaveKey() {
  const inp = document.getElementById('ai-key');
  const key = inp ? inp.value.trim() : '';
  if (!key) { AI.err = 'Enter your API key first.'; aiRender(); return; }
  const btn = document.getElementById('ai-connect');
  if (btn) { btn.textContent = 'Connecting…'; btn.disabled = true; }
  await aiConnect(key);
}

function aiPickModel(forced) {
  let id = forced;
  if (!id) { const inp = document.getElementById('ai-model'); id = inp ? inp.value.trim() : ''; }
  if (!id) { toast('Type or pick a model id'); return; }
  AI.model = id;
  aiSaveCfg();
  aiRender();
}

async function aiDoGenerate() {
  if (AI.busy) { if (AI.abort) AI.abort.abort(); return; }
  const ta = document.getElementById('ai-prompt');
  const prompt = ta ? ta.value.trim() : '';
  if (!prompt) { toast('Describe what you want first'); return; }

  const go     = document.getElementById('ai-go');
  const status = document.getElementById('ai-status');
  AI.busy = true;
  if (go) { go.classList.add('busy'); go.textContent = '■ Stop'; }
  if (status) status.innerHTML = `<span class="ai-spin"></span> Designing your UI…`;

  try {
    const r = await aiGenerate(prompt);
    if (status) status.innerHTML = `<span class="ai-done">&#x2713;</span> Built ${r.count} elements across ${r.tabs} tab${r.tabs === 1 ? '' : 's'}${_esc(r.cost)}. Tweak it on the canvas or ask for changes.`;
    toast('AI built your UI');
  } catch (e) {
    if (status) status.innerHTML = `<span class="ai-x2">!</span> ${_esc(e.message || 'Generation failed.')}`;
  } finally {
    AI.busy = false; AI.abort = null;
    if (go) { go.classList.remove('busy'); go.innerHTML = '&#x2726; Generate UI'; }
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const m = document.getElementById('ai-modal');
    if (m && m.classList.contains('on')) aiClose();
  }
});

aiInit();
