// pages/network/network.js

const REPULSION = 8000;
const ATTRACTION = 0.005;
const REST_LENGTH = 120;
const CENTER_FORCE = 0.01;
const DAMPING = 0.85;
const MIN_RADIUS = 24;
const MAX_RADIUS = 40;
const HIT_PADDING = 10;

Page({
  data: {
    allKeywords: [],
    selectedTags: [],
    selectedTagsMap: {},
    simulating: true,
    tooltipNode: null,
    tooltipX: 0,
    tooltipY: 0,
  },

  _nodes: [],
  _edges: [],
  _nodeMap: null,
  _visibleIds: null,
  _ctx: null,
  _canvas: null,
  _canvasW: 0,
  _canvasH: 0,
  _dpr: 1,
  _scale: 1,
  _offsetX: 0,
  _offsetY: 0,
  _highlightId: '',
  _dragNode: null,
  _isPanning: false,
  _touchStartX: 0,
  _touchStartY: 0,
  _touchStartTime: 0,
  _pinchDist: 0,
  _pinchScale: 1,
  _alpha: 1,
  _animFrameId: null,
  _running: false,

  onLoad(options) {
    this._highlightId = options.highlight || '';
    const app = getApp();
    const cards = app.getWorkspaceCards();
    this._buildGraph(cards);
    this._visibleIds = new Set(this._nodes.map(n => n.id));
    this.setData({ allKeywords: app.getTopKeywords(10) });
  },

  onReady() {
    const query = wx.createSelectorQuery();
    query.select('#network-canvas').fields({ node: true, size: true }).exec((res) => {
      if (!res[0] || !res[0].node) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = wx.getWindowInfo().pixelRatio || 2;
      const w = res[0].width;
      const h = res[0].height;

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);

      this._canvas = canvas;
      this._ctx = ctx;
      this._canvasW = w;
      this._canvasH = h;
      this._dpr = dpr;

      this._runBatch(200);
      this._centerGraph();
      this.setData({ simulating: false });
      this._drawGraph();

      this._alpha = 0.3;
      this._startLoop();
    });
  },

  onUnload() {
    this._running = false;
    this._animFrameId = null;
  },

  // ── Build Graph ──

  _buildGraph(cards) {
    const nodeMap = {};
    const nodes = [];
    const edgeMap = {};

    // Build nodes
    cards.forEach(function (card) {
      var text = card.title || card.content || '';
      var label = text.length > 6 ? text.substring(0, 6) + '...' : text;
      var node = {
        id: card.id,
        x: 0, y: 0,
        vx: 0, vy: 0,
        color: card.color,
        label: label,
        fullLabel: card.content || card.title || '',
        keywords: card.keywords || [],
        radius: MIN_RADIUS,
        isFavorite: card.isFavorite,
        degree: 0,
      };
      nodes.push(node);
      nodeMap[card.id] = node;
    });

    // Position nodes in a circle
    var cx = 200;
    var cy = 300;
    var r = Math.max(100, nodes.length * 12);
    nodes.forEach(function (node, i) {
      var angle = (2 * Math.PI * i) / nodes.length;
      node.x = cx + r * Math.cos(angle);
      node.y = cy + r * Math.sin(angle);
    });

    // ── Edge type 1: Manual relations (solid) ──
    cards.forEach(function (card) {
      (card.relatedIds || []).forEach(function (rid) {
        if (!nodeMap[rid]) return;
        var key = card.id < rid ? card.id + '-' + rid : rid + '-' + card.id;
        if (!edgeMap[key]) {
          edgeMap[key] = { source: card.id, target: rid, type: 'related', weight: 1 };
          nodeMap[card.id].degree++;
          nodeMap[rid].degree++;
        }
      });
    });

    // ── Edge type 2: Shared keywords (dashed) ──
    // Build inverted index: keyword → [cardIds]
    var kwIndex = {};
    cards.forEach(function (card) {
      (card.keywords || []).forEach(function (kw) {
        if (!kwIndex[kw]) kwIndex[kw] = [];
        kwIndex[kw].push(card.id);
      });
    });

    // For each keyword, connect all pairs of cards sharing it
    Object.keys(kwIndex).forEach(function (kw) {
      var ids = kwIndex[kw];
      for (var i = 0; i < ids.length; i++) {
        for (var j = i + 1; j < ids.length; j++) {
          var a = ids[i];
          var b = ids[j];
          var key = a < b ? a + '-' + b : b + '-' + a;
          if (edgeMap[key]) {
            // Already has an edge (could be related or keyword) — boost weight
            if (edgeMap[key].type === 'keyword') {
              edgeMap[key].weight++;
              edgeMap[key].keywords.push(kw);
            }
          } else {
            edgeMap[key] = { source: a, target: b, type: 'keyword', weight: 1, keywords: [kw] };
            nodeMap[a].degree++;
            nodeMap[b].degree++;
          }
        }
      }
    });

    // Convert edgeMap to array
    var edges = Object.keys(edgeMap).map(function (key) { return edgeMap[key]; });

    // Update node radius based on degree
    nodes.forEach(function (node) {
      node.radius = MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.min(node.degree / 6, 1);
    });

    this._nodes = nodes;
    this._edges = edges;
    this._nodeMap = nodeMap;
  },

  // ── Force Simulation ──

  _runBatch(iterations) {
    for (var i = 0; i < iterations; i++) {
      this._tick(1 - i / iterations);
    }
  },

  _tick(alpha) {
    var nodes = this._nodes;
    var edges = this._edges;
    var nodeMap = this._nodeMap;
    var n = nodes.length;
    var dragNode = this._dragNode;

    // Repulsion
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var a = nodes[i];
        var b = nodes[j];
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) { dist = 1; dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
        var force = REPULSION * alpha / (dist * dist);
        var fx = (dx / dist) * force;
        var fy = (dy / dist) * force;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }

    // Attraction — keyword edges scale by weight
    for (var e = 0; e < edges.length; e++) {
      var edge = edges[e];
      var s = nodeMap[edge.source];
      var t = nodeMap[edge.target];
      if (!s || !t) continue;
      var dx2 = t.x - s.x;
      var dy2 = t.y - s.y;
      var dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
      var w = edge.weight || 1;
      var force2 = ATTRACTION * w * alpha * (dist2 - REST_LENGTH);
      var fx2 = (dx2 / dist2) * force2;
      var fy2 = (dy2 / dist2) * force2;
      s.vx += fx2; s.vy += fy2;
      t.vx -= fx2; t.vy -= fy2;
    }

    // Center force + velocity update
    var cx = 200;
    var cy = 300;
    for (var k = 0; k < n; k++) {
      var node = nodes[k];
      if (node === dragNode) {
        node.vx = 0; node.vy = 0;
        continue;
      }
      node.vx += (cx - node.x) * CENTER_FORCE * alpha;
      node.vy += (cy - node.y) * CENTER_FORCE * alpha;
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x += node.vx;
      node.y += node.vy;
    }
  },

  _startLoop() {
    if (this._running) return;
    this._running = true;
    var self = this;
    var loop = function () {
      if (!self._running) return;
      if (self._alpha > 0.001) {
        self._tick(self._alpha);
        self._alpha *= 0.995;
        self._drawGraph();
      } else if (self._dragNode) {
        self._tick(0.15);
        self._drawGraph();
      }
      self._animFrameId = self._canvas.requestAnimationFrame(loop);
    };
    this._animFrameId = this._canvas.requestAnimationFrame(loop);
  },

  _reheat() {
    this._alpha = Math.max(this._alpha, 0.3);
  },

  _centerGraph() {
    if (this._nodes.length === 0) return;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < this._nodes.length; i++) {
      var n = this._nodes[i];
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }
    this._offsetX = (minX + maxX) / 2;
    this._offsetY = (minY + maxY) / 2;
    var graphW = maxX - minX + 100;
    var graphH = maxY - minY + 100;
    var scaleX = this._canvasW / graphW;
    var scaleY = this._canvasH / graphH;
    this._scale = Math.min(scaleX, scaleY, 2);
    this._scale = Math.max(this._scale, 0.3);
  },

  // ── Coordinate Transforms ──

  _toScreen(lx, ly) {
    return {
      x: (lx - this._offsetX) * this._scale + this._canvasW / 2,
      y: (ly - this._offsetY) * this._scale + this._canvasH / 2,
    };
  },

  _toLogical(sx, sy) {
    return {
      x: (sx - this._canvasW / 2) / this._scale + this._offsetX,
      y: (sy - this._canvasH / 2) / this._scale + this._offsetY,
    };
  },

  // ── Canvas Rendering ──

  _drawGraph() {
    var ctx = this._ctx;
    if (!ctx) return;
    var w = this._canvasW;
    var h = this._canvasH;
    var nodes = this._nodes;
    var edges = this._edges;
    var visible = this._visibleIds;
    var nodeMap = {};
    for (var ni = 0; ni < nodes.length; ni++) nodeMap[nodes[ni].id] = nodes[ni];

    // Clear
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#F9FAFC';
    ctx.fillRect(0, 0, w, h);

    // Draw edges
    for (var ei = 0; ei < edges.length; ei++) {
      var edge = edges[ei];
      if (!visible.has(edge.source) || !visible.has(edge.target)) continue;
      var s = nodeMap[edge.source];
      var t = nodeMap[edge.target];
      if (!s || !t) continue;
      var sp = this._toScreen(s.x, s.y);
      var tp = this._toScreen(t.x, t.y);

      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(tp.x, tp.y);

      if (edge.type === 'keyword') {
        var kwWeight = edge.weight || 1;
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(184, 169, 212, ' + (0.2 + kwWeight * 0.1) + ')';
        ctx.lineWidth = 1 + kwWeight * 0.5;
      } else {
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(148, 180, 200, 0.5)';
        ctx.lineWidth = 2;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Draw nodes
    for (var di = 0; di < nodes.length; di++) {
      var node = nodes[di];
      if (!visible.has(node.id)) continue;
      var sp2 = this._toScreen(node.x, node.y);
      var r = node.radius * this._scale * 0.5;
      var isHighlight = node.id === this._highlightId;

      if (isHighlight) {
        ctx.beginPath();
        ctx.arc(sp2.x, sp2.y, r + 8, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(148, 180, 200, 0.25)';
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(sp2.x, sp2.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = node.color;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;

      if (isHighlight) {
        ctx.strokeStyle = node.color;
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      if (node.isFavorite) {
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#E8A0A0';
        ctx.textAlign = 'center';
        ctx.fillText('❤', sp2.x + r * 0.6, sp2.y - r * 0.6);
      }

      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#2C3E50';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(node.label, sp2.x, sp2.y + r + 4);

      if (isHighlight && node.keywords.length > 0) {
        ctx.font = '10px sans-serif';
        ctx.fillStyle = node.color;
        ctx.fillText(node.keywords[0], sp2.x, sp2.y - r - 14);
      }
    }
  },

  // ── Hit Test ──

  _hitTest(sx, sy) {
    var pos = this._toLogical(sx, sy);
    var closest = null;
    var closestDist = Infinity;
    for (var i = 0; i < this._nodes.length; i++) {
      var node = this._nodes[i];
      if (!this._visibleIds.has(node.id)) continue;
      var dx = pos.x - node.x;
      var dy = pos.y - node.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < node.radius + HIT_PADDING && dist < closestDist) {
        closest = node;
        closestDist = dist;
      }
    }
    return closest;
  },

  // ── Touch ──

  onTouchStart(e) {
    if (!e.touches || e.touches.length === 0) return;
    var touch = e.touches[0];
    this._touchStartX = touch.x;
    this._touchStartY = touch.y;
    this._touchStartTime = Date.now();

    if (e.touches.length === 2) {
      var t0 = e.touches[0];
      var t1 = e.touches[1];
      this._pinchDist = Math.sqrt((t1.x - t0.x) * (t1.x - t0.x) + (t1.y - t0.y) * (t1.y - t0.y));
      this._pinchScale = this._scale;
      this._dragNode = null;
      this._isPanning = false;
      return;
    }

    var hit = this._hitTest(touch.x, touch.y);
    if (hit) {
      this._dragNode = hit;
      this._isPanning = false;
    } else {
      this._dragNode = null;
      this._isPanning = true;
    }
    this.setData({ tooltipNode: null });
  },

  onTouchMove(e) {
    if (!e.touches || e.touches.length === 0) return;

    if (e.touches.length === 2) {
      var t0 = e.touches[0];
      var t1 = e.touches[1];
      var dist = Math.sqrt((t1.x - t0.x) * (t1.x - t0.x) + (t1.y - t0.y) * (t1.y - t0.y));
      if (this._pinchDist > 0) {
        this._scale = Math.max(0.3, Math.min(3, this._pinchScale * (dist / this._pinchDist)));
        this._reheat();
      }
      return;
    }

    var touch = e.touches[0];
    var dx = touch.x - this._touchStartX;
    var dy = touch.y - this._touchStartY;

    if (this._dragNode) {
      var logical = this._toLogical(touch.x, touch.y);
      this._dragNode.x = logical.x;
      this._dragNode.y = logical.y;
      this._dragNode.vx = 0;
      this._dragNode.vy = 0;
      this._reheat();
    } else if (this._isPanning) {
      this._offsetX -= dx / this._scale;
      this._offsetY -= dy / this._scale;
      this._touchStartX = touch.x;
      this._touchStartY = touch.y;
      this._drawGraph();
    }
  },

  onTouchEnd(e) {
    var now = Date.now();
    var elapsed = now - this._touchStartTime;

    if (this._dragNode && elapsed < 300) {
      var endTouch = e.changedTouches && e.changedTouches[0];
      if (endTouch) {
        var dx = endTouch.x - this._touchStartX;
        var dy = endTouch.y - this._touchStartY;
        if (Math.sqrt(dx * dx + dy * dy) < 10) {
          var sp = this._toScreen(this._dragNode.x, this._dragNode.y);
          // Find shared keywords with connected nodes for tooltip
          var sharedKws = this._getSharedKeywords(this._dragNode.id);
          var tooltipData = {
            id: this._dragNode.id,
            color: this._dragNode.color,
            fullLabel: this._dragNode.fullLabel,
            keywords: this._dragNode.keywords,
            sharedKeywords: sharedKws,
          };
          this.setData({
            tooltipNode: tooltipData,
            tooltipX: sp.x * (750 / this._canvasW),
            tooltipY: (sp.y - this._dragNode.radius * this._scale * 0.5 - 20) * (750 / this._canvasW),
          });
        }
      }
    }

    this._dragNode = null;
    this._isPanning = false;
    this._pinchDist = 0;
    this._reheat();
  },

  _getSharedKeywords(nodeId) {
    var kws = [];
    for (var i = 0; i < this._edges.length; i++) {
      var edge = this._edges[i];
      if (edge.type === 'keyword') {
        if (edge.source === nodeId || edge.target === nodeId) {
          kws = kws.concat(edge.keywords || []);
        }
      }
    }
    var seen = {};
    var unique = [];
    for (var j = 0; j < kws.length; j++) {
      if (!seen[kws[j]]) {
        seen[kws[j]] = true;
        unique.push(kws[j]);
      }
    }
    return unique;
  },

  // ── Navigation ──

  onTooltipTap() {
    if (this.data.tooltipNode) {
      wx.navigateTo({ url: '/pages/card-detail/card-detail?id=' + this.data.tooltipNode.id });
    }
  },

  onResetView() {
    this._scale = 1;
    this._centerGraph();
    this._drawGraph();
  },

  // ── Filter ──

  onFilterSelect(e) {
    var tag = e.currentTarget.dataset.tag;
    var selectedTags = this.data.selectedTags.slice();

    if (tag === '全部') {
      selectedTags = [];
    } else {
      var idx = selectedTags.indexOf(tag);
      if (idx !== -1) {
        selectedTags.splice(idx, 1);
      } else {
        selectedTags.push(tag);
      }
    }
    var tagsMap = {};
    selectedTags.forEach(function (t) { tagsMap[t] = true; });
    this.setData({ selectedTags: selectedTags, selectedTagsMap: tagsMap });
    this._applyFilter(selectedTags);
  },

  _applyFilter(selectedTags) {
    if (selectedTags.length === 0) {
      this._visibleIds = new Set(this._nodes.map(function (n) { return n.id; }));
    } else {
      var self = this;
      var tagIds = new Set();
      self._nodes.forEach(function (n) {
        for (var i = 0; i < selectedTags.length; i++) {
          if (n.keywords.indexOf(selectedTags[i]) !== -1) {
            tagIds.add(n.id);
            break;
          }
        }
      });
      var connectedIds = new Set(tagIds);
      for (var i = 0; i < self._edges.length; i++) {
        var edge = self._edges[i];
        if (tagIds.has(edge.source)) connectedIds.add(edge.target);
        if (tagIds.has(edge.target)) connectedIds.add(edge.source);
      }
      this._visibleIds = connectedIds;
    }
    this._drawGraph();
  },
});
