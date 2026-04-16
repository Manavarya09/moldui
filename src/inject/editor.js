(function() {
  'use strict';
  if (window.__MOLDUI_ACTIVE__) return;
  window.__MOLDUI_ACTIVE__ = true;

  // ── Shadow DOM Host ──────────────────────────────────────
  var host = document.createElement('div');
  host.id = '__moldui-host__';
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
  document.body.appendChild(host);
  var shadow = host.attachShadow({ mode: 'open' });

  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/__moldui__/editor.css';
  shadow.appendChild(link);

  var overlay = document.createElement('div');
  overlay.className = 'moldui-overlay';
  shadow.appendChild(overlay);

  // ── State ────────────────────────────────────────────────
  var state = { selected: null, hovered: null, mode: 'select', wsConnected: false };

  // Prevent all form submissions and link navigations while editor is active
  document.addEventListener('submit', function(e) { e.preventDefault(); }, true);

  // ── WebSocket ────────────────────────────────────────────
  var wsPort = window.__MOLDUI_WS_PORT__ || 4445;
  var ws;

  function connectWS() {
    try {
      ws = new WebSocket('ws://localhost:' + wsPort);
      ws.onopen = function() { state.wsConnected = true; updateStatusBar(); };
      ws.onclose = function() { state.wsConnected = false; updateStatusBar(); setTimeout(connectWS, 2000); };
      ws.onmessage = function(e) { try { handleServerMsg(JSON.parse(e.data)); } catch(x) {} };
    } catch(x) { setTimeout(connectWS, 2000); }
  }
  connectWS();

  function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
  function sendChange(c) { send({ type: 'change', payload: c }); }

  function handleServerMsg(msg) {
    if (msg.type === 'synced') showShimmer('synced', 'Synced to ' + (msg.payload.file || 'source'));
    else if (msg.type === 'status' && msg.payload.state === 'writing') showShimmer('working', msg.payload.file ? 'Rewriting ' + msg.payload.file + '...' : 'AI is rewriting...');
    else if (msg.type === 'status' && msg.payload.state === 'idle') hideShimmer();
    else if (msg.type === 'error') showShimmer('error', msg.payload.message || 'Error');
  }

  // ── Helpers ──────────────────────────────────────────────
  function isEditor(el) { return el && (el === host || host.contains(el) || el.id === '__moldui-host__'); }

  function getDirectText(el) {
    // Get visible text content, works for buttons, spans, links, headings, etc.
    if (!el || !el.textContent) return '';
    var text = el.textContent.trim();
    if (!text) return '';
    // Must be relatively short (actual text, not a container with lots of nested content)
    if (text.length > 500) return '';
    // Must have some text nodes (direct or in immediate children)
    var hasText = false;
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && n.textContent.trim()) { hasText = true; break; }
      if (n.nodeType === 1 && n.children.length === 0 && n.textContent.trim()) { hasText = true; break; }
    }
    return hasText ? text : '';
  }

  function elLabel(el) {
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    var cls = Array.from(el.classList).filter(Boolean).slice(0, 2);
    if (cls.length) s += '.' + cls.join('.');
    return s;
  }

  function desc(el) {
    var r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(), id: el.id || null,
      classes: Array.from(el.classList).filter(Boolean),
      textContent: (el.textContent || '').trim().slice(0, 100),
      selector: cssPath(el),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height }
    };
  }

  function cssPath(el) {
    var parts = [], cur = el;
    while (cur && cur !== document.body && parts.length < 5) {
      var s = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift(s + '#' + cur.id); break; }
      var p = cur.parentElement;
      if (p) {
        var sibs = Array.from(p.children).filter(function(c) { return c.tagName === cur.tagName; });
        if (sibs.length > 1) s += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      }
      parts.unshift(s);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function rgb2hex(rgb) {
    if (!rgb || rgb === 'transparent' || rgb.startsWith('#')) return rgb || '#000000';
    var m = rgb.match(/(\d+)/g);
    if (!m || m.length < 3) return '#000000';
    return '#' + m.slice(0, 3).map(function(v) { return Number(v).toString(16).padStart(2, '0'); }).join('');
  }

  function mk(tag, cls, parent) {
    var el = document.createElement(tag);
    el.className = cls;
    if (parent) parent.appendChild(el);
    return el;
  }

  // ── Selection Layer ──────────────────────────────────────
  var selBox = mk('div', 'moldui-selection-box', overlay);
  var hovBox = mk('div', 'moldui-hover-box', overlay);
  var hovLabel = mk('div', 'moldui-hover-label', overlay);
  var handleWrap = mk('div', 'moldui-handles', overlay);
  var handles = {};
  ['nw','n','ne','e','se','s','sw','w'].forEach(function(pos) {
    var h = mk('div', 'moldui-handle moldui-handle-' + pos, handleWrap);
    h.dataset.pos = pos;
    h.style.pointerEvents = 'auto';
    handles[pos] = h;
  });

  // ── Spacing Guides ────────────────────────────────────────
  var guides = mk('div', 'moldui-guides', overlay);

  function showGuides(selRect, hovRect) {
    while (guides.firstChild) guides.removeChild(guides.firstChild);
    guides.style.display = 'block';

    // Vertical distance
    if (hovRect.top > selRect.bottom) {
      // Below
      var dist = Math.round(hovRect.top - selRect.bottom);
      drawGuide(selRect.left + selRect.width / 2, selRect.bottom, selRect.left + selRect.width / 2, hovRect.top, dist);
    } else if (selRect.top > hovRect.bottom) {
      // Above
      var dist = Math.round(selRect.top - hovRect.bottom);
      drawGuide(selRect.left + selRect.width / 2, hovRect.bottom, selRect.left + selRect.width / 2, selRect.top, dist);
    }

    // Horizontal distance
    if (hovRect.left > selRect.right) {
      var distH = Math.round(hovRect.left - selRect.right);
      drawGuide(selRect.right, selRect.top + selRect.height / 2, hovRect.left, selRect.top + selRect.height / 2, distH);
    } else if (selRect.left > hovRect.right) {
      var distH2 = Math.round(selRect.left - hovRect.right);
      drawGuide(hovRect.right, selRect.top + selRect.height / 2, selRect.left, selRect.top + selRect.height / 2, distH2);
    }
  }

  function drawGuide(x1, y1, x2, y2, dist) {
    if (dist < 1) return;
    var line = mk('div', 'moldui-guide-line', guides);
    var isVert = x1 === x2;
    if (isVert) {
      line.style.cssText = 'position:fixed;left:' + x1 + 'px;top:' + Math.min(y1, y2) + 'px;width:1px;height:' + Math.abs(y2 - y1) + 'px;';
    } else {
      line.style.cssText = 'position:fixed;left:' + Math.min(x1, x2) + 'px;top:' + y1 + 'px;width:' + Math.abs(x2 - x1) + 'px;height:1px;';
    }
    var label = mk('div', 'moldui-guide-label', guides);
    label.textContent = dist + 'px';
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    label.style.cssText = 'position:fixed;left:' + mx + 'px;top:' + my + 'px;transform:translate(-50%,-50%);';
  }

  function hideGuides() {
    while (guides.firstChild) guides.removeChild(guides.firstChild);
    guides.style.display = 'none';
  }

  function posBox(box, r) {
    box.style.cssText = 'display:block;position:fixed;top:' + r.top + 'px;left:' + r.left + 'px;width:' + r.width + 'px;height:' + r.height + 'px;pointer-events:none;';
  }

  function selectEl(el) {
    if (!el || isEditor(el)) return;
    state.selected = el;
    var r = el.getBoundingClientRect();
    posBox(selBox, r);
    handleWrap.style.cssText = 'display:block;position:fixed;top:' + r.top + 'px;left:' + r.left + 'px;width:' + r.width + 'px;height:' + r.height + 'px;';
    showToolbar(el);
    updateBreadcrumb(el);
    if (stylePanelOpen) renderStylePanel(el);
  }

  function deselectEl() {
    state.selected = null;
    selBox.style.display = 'none';
    handleWrap.style.display = 'none';
    toolbar.style.display = 'none';
    breadcrumb.style.display = 'none';
    hideStylePanel();
    hideGuides();
  }

  function syncSel() {
    if (!state.selected) return;
    var r = state.selected.getBoundingClientRect();
    posBox(selBox, r);
    handleWrap.style.cssText = 'display:block;position:fixed;top:' + r.top + 'px;left:' + r.left + 'px;width:' + r.width + 'px;height:' + r.height + 'px;';
    showToolbar(state.selected);
  }
  window.addEventListener('scroll', syncSel, true);
  window.addEventListener('resize', syncSel);

  // ── Hover + Click ────────────────────────────────────────
  document.addEventListener('mousemove', function(e) {
    if (state.mode !== 'select') return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isEditor(el) || el === state.selected) {
      hovBox.style.display = 'none'; hovLabel.style.display = 'none';
      hideGuides();
      return;
    }
    var r = el.getBoundingClientRect();
    posBox(hovBox, r);
    hovLabel.style.cssText = 'display:block;position:fixed;top:' + (r.top - 22) + 'px;left:' + r.left + 'px;pointer-events:none;';
    hovLabel.textContent = elLabel(el);
    // Show spacing guides between selected and hovered element
    if (state.selected && el !== state.selected && !isEditor(el)) {
      showGuides(state.selected.getBoundingClientRect(), el.getBoundingClientRect());
    } else {
      hideGuides();
    }
  }, true);

  document.addEventListener('click', function(e) {
    if (state.mode !== 'select') return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (isEditor(el)) return;
    e.preventDefault(); e.stopPropagation();
    if (el) selectEl(el); else deselectEl();
  }, true);

  document.addEventListener('click', function(e) { if (state.selected && e.target.closest('a')) e.preventDefault(); }, true);

  // ── Drag Engine ──────────────────────────────────────────
  var dragSt = null;

  function startDrag(el, x, y) {
    var r = el.getBoundingClientRect();
    var parent = el.parentElement;
    var sibs = parent ? Array.from(parent.children) : [];
    var ghost = el.cloneNode(true);
    ghost.style.cssText = 'position:fixed;top:' + r.top + 'px;left:' + r.left + 'px;width:' + r.width + 'px;height:' + r.height + 'px;opacity:0.6;pointer-events:none;z-index:2147483646;transition:none;';
    document.body.appendChild(ghost);
    var ph = document.createElement('div');
    ph.style.cssText = 'width:' + r.width + 'px;height:4px;background:#3b82f6;border-radius:2px;margin:2px 0;transition:all 0.15s;';
    dragSt = { el: el, x: x, y: y, r: r, parent: parent, sibs: sibs, startIdx: sibs.indexOf(el), ghost: ghost, ph: ph };
    el.style.opacity = '0.3';
    state.mode = 'drag';
  }

  function onDrag(e) {
    if (!dragSt) return;
    dragSt.ghost.style.top = (dragSt.r.top + e.clientY - dragSt.y) + 'px';
    dragSt.ghost.style.left = (dragSt.r.left + e.clientX - dragSt.x) + 'px';

    // Find the container under the cursor (skip the ghost and the dragged element)
    dragSt.ghost.style.pointerEvents = 'none';
    dragSt.el.style.pointerEvents = 'none';
    var dropTarget = document.elementFromPoint(e.clientX, e.clientY);
    dragSt.el.style.pointerEvents = '';

    if (!dropTarget || isEditor(dropTarget)) return;

    // Find the nearest container (element with children that isn't inline text)
    var container = dropTarget;
    while (container && container !== document.body) {
      var ccs = getComputedStyle(container);
      var isContainer = ccs.display === 'flex' || ccs.display === 'grid' || ccs.display === 'block' || ccs.display === 'inline-flex';
      if (isContainer && container.children.length > 0 && container !== dragSt.el) break;
      container = container.parentElement;
    }
    if (!container || container === document.body) container = dragSt.parent;

    // Find insertion point within this container
    var children = Array.from(container.children).filter(function(c) { return c !== dragSt.el && c !== dragSt.ph; });
    var before = null;
    for (var i = 0; i < children.length; i++) {
      var cr = children[i].getBoundingClientRect();
      // For vertical layouts, check Y; for horizontal, check X
      var parentCs = getComputedStyle(container);
      if (parentCs.flexDirection === 'row' || parentCs.flexDirection === 'row-reverse') {
        if (e.clientX < cr.left + cr.width / 2) { before = children[i]; break; }
      } else {
        if (e.clientY < cr.top + cr.height / 2) { before = children[i]; break; }
      }
    }

    // Update placeholder
    if (dragSt.ph.parentElement) dragSt.ph.remove();
    if (before) container.insertBefore(dragSt.ph, before);
    else container.appendChild(dragSt.ph);

    // Track the target container
    dragSt.targetContainer = container;
  }

  function endDrag() {
    if (!dragSt) return;
    var el = dragSt.el, ghost = dragSt.ghost, ph = dragSt.ph, parent = dragSt.parent, startIdx = dragSt.startIdx;
    var targetContainer = dragSt.targetContainer || parent;
    var newIdx = -1;

    if (ph.parentElement) {
      newIdx = Array.from(targetContainer.children).indexOf(ph);
      targetContainer.insertBefore(el, ph);
      ph.remove();
    }
    ghost.remove();
    el.style.opacity = '';
    el.style.pointerEvents = '';

    var moved = (targetContainer !== parent) || (newIdx !== startIdx);
    if (moved) {
      sendChange({
        type: 'reorder', element: desc(el), selector: cssPath(el),
        fromIndex: startIdx, toIndex: newIdx,
        fromParent: cssPath(parent), toParent: cssPath(targetContainer),
        siblingCount: Array.from(targetContainer.children).length,
        url: location.pathname
      });
    }
    dragSt = null; state.mode = 'select'; selectEl(el);
  }

  // ── Resize Engine ────────────────────────────────────────
  var rszSt = null;

  function startResize(el, pos, x, y) {
    var cs = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    rszSt = {
      el: el, pos: pos, x: x, y: y,
      w: r.width, h: r.height,
      startRect: { top: r.top, left: r.left, width: r.width, height: r.height },
      minW: parseFloat(cs.minWidth) || 10,
      minH: parseFloat(cs.minHeight) || 10,
      maxW: cs.maxWidth === 'none' ? Infinity : parseFloat(cs.maxWidth),
      maxH: cs.maxHeight === 'none' ? Infinity : parseFloat(cs.maxHeight)
    };
    state.mode = 'resize';
    showDim(el);
  }

  function onResize(e) {
    if (!rszSt) return;
    var dx = e.clientX - rszSt.x, dy = e.clientY - rszSt.y;
    var w = rszSt.w, h = rszSt.h;
    if (rszSt.pos.indexOf('e') >= 0) w = rszSt.w + dx;
    if (rszSt.pos.indexOf('w') >= 0) w = rszSt.w - dx;
    if (rszSt.pos.indexOf('s') >= 0) h = rszSt.h + dy;
    if (rszSt.pos.indexOf('n') >= 0) h = rszSt.h - dy;
    w = Math.max(rszSt.minW, Math.min(rszSt.maxW, w));
    h = Math.max(rszSt.minH, Math.min(rszSt.maxH, h));
    rszSt.el.style.width = w + 'px';
    rszSt.el.style.height = h + 'px';
    syncSel(); showDim(rszSt.el);
  }

  function endResize() {
    if (!rszSt) return;
    var cs = getComputedStyle(rszSt.el);
    var nw = parseFloat(cs.width), nh = parseFloat(cs.height);
    var changes = {};
    if (nw !== rszSt.w) changes.width = { from: rszSt.w + 'px', to: nw + 'px' };
    if (nh !== rszSt.h) changes.height = { from: rszSt.h + 'px', to: nh + 'px' };
    if (Object.keys(changes).length) {
      sendChange({ type: 'style', element: desc(rszSt.el), selector: cssPath(rszSt.el), changes: changes, url: location.pathname });
    }
    hideDim(); rszSt = null; state.mode = 'select';
  }

  Object.values(handles).forEach(function(h) {
    h.addEventListener('mousedown', function(e) {
      e.stopPropagation();
      if (state.selected) startResize(state.selected, this.dataset.pos, e.clientX, e.clientY);
    });
  });

  document.addEventListener('mousedown', function(e) {
    if (!state.selected || isEditor(e.target) || state.mode !== 'select') return;
    // Check if click is on the selected element or any of its children
    if (state.selected.contains(e.target) || e.target === state.selected) {
      e.preventDefault();
      startDrag(state.selected, e.clientX, e.clientY);
    }
  }, true);

  document.addEventListener('mousemove', function(e) {
    if (dragSt) onDrag(e);
    if (rszSt) onResize(e);
  }, true);

  document.addEventListener('mouseup', function() {
    if (dragSt) endDrag();
    if (rszSt) endResize();
  }, true);

  // ── Inline Text Editing ──────────────────────────────────
  var textEdit = null;

  document.addEventListener('dblclick', function(e) {
    var target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || isEditor(target)) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();

    // Find the best text-editable element — walk up to find element with actual visible text
    var el = target;
    // If the element has no text itself, don't try
    var text = getDirectText(el);
    if (!text) {
      // Try parent — maybe user clicked a span inside a button
      if (el.parentElement && getDirectText(el.parentElement)) {
        el = el.parentElement;
        text = getDirectText(el);
      } else {
        return;
      }
    }

    var old = text;
    el.contentEditable = 'true';
    el.focus();
    state.mode = 'text';
    textEdit = { el: el, old: old };
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, true);

  function commitText() {
    if (!textEdit) return;
    textEdit.el.contentEditable = 'false';
    var nw = textEdit.el.textContent.trim();
    if (nw !== textEdit.old) sendChange({ type: 'text', element: desc(textEdit.el), selector: cssPath(textEdit.el), oldText: textEdit.old, newText: nw, url: location.pathname });
    textEdit = null; state.mode = 'select';
  }

  function cancelText() {
    if (!textEdit) return;
    textEdit.el.textContent = textEdit.old;
    textEdit.el.contentEditable = 'false';
    textEdit = null; state.mode = 'select';
  }

  // ── Keyboard Shortcuts ───────────────────────────────────
  document.addEventListener('keydown', function(e) {
    if (textEdit) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
      else if (e.key === 'Escape') cancelText();
      return;
    }
    if (e.key === 'Escape') deselectEl();
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); send({ type: e.shiftKey ? 'redo' : 'undo' }); }
    if (e.key === 's' && !e.metaKey && !e.ctrlKey && !textEdit) { e.preventDefault(); toggleStylePanel(); }
    if (e.key === 'Delete' && state.selected) hideSelectedEl();
    if (state.selected && !textEdit && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].indexOf(e.key) >= 0) {
      e.preventDefault();
      var amount = e.shiftKey ? 10 : 1; // Shift = 10px steps
      var prop, dir;
      if (e.key === 'ArrowUp') { prop = 'marginTop'; dir = -1; }
      else if (e.key === 'ArrowDown') { prop = 'marginTop'; dir = 1; }
      else if (e.key === 'ArrowLeft') { prop = 'marginLeft'; dir = -1; }
      else if (e.key === 'ArrowRight') { prop = 'marginLeft'; dir = 1; }

      var cs = getComputedStyle(state.selected);
      var cur = parseInt(cs[prop]) || 0;
      var newVal = (cur + dir * amount) + 'px';
      var oldVal = cs[prop];
      state.selected.style[prop] = newVal;
      syncSel();
      sendChange({ type: 'style', element: desc(state.selected), selector: cssPath(state.selected), changes: { [prop]: { from: oldVal, to: newVal } }, url: location.pathname });
    }
  }, true);

  // ── Floating Toolbar ─────────────────────────────────────
  var toolbar = mk('div', 'moldui-toolbar', overlay);
  toolbar.style.pointerEvents = 'auto';
  var tbBtns = [
    { a: 'text', label: 'Edit Text' },
    { a: 'style', label: 'Style' },
    { a: 'dup', label: 'Duplicate' },
    { a: 'hide', label: 'Hide' }
  ];
  tbBtns.forEach(function(b) {
    var btn = document.createElement('button');
    btn.dataset.a = b.a;
    btn.textContent = b.label;
    toolbar.appendChild(btn);
  });

  toolbar.addEventListener('click', function(e) {
    var btn = e.target.closest('button');
    if (!btn || !state.selected) return;
    var a = btn.dataset.a;
    if (a === 'style') toggleStylePanel();
    if (a === 'dup') dupSelectedEl();
    if (a === 'hide') hideSelectedEl();
    if (a === 'text') {
      var r = state.selected.getBoundingClientRect();
      state.selected.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 }));
    }
  });

  function showToolbar(el) {
    var r = el.getBoundingClientRect();
    var t = r.top - 42;
    toolbar.style.cssText = 'display:flex;position:fixed;top:' + (t < 5 ? r.bottom + 5 : t) + 'px;left:' + r.left + 'px;pointer-events:auto;';
  }

  function dupSelectedEl() {
    if (!state.selected) return;
    var clone = state.selected.cloneNode(true);
    state.selected.parentElement.insertBefore(clone, state.selected.nextSibling);
    sendChange({ type: 'clone', element: desc(state.selected), selector: cssPath(state.selected), index: Array.from(state.selected.parentElement.children).indexOf(clone), url: location.pathname });
    selectEl(clone);
  }

  function hideSelectedEl() {
    if (!state.selected) return;
    var old = getComputedStyle(state.selected).display;
    state.selected.style.display = 'none';
    sendChange({ type: 'style', element: desc(state.selected), selector: cssPath(state.selected), changes: { display: { from: old, to: 'none' } }, url: location.pathname });
    deselectEl();
  }

  // ── Style Panel ──────────────────────────────────────────
  var stylePanel = mk('div', 'moldui-style-panel', overlay);
  stylePanel.style.pointerEvents = 'auto';
  var stylePanelOpen = false;

  function toggleStylePanel() {
    stylePanelOpen = !stylePanelOpen;
    if (stylePanelOpen && state.selected) { renderStylePanel(state.selected); stylePanel.style.display = 'block'; }
    else hideStylePanel();
  }
  function hideStylePanel() { stylePanelOpen = false; stylePanel.style.display = 'none'; }

  function renderStylePanel(el) {
    var cs = getComputedStyle(el);
    var isFlex = cs.display === 'flex' || cs.display === 'inline-flex';

    // Build panel using DOM methods (safe, no innerHTML with user content)
    while (stylePanel.firstChild) stylePanel.removeChild(stylePanel.firstChild);

    // Header
    var header = mk('div', 'moldui-sp-header', stylePanel);
    var title = mk('span', 'moldui-sp-title', header);
    title.textContent = elLabel(el);
    var closeBtn = mk('button', 'moldui-sp-close', header);
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', hideStylePanel);

    // Build sections
    buildSection(stylePanel, 'Layout', [
      { label: 'Display', type: 'select', prop: 'display', opts: ['block','flex','grid','inline-flex','inline-block','inline','none'], val: cs.display },
      isFlex && { label: 'Direction', type: 'select', prop: 'flexDirection', opts: ['row','column','row-reverse','column-reverse'], val: cs.flexDirection },
      isFlex && { label: 'Justify', type: 'select', prop: 'justifyContent', opts: ['flex-start','center','flex-end','space-between','space-around','space-evenly'], val: cs.justifyContent },
      isFlex && { label: 'Align', type: 'select', prop: 'alignItems', opts: ['stretch','flex-start','center','flex-end','baseline'], val: cs.alignItems },
      isFlex && { label: 'Gap', type: 'text', prop: 'gap', val: cs.gap }
    ].filter(Boolean));

    buildSection(stylePanel, 'Size', [
      { label: 'Width', type: 'text', prop: 'width', val: cs.width },
      { label: 'Height', type: 'text', prop: 'height', val: cs.height }
    ]);

    buildSection(stylePanel, 'Spacing', [
      { label: 'Pad Top', type: 'text', prop: 'paddingTop', val: cs.paddingTop },
      { label: 'Pad Right', type: 'text', prop: 'paddingRight', val: cs.paddingRight },
      { label: 'Pad Bottom', type: 'text', prop: 'paddingBottom', val: cs.paddingBottom },
      { label: 'Pad Left', type: 'text', prop: 'paddingLeft', val: cs.paddingLeft },
      { label: 'Margin Top', type: 'text', prop: 'marginTop', val: cs.marginTop },
      { label: 'Margin Right', type: 'text', prop: 'marginRight', val: cs.marginRight },
      { label: 'Margin Bottom', type: 'text', prop: 'marginBottom', val: cs.marginBottom },
      { label: 'Margin Left', type: 'text', prop: 'marginLeft', val: cs.marginLeft }
    ]);

    buildSection(stylePanel, 'Typography', [
      { label: 'Font', type: 'text', prop: 'fontFamily', val: cs.fontFamily.split(',')[0].replace(/['"]/g, '') },
      { label: 'Size', type: 'text', prop: 'fontSize', val: cs.fontSize },
      { label: 'Weight', type: 'select', prop: 'fontWeight', opts: ['100','200','300','400','500','600','700','800','900'], val: cs.fontWeight },
      { label: 'Color', type: 'color', prop: 'color', val: cs.color },
      { label: 'Line H.', type: 'text', prop: 'lineHeight', val: cs.lineHeight }
    ]);

    buildSection(stylePanel, 'Background', [
      { label: 'Color', type: 'color', prop: 'backgroundColor', val: cs.backgroundColor }
    ]);

    buildSection(stylePanel, 'Border', [
      { label: 'Radius', type: 'text', prop: 'borderRadius', val: cs.borderRadius },
      { label: 'Color', type: 'color', prop: 'borderColor', val: cs.borderColor },
      { label: 'Width', type: 'text', prop: 'borderWidth', val: cs.borderWidth }
    ]);

    buildSection(stylePanel, 'Shadow', [
      { label: 'Box', type: 'text', prop: 'boxShadow', val: cs.boxShadow === 'none' ? '' : cs.boxShadow }
    ]);

    buildSection(stylePanel, 'Effects', [
      { label: 'Opacity', type: 'range', prop: 'opacity', val: cs.opacity, min: 0, max: 1, step: 0.05 }
    ]);
  }

  function buildSection(parent, title, fields) {
    var sec = mk('div', 'moldui-sp-section', parent);
    var t = mk('div', 'moldui-sp-section-title', sec);
    t.textContent = title;
    fields.forEach(function(f) { buildField(sec, f); });
  }

  function buildField(parent, f) {
    var row = mk('div', 'moldui-sp-row', parent);
    var lbl = document.createElement('label');
    lbl.textContent = f.label;
    row.appendChild(lbl);

    var input;
    if (f.type === 'select') {
      input = document.createElement('select');
      input.dataset.prop = f.prop;
      f.opts.forEach(function(o) {
        var opt = document.createElement('option');
        opt.value = o; opt.textContent = o;
        if (f.val === o) opt.selected = true;
        input.appendChild(opt);
      });
    } else if (f.type === 'color') {
      var wrap = mk('div', 'moldui-sp-color-row', row);
      var cInput = document.createElement('input');
      cInput.type = 'color'; cInput.dataset.prop = f.prop; cInput.value = rgb2hex(f.val);
      var tInput = document.createElement('input');
      tInput.type = 'text'; tInput.dataset.prop = f.prop; tInput.value = f.val || '';
      wrap.appendChild(cInput);
      wrap.appendChild(tInput);
      wireInput(cInput, f.prop);
      wireInput(tInput, f.prop);
      cInput.addEventListener('input', function() { tInput.value = cInput.value; });
      return;
    } else if (f.type === 'range') {
      input = document.createElement('input');
      input.type = 'range'; input.dataset.prop = f.prop;
      input.min = f.min; input.max = f.max; input.step = f.step; input.value = f.val;
      var valSpan = mk('span', 'moldui-sp-range-val', row);
      valSpan.textContent = f.val;
      input.addEventListener('input', function() { valSpan.textContent = input.value; });
    } else {
      input = document.createElement('input');
      input.type = 'text'; input.dataset.prop = f.prop; input.value = f.val || '';
    }

    if (input) {
      row.appendChild(input);
      wireInput(input, f.prop);
    }
  }

  function wireInput(input, prop) {
    var handler = function() {
      if (!state.selected) return;
      var old = getComputedStyle(state.selected)[prop];
      var val = input.value;
      if (/^(margin|padding)/.test(prop) && val && !/[a-z%]/.test(val)) val += 'px';
      state.selected.style[prop] = val;
      syncSel();
      sendChange({ type: 'style', element: desc(state.selected), selector: cssPath(state.selected), changes: { [prop]: { from: old, to: val } }, url: location.pathname });
    };
    if (input.type === 'range' || input.type === 'color') input.addEventListener('input', handler);
    else if (input.tagName === 'SELECT') input.addEventListener('change', handler);
    else { input.addEventListener('change', handler); input.addEventListener('keydown', function(e) { if (e.key === 'Enter') handler(); }); }
  }

  // ── Viewport Bar ─────────────────────────────────────────
  var vpBar = mk('div', 'moldui-viewport-bar', overlay);
  vpBar.style.pointerEvents = 'auto';
  [{ vp: '375', label: '375' }, { vp: '768', label: '768' }, { vp: '1024', label: '1024' }, { vp: '1280', label: '1280' }, { vp: 'full', label: 'Full' }].forEach(function(v) {
    var btn = document.createElement('button');
    btn.dataset.vp = v.vp;
    btn.textContent = v.label;
    if (v.vp === 'full') btn.classList.add('active');
    vpBar.appendChild(btn);
  });

  vpBar.addEventListener('click', function(e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    vpBar.querySelectorAll('button').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    var vp = btn.dataset.vp;
    if (vp === 'full') { document.documentElement.style.maxWidth = ''; document.documentElement.style.margin = ''; document.documentElement.style.boxShadow = ''; }
    else { document.documentElement.style.maxWidth = vp + 'px'; document.documentElement.style.margin = '0 auto'; document.documentElement.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.1)'; }
  });

  // ── Breadcrumb ───────────────────────────────────────────
  var breadcrumb = mk('div', 'moldui-breadcrumb', overlay);
  breadcrumb.style.pointerEvents = 'auto';

  function updateBreadcrumb(el) {
    var parts = [], cur = el;
    while (cur && cur !== document.documentElement && parts.length < 6) { parts.unshift(cur); cur = cur.parentElement; }
    while (breadcrumb.firstChild) breadcrumb.removeChild(breadcrumb.firstChild);
    parts.forEach(function(p, i) {
      if (i > 0) {
        var sep = mk('span', 'moldui-bc-sep', breadcrumb);
        sep.textContent = '\u203a';
      }
      var item = mk('span', 'moldui-bc-item' + (i === parts.length - 1 ? ' active' : ''), breadcrumb);
      item.textContent = elLabel(p);
      item.addEventListener('click', function() { selectEl(p); });
    });
    breadcrumb.style.display = 'flex';
  }

  // ── Shimmer Bar ──────────────────────────────────────────
  var shimmer = mk('div', 'moldui-shimmer', overlay);
  var shimmerText = mk('div', 'moldui-shimmer-text', shimmer);

  function showShimmer(s, text) {
    shimmer.className = 'moldui-shimmer moldui-shimmer-' + s;
    shimmerText.textContent = text || '';
    shimmer.style.display = 'flex';
    if (s === 'synced') setTimeout(function() { shimmer.style.display = 'none'; }, 2500);
  }
  function hideShimmer() { shimmer.style.display = 'none'; }

  // ── Status Bar ───────────────────────────────────────────
  var statusBar = mk('div', 'moldui-status-bar', overlay);
  statusBar.style.pointerEvents = 'auto';
  function updateStatusBar() {
    while (statusBar.firstChild) statusBar.removeChild(statusBar.firstChild);
    statusBar.appendChild(document.createTextNode(state.wsConnected ? '\u{1F7E2} ' : '\u{1F534} '));
    var items = ['moldui', 'S styles', 'Dbl-click text', 'Esc deselect', 'Cmd+Z undo'];
    items.forEach(function(t, i) {
      if (i > 0) statusBar.appendChild(document.createTextNode(' \u00b7 '));
      var span = document.createElement('span');
      span.textContent = t;
      statusBar.appendChild(span);
    });
  }
  updateStatusBar();

  // ── Dimensions Label ─────────────────────────────────────
  var dimLabel = mk('div', 'moldui-dim-label', overlay);
  function showDim(el) {
    var r = el.getBoundingClientRect();
    dimLabel.textContent = Math.round(r.width) + ' \u00d7 ' + Math.round(r.height);
    dimLabel.style.cssText = 'display:block;position:fixed;top:' + (r.bottom + 5) + 'px;left:' + (r.left + r.width / 2) + 'px;transform:translateX(-50%);';
  }
  function hideDim() { dimLabel.style.display = 'none'; }

  console.log('[moldui] Editor loaded. Click to select, drag to move, double-click to edit text, S for styles.');
})();
