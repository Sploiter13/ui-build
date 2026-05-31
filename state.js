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
const UI_TYPES = new Set(['Checkbox','Keybind','Dropdown','Slider','Button','Switch']);

/* ═══════════════════════════════════════════
   FEATURE FLAGS
═══════════════════════════════════════════ */
// Image drawing relies on DrawingImmediate.Image, which is not present on every
// Severe build (calling it errors and aborts the whole Render). Disabled for now:
// this hides the Image tool and the Button image-url option. The codegen + canvas
// support is left intact and guarded, so flipping this back to true fully restores
// the feature with no other changes.
const IMAGE_ENABLED = false;

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
  fontSize:         12,
  font:             'JetBrains Mono',
  compact:          false,
  showGrid:         true,
  gridSize:         24,
  snapDist:         7,
  leftWidth:        192,
  rightWidth:       250,
  accent:           'blue',
  centerOnViewport: false,   // Offset all positions so the UI centers on the player's actual screen
  aiExperimental:   false,   // Experimental: enable the AI Designer (BYOK OpenRouter). Off by default.
  animExperimental: false,   // Experimental: enable the Animation system. Off by default → zero codegen cost.
};

/* ═══════════════════════════════════════════
   ANIMATION MODEL
   Gated entirely behind SETTINGS.animExperimental. When that flag is off the
   animation UI is hidden and the codegen emits NO animation code (output stays
   byte-identical to a non-animated build).
═══════════════════════════════════════════ */
// Document-level global animation config (saved/loaded with the design). These few
// UI-wide knobs are edited from the WINDOW/root element's panel, not the Settings tab.
// The whole-UI open/close transition is simply the root container's own entrance/exit
// (it cascades to the whole subtree) — so there is no separate windowOpen/Close here.
const ANIM_DEFAULTS = {
  speed:         1,       // playback-speed multiplier — effectiveDuration = base / speed
  intensity:     1,       // global motion-amplitude multiplier (offsets & scale deltas)
  reducedMotion: false,   // collapse every effect to a quick fade / instant
  tabTransition: 'fade',  // none | fade | slide | scale  (applied to a tab's own elements)
};
// Per-element animation config (lives on each element as el.anim).
const EL_ANIM_DEFAULTS = {
  entrance:  'none',
  exit:      'none',
  hover:     'none',
  click:     'none',     // Phase 2 (stored now, no codegen yet)
  toggle:    'none',     // Switch / Checkbox only
  ambient:   'none',     // Phase 2 (stored now, no codegen yet)
  easing:    'inherit',  // inherit → use the effect's natural curve
  duration:  0,          // 0 → effect's default band; else seconds
  intensity: 1,          // per-element amplitude multiplier
};
// Option lists shared by the property UI and the codegen recipe table.
const ANIM_OPTS = {
  entrance: ['none','fadeIn','fadeSoftIn','slideInTop','slideInBottom','slideInLeft','slideInRight','popIn','zoomIn','expandIn','elasticIn','cinematicIn'],
  exit:     ['none','fadeOut','fadeSoftOut','slideOutTop','slideOutBottom','slideOutLeft','slideOutRight','popOut','zoomOut','collapseOut','elasticOut','cinematicOut'],
  hover:    ['none','hoverScaleUp','hoverScaleDown','hoverLift','hoverGlow','hoverFade','hoverPulse'],
  toggle:   ['none','toggleSmooth','toggleElastic','togglePop','toggleFade','toggleBounce'],
  easing:   ['inherit','linear','easeIn','easeOut','easeInOut','easeBack','easeElastic','easeBounce','easeSmooth'],
  tabTransition: ['none','fade','slide','scale'],
};
function defaultAnim()   { return { ...ANIM_DEFAULTS }; }
function defaultElAnim() { return { ...EL_ANIM_DEFAULTS }; }

/* Per-type capability rules — "be smart": only offer animations that make sense.
   - hover/toggle are interactive concepts; toggle is switch/checkbox only.
   - Lines & polylines have no centre/size, so scale/pop/zoom effects are nonsense
     for them → entrance/exit are limited to fade + slide. */
const ANIM_INTERACTIVE = new Set(['Button','Keybind','Dropdown','Slider','Switch','Checkbox']);
const ANIM_FLAT        = new Set(['Line','Polyline']);          // fade + slide only
function animHoverOK(type)  { return ANIM_INTERACTIVE.has(type); }
function animToggleOK(type) { return type === 'Switch' || type === 'Checkbox'; }
function animEntranceOpts(type) {
  return ANIM_FLAT.has(type)
    ? ANIM_OPTS.entrance.filter(o => o === 'none' || o.startsWith('fade') || o.startsWith('slideIn'))
    : ANIM_OPTS.entrance;
}
function animExitOpts(type) {
  return ANIM_FLAT.has(type)
    ? ANIM_OPTS.exit.filter(o => o === 'none' || o.startsWith('fade') || o.startsWith('slideOut'))
    : ANIM_OPTS.exit;
}

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
  drawingMode: 'static',   // 'static' | 'immediate'
  anim: defaultAnim(),     // Document-level animation config (see ANIM_DEFAULTS)
};

// Transient interaction state (not undoable)
let drg      = null;   // Active drag descriptor
let clip     = [];     // Clipboard (deep-copied elements)
let snaps    = [];     // Snap guide lines for current frame (at most 1 x + 1 y)
let ctxEl    = null;   // Element targeted by right-click context menu
let _lastHit = null;   // ID of last hit-tested element (for click-cycling)
let _lastClickPos = null; // World-space position of last hit-test (gates cycling to same-spot clicks)

// Pan state
let _panX      = 0;
let _panY      = 0;
let _panning   = false;
let _panLast   = null;
let _spaceDown = false;
