// components/markdown-render/markdown-render.js
// Lightweight Markdown parser for WeChat mini-program (Skyline compatible)

// Safe string: guarantee non-null string for Skyline WXML bindings
function ss(v) { return v == null ? '' : String(v); }

function parseMarkdown(text) {
  if (!text) return [];

  // Normalize line endings and fix common issues
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = fixMarkdown(text);

  var lines = text.split('\n');
  var blocks = [];
  var i = 0;

  while (i < lines.length) {
    var line = lines[i];

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Code block: ```
    if (line.trim().startsWith('```')) {
      var lang = ss(line.trim().slice(3).trim());
      var codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      blocks.push({ type: 'code', lang: lang, content: ss(codeLines.join('\n')), _copied: false });
      continue;
    }

    // Heading: # ## ### etc.
    var headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      var hContent = ss(headingMatch[2].trim());
      blocks.push({ type: 'heading', level: headingMatch[1].length, content: hContent, segments: parseInline(hContent) });
      i++;
      continue;
    }

    // Horizontal rule: --- or *** or ___
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Table: starts with |
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      var tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      var table = parseTable(tableLines);
      if (table) blocks.push(table);
      continue;
    }

    // Blockquote: >
    if (line.trim().startsWith('>')) {
      var quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      var quoteContent = ss(quoteLines.join('\n'));
      blocks.push({ type: 'blockquote', content: quoteContent, segments: parseInline(quoteContent) });
      continue;
    }

    // Unordered list: - or * or +
    if (/^\s*[-*+]\s+/.test(line)) {
      var items = [];
      var itemSegs = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        var t = ss(lines[i].replace(/^\s*[-*+]\s+/, ''));
        items.push(t);
        itemSegs.push(parseInline(t));
        i++;
      }
      blocks.push({ type: 'ul', items: items, itemSegs: itemSegs });
      continue;
    }

    // Ordered list: 1. 2. etc.
    if (/^\s*\d+\.\s+/.test(line)) {
      var orderedItems = [];
      var orderedSegs = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        var ot = ss(lines[i].replace(/^\s*\d+\.\s+/, ''));
        orderedItems.push(ot);
        orderedSegs.push(parseInline(ot));
        i++;
      }
      blocks.push({ type: 'ol', items: orderedItems, itemSegs: orderedSegs });
      continue;
    }

    // Paragraph: default
    var paraLines = [];
    while (i < lines.length && lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('>') &&
      !lines[i].trim().startsWith('|') &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      var content = ss(paraLines.join('\n'));
      blocks.push({ type: 'paragraph', content: content, segments: parseInline(content) });
    }
  }

  return blocks;
}

function parseTable(tableLines) {
  if (tableLines.length < 2) return null;

  // Parse header
  var headerCells = splitTableRow(tableLines[0]);
  var headerSegs = headerCells.map(function (c) { return parseInline(c); });

  // Check if second row is separator
  var dataStart = 1;
  if (/^\|[\s\-:|]+\|$/.test(tableLines[1])) {
    dataStart = 2;
  }

  // Parse data rows
  var rows = [];
  var rowSegs = [];
  for (var i = dataStart; i < tableLines.length; i++) {
    var cells = splitTableRow(tableLines[i]);
    rows.push(cells);
    rowSegs.push(cells.map(function (c) { return parseInline(c); }));
  }

  return {
    type: 'table',
    headers: headerCells,
    headerSegs: headerSegs,
    rows: rows,
    rowSegs: rowSegs,
  };
}

function splitTableRow(line) {
  // Split | cell1 | cell2 | into ['cell1', 'cell2']
  var cells = line.split('|');
  // Remove first and last empty strings from leading/trailing |
  if (cells.length > 0 && cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map(function (c) { return ss(c.trim()); });
}

var INLINE_RE = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+?)`)|(\[([^\]]+?)\]\(([^)]+?)\))|(~~(.+?)~~)/g;

function parseInline(text) {
  if (!text) return [{ type: 'text', content: '' }];
  var segments = [];
  var last = 0;
  var m;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) {
      segments.push({ type: 'text', content: text.slice(last, m.index) });
    }
    if (m[1]) {
      segments.push({ type: 'bold', content: ss(m[2]) });
    } else if (m[3]) {
      segments.push({ type: 'italic', content: ss(m[4]) });
    } else if (m[5]) {
      segments.push({ type: 'code', content: ss(m[6]) });
    } else if (m[7]) {
      segments.push({ type: 'link', content: ss(m[8]), href: ss(m[9]) });
    } else if (m[10]) {
      segments.push({ type: 'del', content: ss(m[11]) });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    segments.push({ type: 'text', content: text.slice(last) });
  }
  if (segments.length === 0) {
    segments.push({ type: 'text', content: ss(text) });
  }
  return segments;
}

function fixMarkdown(text) {
  // Fix common AI output formatting issues
  var lines = text.split('\n');
  var result = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // Fix bare separator rows like ------ → |---|---|
    if (/^-{2,}(\s+-{2,})+$/.test(line.trim())) {
      var cols = line.trim().split(/\s+/).length;
      var sep = '|';
      for (var j = 0; j < cols; j++) sep += '---|';
      result.push(sep);
      continue;
    }

    // Fix space-separated table rows near separator rows
    if (!line.trim().startsWith('|') && line.trim().length > 0) {
      var parts = line.trim().split(/\s{2,}/);
      if (parts.length >= 2) {
        var prevIsSep = i > 0 && /^[\|\-:\s]+$/.test(lines[i - 1].trim()) && lines[i - 1].trim().includes('---');
        var nextIsSep = i < lines.length - 1 && /^[\|\-:\s]+$/.test(lines[i + 1].trim()) && lines[i + 1].trim().includes('---');
        if (prevIsSep || nextIsSep) {
          result.push('| ' + parts.join(' | ') + ' |');
          continue;
        }
      }
    }

    // Fix || used as row delimiter between table-like rows
    if (line.includes('||') && (line.match(/\|/g) || []).length >= 2) {
      var splitParts = line.replace(/\|\|/g, '|\n|').split('\n');
      for (var k = 0; k < splitParts.length; k++) {
        result.push(splitParts[k]);
      }
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

Component({
  properties: {
    content: {
      type: String,
      value: '',
    },
  },

  data: {
    blocks: [],
  },

  observers: {
    'content': function (newVal) {
      this.setData({ blocks: parseMarkdown(ss(newVal)) });
    },
  },

  methods: {
    onBlockTap: function (e) {
      this.triggerEvent('blocktap', { index: e.currentTarget.dataset.index });
    },
    onLinkTap: function (e) {
      var href = e.currentTarget.dataset.href;
      if (href) {
        this.triggerEvent('linktap', { href: href });
      }
    },
    onCopyCode: function (e) {
      var content = e.currentTarget.dataset.content;
      var idx = e.currentTarget.dataset.index;
      if (!content) return;
      var self = this;
      wx.setClipboardData({
        data: content,
        success: function () {
          var blocks = self.data.blocks.slice();
          if (blocks[idx]) {
            blocks[idx] = Object.assign({}, blocks[idx], { _copied: true });
            self.setData({ blocks: blocks });
            setTimeout(function () {
              var blocks2 = self.data.blocks.slice();
              if (blocks2[idx]) {
                blocks2[idx] = Object.assign({}, blocks2[idx], { _copied: false });
                self.setData({ blocks: blocks2 });
              }
            }, 1500);
          }
        },
      });
    },
  },
});
