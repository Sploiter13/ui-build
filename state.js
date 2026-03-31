'use strict';

/* ═══════════════════════════════════════════
   KEY NAMES
   Strings returned by getpressedkeys() in Severe
═══════════════════════════════════════════ */
const COMMON_KEYS = [
  'Insert','Delete','Home','End','PageUp','PageDown',
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
  'Escape','Space','Return','Tab','Back',
  'LeftShift','RightShift','LeftControl','RightControl','LeftAlt','RightAlt',
  'Up','Down','Left','Right',
  'A','B','C','D','E','F','G','H','I','J','K','L','M',
  'N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
  '0','1','2','3','4','5','6','7','8','9',
  'NumPad0','NumPad1','NumPad2','NumPad3','NumPad4',
  'NumPad5','NumPad6','NumPad7','NumPad8','NumPad9',
];

/* ═══════════════════════════════════════════
   FONT LIST
   Index matches Drawing Text.Font range [0,31]
═══════════════════════════════════════════ */
const FONTS = [
  'UI','System','ProggyClean','DroidSans','Monospace','SourceCodePro',
  'Roboto','Ubuntu','OpenSans','Lato','Nunito','Poppins','Inter','Raleway','Oswald',
  'Merriweather','Playfair','FiraMono','Inconsolata','JetBrains','Hack','Cascadia',
  'Anonymous','Cousine','SpaceMono','Overpass','Noto','Karla','Manrope','DM Sans',
  'Libre','WorkSans',
];

/* ═══════════════════════════════════════════
   UI WIDGET TYPE SET
═══════════════════════════════════════════ */
const UI_TYPES = new Set(['Checkbox','Keybind','Dropdown','Slider','Button']);

/* ═══════════════════════════════════════════
   ACCENT PRESETS + SETTINGS
═══════════════════════════════════════════ */
const ACCENT_PRESETS = {
  blue:   { acc:'#4d90ff', d:'rgba(77,144,255,.10)',  g:'rgba(77,144,255,.06)',  glo:'rgba(77,144,255,.18)'  },
  teal:   { acc:'#00e5a8', d:'rgba(0,229,168,.10)',   g:'rgba(0,229,168,.06)',   glo:'rgba(0,229,168,.18)'   },
  purple: { acc:'#a57fff', d:'rgba(165,127,255,.10)', g:'rgba(165,127,255,.06)', glo:'rgba(165,127,255,.18)' },
  orange: { acc:'#ff7c20', d:'rgba(255,124,32,.10)',  g:'rgba(255,124,32,.06)',  glo:'rgba(255,124,32,.18)'  },
};

const SETTINGS = {
  fontSize:   12,
  font:       'JetBrains Mono',
  compact:    false,
  showGrid:   true,
  gridSize:   24,
  snapDist:   7,
  leftWidth:  192,
  rightWidth: 250,
  accent:     'blue',
};

/* ═══════════════════════════════════════════
   APP STATE
═══════════════════════════════════════════ */
const S = {
  els:       [],           // Element array (source of truth)
  tabs:      [{ id: 'tab1', name: 'Tab 1' }],  // Tab list
  activeTab: 'tab1',       // Currently visible tab ID
  sel:  new Set(),         // Selected element IDs
  tool: 'sel',             // Active tool name
  zoom: 0.5,               // Canvas zoom factor
  hist: [],                // Undo stack (serialised JSON strings)
  fut:  [],                // Redo stack
  cnt:  {},                // Per-type name counters
};

// Transient interaction state (not undoable)
let drg      = null;   // Active drag descriptor
let clip     = [];     // Clipboard (deep-copied elements)
let snaps    = [];     // Snap guide lines for current frame
let ctxEl    = null;   // Element targeted by right-click context menu
let _lastHit = null;   // ID of last hit-tested element (for click-cycling)
