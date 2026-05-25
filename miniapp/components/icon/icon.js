// components/icon/icon.js
// Skyline-compatible icon paths — using only <circle>, <line>, <rect>, <polygon>
// No <path> elements to avoid Skyline SVG rendering issues
var ICON_PATHS = {
  // Navigation
  'plus': '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  'x': '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  'search': '<circle cx="11" cy="11" r="8"/><line x1="16.69" y1="16.69" x2="21" y2="21"/>',
  'menu': '<line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="18" x2="20" y2="18"/>',
  'arrow-left': '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  'arrow-right': '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  'chevron-right': '<polyline points="9 18 15 12 9 6"/>',

  // Actions
  'trash-2': '<line x1="3" y1="6" x2="21" y2="6"/><rect x="5" y="6" width="14" height="14" rx="1"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/><line x1="8" y1="6" x2="8" y2="4"/><line x1="16" y1="6" x2="16" y2="4"/><line x1="8" y1="4" x2="16" y2="4"/>',
  'pencil': '<line x1="18" y1="2" x2="22" y2="6"/><line x1="15" y1="5" x2="19" y2="9"/><polygon points="3 21 2 22 1.5 16.5 7.5 20.5 21 7 17 3 3.5 16.5"/>',
  'settings': '<circle cx="12" cy="12" r="3"/><line x1="12" y1="1" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="7.05" y2="7.05"/><line x1="16.95" y1="16.95" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="7.05" y2="16.95"/><line x1="16.95" y1="7.05" x2="19.78" y2="4.22"/>',
  'link': '<line x1="10" y1="13" x2="17.07" y2="6.93"/><line x1="14" y1="11" x2="6.93" y2="18.07"/><circle cx="17" cy="7" r="3.54" transform="rotate(-45 17 7)"/><circle cx="7" cy="17" r="3.54" transform="rotate(-45 7 17)"/>',
  'share-2': '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  'log-out': '<polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/><rect x="3" y="3" width="8" height="18" rx="1"/>',
  'send': '<polygon points="22 2 15 22 11 13 2 9 22 2"/><line x1="22" y1="2" x2="11" y2="13"/>',
  'square': '<rect width="18" height="18" x="3" y="3" rx="2"/>',
  'scissors': '<circle cx="6" cy="6" r="3"/><line x1="8.12" y1="8.12" x2="12" y2="12"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><circle cx="6" cy="18" r="3"/><line x1="14.8" y1="14.8" x2="20" y2="20"/>',

  // Star / Favorite
  'star': '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  'heart': '<polygon points="12 21.35 10.55 20.03 5.4 15.36 2 12.22 2 8.5 5.5 5 9.04 5 12 7.96 14.96 5 18.5 5 22 8.5 22 12.22 18.6 15.36 13.45 20.03 12 21.35"/>',

  // AI / Magic
  'sparkles': '<polygon points="12 2 14.07 8.93 21 12 14.07 15.07 12 22 9.93 15.07 3 12 9.93 8.93 12 2"/><line x1="20" y1="2" x2="20" y2="6"/><line x1="22" y1="4" x2="18" y2="4"/><circle cx="4" cy="20" r="2"/>',
  'wand-2': '<line x1="15" y1="4" x2="15" y2="2"/><line x1="15" y1="16" x2="15" y2="14"/><line x1="8" y1="9" x2="10" y2="9"/><line x1="20" y1="9" x2="22" y2="9"/><line x1="17.8" y1="11.8" x2="19" y2="13"/><line x1="15" y1="9" x2="15.01" y2="9"/><line x1="17.8" y1="6.2" x2="19" y2="5"/><line x1="3" y1="21" x2="12" y2="12"/><line x1="12.2" y1="6.2" x2="11" y2="5"/>',
  'lightbulb': '<circle cx="12" cy="9" r="6"/><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/>',
  'brain': '<circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="18"/><line x1="9" y1="13" x2="9" y2="17"/><line x1="15" y1="13" x2="15" y2="17"/><circle cx="7" cy="11" r="2.5"/><circle cx="17" cy="11" r="2.5"/><circle cx="12" cy="18" r="3"/>',

  // User
  'user': '<circle cx="12" cy="7" r="4"/><line x1="4" y1="21" x2="8" y2="17"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="16" y1="17" x2="20" y2="21"/>',

  // Communication
  'users': '<circle cx="9" cy="7" r="4"/><line x1="2" y1="21" x2="6" y2="17"/><line x1="6" y1="17" x2="12" y2="17"/><line x1="12" y1="17" x2="16" y2="21"/><circle cx="17" cy="7" r="3"/><line x1="19" y1="21" x2="18" y2="18"/><line x1="18" y1="18" x2="16" y2="17"/>',
  'message-square': '<rect x="2" y="3" width="20" height="14" rx="2"/><polygon points="6 17 2 21 2 17"/>',
  'message-square-plus': '<rect x="2" y="3" width="20" height="14" rx="2"/><polygon points="6 17 2 21 2 17"/><line x1="12" y1="8" x2="12" y2="14"/><line x1="9" y1="11" x2="15" y2="11"/>',
  'history': '<circle cx="12" cy="12" r="9"/><line x1="12" y1="7" x2="12" y2="12"/><line x1="12" y1="12" x2="16" y2="14"/><polyline points="3 8 3 3 8 3"/>',

  // Tags / Organization
  'tag': '<polygon points="12 2 2 9.17 2 22 12.83 22 22 12.83 22 9.17 12 2"/><circle cx="7.5" cy="7.5" r="1" fill="currentColor"/>',
  'heading': '<line x1="6" y1="12" x2="18" y2="12"/><line x1="6" y1="4" x2="6" y2="20"/><line x1="18" y1="4" x2="18" y2="20"/>',
  'pin': '<line x1="12" y1="17" x2="12" y2="22"/><rect x="6" y="2" width="12" height="8" rx="1"/><line x1="5" y1="17" x2="19" y2="17"/><line x1="5" y1="15.24" x2="7" y2="16.14"/><line x1="17" y1="15.24" x2="19" y2="16.14"/><line x1="8" y1="10" x2="8" y2="15.24"/><line x1="16" y1="10" x2="16" y2="15.24"/>',
  'pin-off': '<line x1="12" y1="17" x2="12" y2="22"/><line x1="2" y1="2" x2="22" y2="22"/><rect x="6" y="2" width="12" height="4" rx="1"/><line x1="5" y1="17" x2="19" y2="17"/><line x1="9" y1="10" x2="9" y2="17"/><line x1="5" y1="15.24" x2="7" y2="16.14"/>',

  // Media / Workspace Icons
  'palette': '<circle cx="12" cy="12" r="10"/><circle cx="13.5" cy="6.5" r="1.5" fill="currentColor"/><circle cx="17.5" cy="10.5" r="1.5" fill="currentColor"/><circle cx="8.5" cy="7.5" r="1.5" fill="currentColor"/><circle cx="6.5" cy="12" r="1.5" fill="currentColor"/>',
  'book-open': '<line x1="12" y1="7" x2="12" y2="21"/><rect x="2" y="3" width="9" height="18" rx="1"/><rect x="13" y="3" width="9" height="18" rx="1"/>',
  'flask-conical': '<line x1="9" y1="2" x2="15" y2="2"/><line x1="10" y1="8" x2="14" y2="8"/><polygon points="6 22 4.72 20.55 10 9.53 10 2 14 2 14 9.53 19.28 20.55 18 22 6 22"/><line x1="7" y1="16.5" x2="17" y2="16.5"/>',
  'music': '<line x1="9" y1="5" x2="21" y2="3"/><line x1="9" y1="18" x2="9" y2="5"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  'rocket': '<circle cx="12" cy="12" r="3"/><line x1="12" y1="9" x2="12" y2="2"/><line x1="4.93" y1="4.93" x2="9.17" y2="9.17"/><line x1="2" y1="12" x2="9" y2="12"/><polygon points="14 15 18 20 16 22 12 15 16 20 18 15"/>',
  'sprout': '<line x1="7" y1="20" x2="17" y2="20"/><line x1="12" y1="20" x2="12" y2="10"/><line x1="12" y1="10" x2="8" y2="5"/><line x1="12" y1="10" x2="16" y2="5"/>',
  'flame': '<circle cx="12" cy="12" r="7"/><line x1="12" y1="5" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="19"/><line x1="5" y1="12" x2="8" y2="12"/><line x1="16" y1="12" x2="19" y2="12"/>',

  // Misc
  'network': '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><line x1="5" y1="13" x2="5" y2="16"/><line x1="5" y1="13" x2="19" y2="13"/><line x1="19" y1="13" x2="19" y2="16"/><line x1="12" y1="8" x2="12" y2="13"/>',
  'cloud': '<circle cx="12" cy="10" r="7"/><circle cx="7" cy="14" r="5"/><circle cx="17" cy="14" r="5"/><line x1="3" y1="19" x2="21" y2="19"/>',
  'zap': '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  'compass': '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  'bot': '<rect x="4" y="8" width="16" height="12" rx="2"/><line x1="12" y1="4" x2="12" y2="8"/><line x1="8" y1="4" x2="12" y2="4"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/><line x1="2" y1="14" x2="4" y2="14"/><line x1="20" y1="14" x2="22" y2="14"/><line x1="15" y1="13" x2="15" y2="15"/><line x1="9" y1="13" x2="9" y2="15"/>',
  'help-circle': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  'check': '<polyline points="20 6 9 17 4 12"/>',
  'target': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  'footprints': '<rect x="3" y="2" width="5" height="8" rx="2.5" transform="rotate(10 5 6)"/><rect x="3" y="12" width="4" height="4" rx="2"/><line x1="4" y1="13" x2="8" y2="13"/><rect x="14" y="6" width="5" height="8" rx="2.5" transform="rotate(-10 16 10)"/><rect x="16" y="16" width="4" height="4" rx="2"/><line x1="16" y1="17" x2="20" y2="17"/>',
  'mic': '<rect x="9" y="2" width="6" height="13" rx="3"/><circle cx="12" cy="12" r="6"/><line x1="12" y1="19" x2="12" y2="22"/>',
};

function iconToSvgDataUri(name, color, size) {
  var paths = ICON_PATHS[name];
  if (!paths) return '';
  paths = paths.replace(/currentColor/g, color);
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2">' + paths + '</svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function svgToBase64(svg) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var result = '';
  var len = svg.length;
  var i = 0;
  while (i < len) {
    var a = svg.charCodeAt(i++);
    var b = i < len ? svg.charCodeAt(i++) : 0;
    var c = i < len ? svg.charCodeAt(i++) : 0;
    result += chars[a >> 2];
    result += chars[((a & 3) << 4) | (b >> 4)];
    result += i > len + 1 ? '=' : chars[((b & 15) << 2) | (c >> 6)];
    result += i > len ? '=' : chars[c & 63];
  }
  return result;
}

Component({
  properties: {
    name: {
      type: String,
      value: '',
    },
    size: {
      type: Number,
      value: 20,
    },
    color: {
      type: String,
      value: '#333333',
    },
  },

  data: {
    src: '',
  },

  observers: {
    'name, size, color': function (name, size, color) {
      this.setData({ src: iconToSvgDataUri(name, color, size) });
    },
  },
});
