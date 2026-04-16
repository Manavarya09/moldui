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

  // ── Local Undo/Redo Stack ───────────────────────────────
  var undoStack = [];
  var redoStack = [];
  var pendingChanges = [];
  var saveState = 'idle'; // idle, dirty, saving, saved

  function pushUndo(entry) {
    // entry: { change, element, revert: function() }
    undoStack.push(entry);
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    pendingChanges.push(entry.change);
    saveState = 'dirty';
    updateActionBar();
  }

  function performUndo() {
    var entry = undoStack.pop();
    if (!entry) return;
    entry.revert();
    redoStack.push(entry);
    // Remove from pending
    var idx = pendingChanges.indexOf(entry.change);
    if (idx >= 0) pendingChanges.splice(idx, 1);
    send({ type: 'undo' });
    saveState = pendingChanges.length > 0 ? 'dirty' : 'idle';
    updateActionBar();
    if (state.selected) syncSel();
  }

  function performRedo() {
    var entry = redoStack.pop();
    if (!entry) return;
    // Re-apply the change
    if (entry.apply) entry.apply();
    undoStack.push(entry);
    pendingChanges.push(entry.change);
    send({ type: 'redo' });
    saveState = 'dirty';
    updateActionBar();
    if (state.selected) syncSel();
  }

  function performSave() {
    if (pendingChanges.length === 0) return;
    var batch = pendingChanges.splice(0);
    send({ type: 'batch', payload: batch });
    saveState = 'saving';
    updateActionBar();
  }

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

  // sendChange now goes through the undo stack — callers must provide a revert function
  function sendChangeWithUndo(change, revertFn, applyFn) {
    pushUndo({ change: change, revert: revertFn, apply: applyFn || function() {} });
    send({ type: 'change', payload: change });
  }

  // Legacy sendChange for cases where undo isn't practical
  function sendChange(c) {
    pendingChanges.push(c);
    saveState = 'dirty';
    updateActionBar();
    send({ type: 'change', payload: c });
  }

  function handleServerMsg(msg) {
    if (msg.type === 'synced') {
      showShimmer('synced', 'Saved to ' + (msg.payload.file || 'source'));
      saveState = 'saved';
      updateActionBar();
      setTimeout(function() { if (saveState === 'saved') { saveState = 'idle'; updateActionBar(); } }, 3000);
    }
    else if (msg.type === 'status' && msg.payload.state === 'writing') { showShimmer('working', msg.payload.file ? 'Rewriting ' + msg.payload.file + '...' : 'AI is writing code...'); saveState = 'saving'; updateActionBar(); }
    else if (msg.type === 'status' && msg.payload.state === 'idle') hideShimmer();
    else if (msg.type === 'error') { showShimmer('error', msg.payload.message || 'Error'); saveState = 'dirty'; updateActionBar(); }
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

  // ── Hover + Click (throttled via rAF for perf on large pages) ─
  var _hoverRaf = null, _hoverEvent = null;
  function _processHover() {
    _hoverRaf = null;
    var e = _hoverEvent;
    if (!e) return;
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
    if (state.selected && el !== state.selected) {
      showGuides(state.selected.getBoundingClientRect(), r);
    } else {
      hideGuides();
    }
  }
  document.addEventListener('mousemove', function(e) {
    _hoverEvent = e;
    if (_hoverRaf) return;
    _hoverRaf = requestAnimationFrame(_processHover);
  }, true);

  document.addEventListener('click', function(e) {
    if (state.mode !== 'select') return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (isEditor(el)) return;
    e.preventDefault(); e.stopPropagation();
    if (el) selectEl(el); else deselectEl();
  }, true);

  // Suppress ALL link/button navigation + form submits while editor is active
  document.addEventListener('click', function(e) {
    if (isEditor(e.target)) return;
    var a = e.target.closest ? e.target.closest('a, button[type="submit"], input[type="submit"]') : null;
    if (a) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ── Drag Engine ──────────────────────────────────────────
  var dragSt = null;

  function startDrag(el, x, y) {
    var r = el.getBoundingClientRect();
    var parent = el.parentElement;
    var sibs = parent ? Array.from(parent.children) : [];
    var ghost = el.cloneNode(true);
    // Capture cursor offset relative to element so ghost follows grab point
    var offsetX = x - r.left, offsetY = y - r.top;
    ghost.style.cssText = 'position:fixed;top:' + r.top + 'px;left:' + r.left + 'px;width:' + r.width + 'px;height:' + r.height + 'px;opacity:0.6;pointer-events:none;z-index:2147483646;transition:none;margin:0;';
    document.body.appendChild(ghost);
    var ph = document.createElement('div');
    ph.style.cssText = 'width:' + r.width + 'px;height:4px;background:#3b82f6;border-radius:2px;margin:2px 0;transition:all 0.15s;';
    dragSt = { el: el, x: x, y: y, r: r, offsetX: offsetX, offsetY: offsetY, parent: parent, sibs: sibs, startIdx: sibs.indexOf(el), ghost: ghost, ph: ph };
    el.style.opacity = '0.3';
    // Hide resize handles + toolbar during drag so they don't block the drop zone
    handleWrap.style.display = 'none';
    toolbar.style.display = 'none';
    state.mode = 'drag';
  }

  function onDrag(e) {
    if (!dragSt) return;
    // Position ghost so cursor stays at the original grab point on the element
    dragSt.ghost.style.top = (e.clientY - dragSt.offsetY) + 'px';
    dragSt.ghost.style.left = (e.clientX - dragSt.offsetX) + 'px';

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
      var change = {
        type: 'reorder', element: desc(el), selector: cssPath(el),
        fromIndex: startIdx, toIndex: newIdx,
        fromParent: cssPath(parent), toParent: cssPath(targetContainer),
        siblingCount: Array.from(targetContainer.children).length,
        url: location.pathname
      };
      var savedParent = parent, savedIdx = startIdx, savedEl = el;
      sendChangeWithUndo(change, function() {
        // Revert: move element back to original parent at original index
        var children = Array.from(savedParent.children);
        if (savedIdx >= children.length) savedParent.appendChild(savedEl);
        else savedParent.insertBefore(savedEl, children[savedIdx]);
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
      var change = { type: 'style', element: desc(rszSt.el), selector: cssPath(rszSt.el), changes: changes, url: location.pathname };
      var savedEl = rszSt.el, savedW = rszSt.w, savedH = rszSt.h, finalW = nw, finalH = nh;
      sendChangeWithUndo(change, function() {
        savedEl.style.width = savedW + 'px';
        savedEl.style.height = savedH + 'px';
      }, function() {
        savedEl.style.width = finalW + 'px';
        savedEl.style.height = finalH + 'px';
      });
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
    if (nw !== textEdit.old) {
      var change = { type: 'text', element: desc(textEdit.el), selector: cssPath(textEdit.el), oldText: textEdit.old, newText: nw, url: location.pathname };
      var savedEl = textEdit.el, savedOld = textEdit.old, savedNew = nw;
      sendChangeWithUndo(change, function() { savedEl.textContent = savedOld; }, function() { savedEl.textContent = savedNew; });
    }
    textEdit = null; state.mode = 'select';
  }

  function cancelText() {
    if (!textEdit) return;
    textEdit.el.textContent = textEdit.old;
    textEdit.el.contentEditable = 'false';
    textEdit = null; state.mode = 'select';
  }

  // ── Keyboard Shortcut Guard ──────────────────────────────
  // Skip shortcuts when user is typing in a form field (in host page OR in our shadow DOM)
  function isTypingTarget(e) {
    var t = e.target;
    if (!t) return false;
    // Our palette/chat inputs — treat as typing
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
    if (t.isContentEditable) return true;
    // contenteditable=true ancestors
    var cur = t;
    while (cur && cur !== document.body) {
      if (cur.contentEditable === 'true') return true;
      cur = cur.parentElement;
    }
    return false;
  }

  // ── Keyboard Shortcuts ───────────────────────────────────
  document.addEventListener('keydown', function(e) {
    if (textEdit) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
      else if (e.key === 'Escape') cancelText();
      return;
    }
    // Don't hijack keys while user is typing (except Escape which should always deselect)
    var typing = isTypingTarget(e);
    if (e.key === 'Escape') { deselectEl(); return; }
    if (typing) return;

    if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); if (e.shiftKey) performRedo(); else performUndo(); }
    if (e.key === 's' && !e.metaKey && !e.ctrlKey && !textEdit) { e.preventDefault(); toggleStylePanel(); }
    // Delete: works for single selection AND multi-selection
    if (e.key === 'Delete') {
      if (multiSelected && multiSelected.length > 0) {
        multiSelected.slice().forEach(function(el) {
          var old = getComputedStyle(el).display;
          el.style.display = 'none';
          var ch = { type: 'style', element: desc(el), selector: cssPath(el), changes: { display: { from: old, to: 'none' } }, url: location.pathname };
          var se = el, so = old;
          sendChangeWithUndo(ch, function() { se.style.display = so; }, function() { se.style.display = 'none'; });
        });
        multiSelected = [];
        hideMultiSelectBoxes();
        return;
      }
      if (state.selected) { hideSelectedEl(); return; }
    }
    // Arrow nudging: works for single or multi selection
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].indexOf(e.key) >= 0 && !textEdit) {
      var targets = (multiSelected && multiSelected.length > 0) ? multiSelected : (state.selected ? [state.selected] : []);
      if (targets.length === 0) return;
      e.preventDefault();
      var amount = e.shiftKey ? 10 : 1;
      var prop, dir;
      if (e.key === 'ArrowUp') { prop = 'marginTop'; dir = -1; }
      else if (e.key === 'ArrowDown') { prop = 'marginTop'; dir = 1; }
      else if (e.key === 'ArrowLeft') { prop = 'marginLeft'; dir = -1; }
      else if (e.key === 'ArrowRight') { prop = 'marginLeft'; dir = 1; }

      targets.forEach(function(t) {
        var cs = getComputedStyle(t);
        var cur = parseInt(cs[prop]) || 0;
        var newVal = (cur + dir * amount) + 'px';
        var oldVal = cs[prop];
        t.style[prop] = newVal;
        var tt = t, sp = prop, ov = oldVal, nv = newVal;
        sendChangeWithUndo({ type: 'style', element: desc(tt), selector: cssPath(tt), changes: { [sp]: { from: ov, to: nv } }, url: location.pathname }, function() { tt.style[sp] = ov; }, function() { tt.style[sp] = nv; });
      });
      syncSel();
      syncMulti();
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
    var el = state.selected;
    var old = getComputedStyle(el).display;
    el.style.display = 'none';
    var change = { type: 'style', element: desc(el), selector: cssPath(el), changes: { display: { from: old, to: 'none' } }, url: location.pathname };
    sendChangeWithUndo(change, function() { el.style.display = old; }, function() { el.style.display = 'none'; });
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
    var savedScroll = stylePanel.scrollTop;

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

    // Restore scroll position so switching elements doesn't jump back to top
    stylePanel.scrollTop = savedScroll;
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
      var el = state.selected;
      var old = getComputedStyle(el)[prop];
      var val = input.value;
      if (/^(margin|padding)/.test(prop) && val && !/[a-z%]/.test(val)) val += 'px';
      el.style[prop] = val;
      syncSel();
      var change = { type: 'style', element: desc(el), selector: cssPath(el), changes: { [prop]: { from: old, to: val } }, url: location.pathname };
      var savedEl = el, savedOld = old, savedVal = val, savedProp = prop;
      sendChangeWithUndo(change, function() { savedEl.style[savedProp] = savedOld; }, function() { savedEl.style[savedProp] = savedVal; });
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

  // ── Action Bar (Undo / Redo / Save) ──────────────────────
  var actionBar = mk('div', 'moldui-action-bar', overlay);
  actionBar.style.pointerEvents = 'auto';

  var undoBtn = document.createElement('button');
  undoBtn.className = 'moldui-ab-btn';
  undoBtn.title = 'Undo (Cmd+Z)';
  undoBtn.textContent = '\u21A9 Undo';
  undoBtn.addEventListener('click', performUndo);
  actionBar.appendChild(undoBtn);

  var redoBtn = document.createElement('button');
  redoBtn.className = 'moldui-ab-btn';
  redoBtn.title = 'Redo (Cmd+Shift+Z)';
  redoBtn.textContent = '\u21AA Redo';
  redoBtn.addEventListener('click', performRedo);
  actionBar.appendChild(redoBtn);

  var abSep = mk('div', 'moldui-ab-sep', actionBar);

  var saveBtn = document.createElement('button');
  saveBtn.className = 'moldui-ab-btn moldui-ab-save';
  saveBtn.title = 'Save changes to source code (Cmd+S)';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', performSave);
  actionBar.appendChild(saveBtn);

  var changeBadge = mk('span', 'moldui-ab-badge', actionBar);
  changeBadge.style.display = 'none';

  function updateActionBar() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
    undoBtn.style.opacity = undoStack.length === 0 ? '0.35' : '1';
    redoBtn.style.opacity = redoStack.length === 0 ? '0.35' : '1';

    if (saveState === 'dirty') {
      saveBtn.textContent = 'Save';
      saveBtn.className = 'moldui-ab-btn moldui-ab-save moldui-ab-dirty';
      saveBtn.disabled = false;
    } else if (saveState === 'saving') {
      saveBtn.textContent = 'Saving...';
      saveBtn.className = 'moldui-ab-btn moldui-ab-save moldui-ab-saving';
      saveBtn.disabled = true;
    } else if (saveState === 'saved') {
      saveBtn.textContent = '\u2713 Saved';
      saveBtn.className = 'moldui-ab-btn moldui-ab-save moldui-ab-saved';
      saveBtn.disabled = true;
    } else {
      saveBtn.textContent = 'Save';
      saveBtn.className = 'moldui-ab-btn moldui-ab-save';
      saveBtn.disabled = true;
      saveBtn.style.opacity = '0.35';
    }

    // Badge with pending change count
    if (pendingChanges.length > 0) {
      changeBadge.textContent = pendingChanges.length;
      changeBadge.style.display = 'inline-flex';
    } else {
      changeBadge.style.display = 'none';
    }
  }
  updateActionBar();

  // Cmd+S to save
  document.addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      performSave();
    }
  }, true);

  // ── Status Bar ───────────────────────────────────────────
  var statusBar = mk('div', 'moldui-status-bar', overlay);
  statusBar.style.pointerEvents = 'auto';
  function updateStatusBar() {
    while (statusBar.firstChild) statusBar.removeChild(statusBar.firstChild);
    statusBar.appendChild(document.createTextNode(state.wsConnected ? '\u{1F7E2} ' : '\u{1F534} '));
    var items = ['moldui', 'S styles', 'L layers', 'Cmd+K search', '? shortcuts', 'Cmd+Z undo'];
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

  // ═════════════════════════════════════════════════════════
  // v2.0 — Figma-level features
  // ═════════════════════════════════════════════════════════

  // ── Multi-Select ─────────────────────────────────────────
  var multiSelected = [];
  var multiBoxContainer = mk('div', 'moldui-multi-boxes', overlay);

  function renderMultiSelectBoxes() {
    while (multiBoxContainer.firstChild) multiBoxContainer.removeChild(multiBoxContainer.firstChild);
    multiBoxContainer.style.display = 'block';
    multiSelected.forEach(function(el) {
      var r = el.getBoundingClientRect();
      var box = mk('div', 'moldui-multi-box', multiBoxContainer);
      box.style.cssText = 'position:fixed;top:' + r.top + 'px;left:' + r.left + 'px;width:' + r.width + 'px;height:' + r.height + 'px;pointer-events:none;';
    });
  }
  function hideMultiSelectBoxes() {
    while (multiBoxContainer.firstChild) multiBoxContainer.removeChild(multiBoxContainer.firstChild);
    multiBoxContainer.style.display = 'none';
  }
  function syncMulti() { if (multiSelected.length > 0) renderMultiSelectBoxes(); }
  window.addEventListener('scroll', syncMulti, true);
  window.addEventListener('resize', syncMulti);

  // Intercept clicks for shift-select (higher priority than existing handler)
  document.addEventListener('click', function(e) {
    if (state.mode !== 'select') return;
    if (!e.shiftKey) { if (multiSelected.length > 0) { multiSelected = []; hideMultiSelectBoxes(); } return; }
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isEditor(el)) return;
    e.preventDefault(); e.stopPropagation();
    if (multiSelected.length === 0 && state.selected) multiSelected.push(state.selected);
    var idx = multiSelected.indexOf(el);
    if (idx >= 0) multiSelected.splice(idx, 1);
    else multiSelected.push(el);
    renderMultiSelectBoxes();
  }, true);

  // ── Right-Click Context Menu ─────────────────────────────
  var contextMenu = mk('div', 'moldui-context-menu', overlay);
  contextMenu.style.pointerEvents = 'auto';
  var copiedStyles = null;
  var menuItems = [
    { label: 'Duplicate', action: 'dup' },
    { label: 'Hide', action: 'hide' },
    { label: 'Wrap in <div>', action: 'wrap' },
    { label: 'Copy Styles', action: 'copy-styles' },
    { label: 'Paste Styles', action: 'paste-styles' },
    { label: 'Copy HTML', action: 'copy-html' },
    { label: 'Copy CSS', action: 'copy-css' },
    { label: 'Select Parent', action: 'parent' },
    { label: 'Select Children', action: 'children' },
    { label: 'Delete', action: 'del' }
  ];
  menuItems.forEach(function(it) {
    var el = document.createElement('div');
    el.className = 'moldui-cm-item';
    el.dataset.action = it.action;
    el.textContent = it.label;
    contextMenu.appendChild(el);
  });

  document.addEventListener('contextmenu', function(e) {
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isEditor(el)) return;
    e.preventDefault();
    selectEl(el);
    contextMenu.style.cssText = 'display:block;position:fixed;top:' + e.clientY + 'px;left:' + e.clientX + 'px;pointer-events:auto;';
    setTimeout(function() {
      var r = contextMenu.getBoundingClientRect();
      if (r.right > window.innerWidth) contextMenu.style.left = (window.innerWidth - r.width - 10) + 'px';
      if (r.bottom > window.innerHeight) contextMenu.style.top = (window.innerHeight - r.height - 10) + 'px';
    }, 0);
  }, true);

  function hideContextMenu() { contextMenu.style.display = 'none'; }
  document.addEventListener('click', function(e) {
    if (contextMenu.style.display === 'block' && !contextMenu.contains(e.target)) hideContextMenu();
  }, true);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && contextMenu.style.display === 'block') hideContextMenu();
  }, true);

  contextMenu.addEventListener('click', function(e) {
    var it = e.target.closest('.moldui-cm-item');
    if (!it || !state.selected) return;
    var a = it.dataset.action;
    var el = state.selected;
    hideContextMenu();

    if (a === 'dup') dupSelectedEl();
    else if (a === 'hide') hideSelectedEl();
    else if (a === 'wrap') {
      var wrapper = document.createElement('div');
      el.parentElement.insertBefore(wrapper, el);
      wrapper.appendChild(el);
      selectEl(wrapper);
      sendChange({ type: 'wrap', element: desc(el), selector: cssPath(el), wrapperTag: 'div', url: location.pathname });
    }
    else if (a === 'copy-styles') {
      copiedStyles = {};
      var cs = getComputedStyle(el);
      var props = ['color','backgroundColor','fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','padding','margin','borderRadius','border','boxShadow','opacity','textAlign'];
      props.forEach(function(p) { copiedStyles[p] = cs[p]; });
      showShimmer('synced', 'Styles copied');
    }
    else if (a === 'paste-styles') {
      if (!copiedStyles) { showShimmer('error', 'No styles copied'); return; }
      Object.keys(copiedStyles).forEach(function(p) {
        var old = getComputedStyle(el)[p];
        el.style[p] = copiedStyles[p];
        var ch = { type: 'style', element: desc(el), selector: cssPath(el), changes: { [p]: { from: old, to: copiedStyles[p] } }, url: location.pathname };
        var se = el, so = old, sv = copiedStyles[p], sp = p;
        sendChangeWithUndo(ch, function() { se.style[sp] = so; }, function() { se.style[sp] = sv; });
      });
      syncSel();
    }
    else if (a === 'copy-html') {
      navigator.clipboard.writeText(el.outerHTML).then(function() { showShimmer('synced', 'HTML copied'); }).catch(function() {});
    }
    else if (a === 'copy-css') {
      var cs = getComputedStyle(el);
      var css = cssPath(el) + ' {\n';
      ['color','background-color','font-family','font-size','font-weight','padding','margin','border-radius','box-shadow'].forEach(function(p) {
        var camel = p.replace(/-([a-z])/g, function(m, c) { return c.toUpperCase(); });
        var val = cs[camel];
        if (val && val !== 'none' && val !== 'rgba(0, 0, 0, 0)' && val !== '0px') css += '  ' + p + ': ' + val + ';\n';
      });
      css += '}';
      navigator.clipboard.writeText(css).then(function() { showShimmer('synced', 'CSS copied'); }).catch(function() {});
    }
    else if (a === 'parent') { if (el.parentElement) selectEl(el.parentElement); }
    else if (a === 'children') { if (el.children.length > 0) { multiSelected = Array.from(el.children); renderMultiSelectBoxes(); deselectEl(); } }
    else if (a === 'del') {
      var parent = el.parentElement, next = el.nextSibling;
      el.remove();
      var ch = { type: 'delete', element: desc(el), selector: cssPath(el), url: location.pathname };
      var savedEl = el, sp2 = parent, sn = next;
      sendChangeWithUndo(ch, function() { if (sn) sp2.insertBefore(savedEl, sn); else sp2.appendChild(savedEl); }, function() { savedEl.remove(); });
      deselectEl();
    }
  });

  // ── Layers Panel ─────────────────────────────────────────
  var layersPanel = mk('div', 'moldui-layers-panel', overlay);
  layersPanel.style.pointerEvents = 'auto';
  var lpHeader = mk('div', 'moldui-lp-header', layersPanel);
  var lpTitle = mk('span', 'moldui-lp-title', lpHeader);
  lpTitle.textContent = 'Layers';
  var lpToggleBtn = document.createElement('button');
  lpToggleBtn.className = 'moldui-lp-toggle';
  lpToggleBtn.textContent = '\u2715';
  lpHeader.appendChild(lpToggleBtn);
  var lpTree = mk('div', 'moldui-lp-tree', layersPanel);
  var layersPanelOpen = false;
  var expandedNodes = new Set();

  function toggleLayersPanel() {
    layersPanelOpen = !layersPanelOpen;
    if (layersPanelOpen) { layersPanel.style.display = 'flex'; renderLayersTree(); }
    else layersPanel.style.display = 'none';
  }
  lpToggleBtn.addEventListener('click', toggleLayersPanel);

  function renderLayersTree() {
    while (lpTree.firstChild) lpTree.removeChild(lpTree.firstChild);
    if (!document.body) return;
    Array.from(document.body.children).forEach(function(ch) {
      if (ch.id === '__moldui-host__') return;
      buildLayerNode(ch, lpTree, 0);
    });
  }

  function buildLayerNode(el, parent, depth) {
    var node = document.createElement('div');
    node.className = 'moldui-lp-node' + (state.selected === el ? ' selected' : '');
    node.style.paddingLeft = (depth * 14 + 8) + 'px';
    var hasKids = el.children.length > 0;
    var exp = expandedNodes.has(el);
    var caret = document.createElement('span');
    caret.className = 'moldui-lp-caret';
    caret.textContent = hasKids ? (exp ? '\u25BE' : '\u25B8') : '';
    caret.addEventListener('click', function(e) {
      e.stopPropagation();
      if (!hasKids) return;
      if (exp) expandedNodes.delete(el); else expandedNodes.add(el);
      renderLayersTree();
    });
    node.appendChild(caret);
    var icon = document.createElement('span');
    icon.className = 'moldui-lp-icon';
    var tag = el.tagName.toLowerCase();
    icon.textContent = tag === 'a' ? '\u2197' : tag === 'button' ? '\u25A2' : /^h[1-6]$/.test(tag) ? 'H' : tag === 'img' ? '\u{1F5BC}' : '\u25AB';
    node.appendChild(icon);
    var lbl = document.createElement('span');
    lbl.className = 'moldui-lp-label';
    lbl.textContent = elLabel(el);
    node.appendChild(lbl);
    node.addEventListener('click', function(e) { if (e.target === caret) return; selectEl(el); });
    parent.appendChild(node);
    if (hasKids && exp) {
      Array.from(el.children).forEach(function(ch) {
        if (ch.id === '__moldui-host__') return;
        buildLayerNode(ch, parent, depth + 1);
      });
    }
  }

  // ── Cmd+K Element Search Palette ─────────────────────────
  var palette = mk('div', 'moldui-palette', overlay);
  palette.style.pointerEvents = 'auto';
  var paletteInput = document.createElement('input');
  paletteInput.className = 'moldui-palette-input';
  paletteInput.placeholder = 'Search elements by tag, class, id, or text...';
  paletteInput.type = 'text';
  palette.appendChild(paletteInput);
  var paletteResults = mk('div', 'moldui-palette-results', palette);
  var paletteOpen = false;
  var paletteIndex = [];
  var paletteSel = 0;

  function togglePalette() {
    paletteOpen = !paletteOpen;
    if (paletteOpen) {
      palette.style.display = 'block';
      paletteInput.value = '';
      paletteInput.focus();
      buildPaletteIndex();
      renderPaletteResults('');
    } else palette.style.display = 'none';
  }
  function buildPaletteIndex() {
    paletteIndex = [];
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length && paletteIndex.length < 500; i++) {
      var el = all[i];
      if (el.id === '__moldui-host__' || (el.closest && el.closest('#__moldui-host__'))) continue;
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      var txt = (el.textContent || '').trim().slice(0, 60);
      paletteIndex.push({ el: el, label: elLabel(el), text: txt, keywords: (el.tagName + ' ' + (el.id || '') + ' ' + el.className + ' ' + txt).toLowerCase() });
    }
  }
  function renderPaletteResults(q) {
    while (paletteResults.firstChild) paletteResults.removeChild(paletteResults.firstChild);
    q = q.trim().toLowerCase();
    var matches = q === '' ? paletteIndex.slice(0, 50) : paletteIndex.filter(function(it) { return it.keywords.indexOf(q) >= 0; }).slice(0, 50);
    paletteSel = 0;
    matches.forEach(function(it, i) {
      var row = document.createElement('div');
      row.className = 'moldui-palette-row' + (i === 0 ? ' selected' : '');
      var lblS = document.createElement('span');
      lblS.className = 'moldui-palette-label';
      lblS.textContent = it.label;
      row.appendChild(lblS);
      if (it.text) {
        var txtS = document.createElement('span');
        txtS.className = 'moldui-palette-text';
        txtS.textContent = it.text;
        row.appendChild(txtS);
      }
      row.addEventListener('click', function() { selectEl(it.el); try { it.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(x) {} togglePalette(); });
      paletteResults.appendChild(row);
    });
    if (matches.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'moldui-palette-empty';
      empty.textContent = 'No matches';
      paletteResults.appendChild(empty);
    }
  }
  paletteInput.addEventListener('input', function() { renderPaletteResults(paletteInput.value); });
  paletteInput.addEventListener('keydown', function(e) {
    var rows = paletteResults.querySelectorAll('.moldui-palette-row');
    if (e.key === 'Escape') { togglePalette(); return; }
    if (e.key === 'Enter') { var r = rows[paletteSel]; if (r) r.click(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (paletteSel < rows.length - 1) paletteSel++; rows.forEach(function(r, i) { r.classList.toggle('selected', i === paletteSel); }); if (rows[paletteSel]) rows[paletteSel].scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (paletteSel > 0) paletteSel--; rows.forEach(function(r, i) { r.classList.toggle('selected', i === paletteSel); }); if (rows[paletteSel]) rows[paletteSel].scrollIntoView({ block: 'nearest' }); }
  });

  // ── AI Chat Panel ────────────────────────────────────────
  var chatPanel = mk('div', 'moldui-chat-panel', overlay);
  chatPanel.style.pointerEvents = 'auto';
  var chatHdr = mk('div', 'moldui-chat-header', chatPanel);
  var chatT = mk('span', 'moldui-chat-title', chatHdr);
  chatT.textContent = 'Ask moldui AI';
  var chatClose = document.createElement('button');
  chatClose.className = 'moldui-chat-close';
  chatClose.textContent = '\u2715';
  chatHdr.appendChild(chatClose);
  var chatMsgs = mk('div', 'moldui-chat-messages', chatPanel);
  var chatIn = mk('div', 'moldui-chat-input-wrap', chatPanel);
  var chatInput = document.createElement('textarea');
  chatInput.className = 'moldui-chat-input';
  chatInput.placeholder = 'e.g., "make this more modern" or "increase contrast"';
  chatInput.rows = 3;
  chatIn.appendChild(chatInput);
  var chatSendBtn = document.createElement('button');
  chatSendBtn.className = 'moldui-chat-send';
  chatSendBtn.textContent = 'Send';
  chatIn.appendChild(chatSendBtn);
  var chatHint = mk('div', 'moldui-chat-hint', chatPanel);
  chatHint.textContent = 'Prompts are saved with changes. Ask your AI (Claude / Cursor / Gemini / Copilot) to "apply moldui changes".';
  var chatPanelOpen = false;

  function toggleChatPanel() {
    chatPanelOpen = !chatPanelOpen;
    chatPanel.style.display = chatPanelOpen ? 'flex' : 'none';
    if (chatPanelOpen) chatInput.focus();
  }
  chatClose.addEventListener('click', toggleChatPanel);
  function addChatMsg(role, text) {
    var m = mk('div', 'moldui-chat-msg moldui-chat-msg-' + role, chatMsgs);
    var b = mk('div', 'moldui-chat-bubble', m);
    b.textContent = text;
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
  }
  function doChatSend() {
    var text = chatInput.value.trim();
    if (!text) return;
    addChatMsg('user', text);
    chatInput.value = '';
    send({ type: 'chat', payload: { prompt: text, element: state.selected ? desc(state.selected) : null, selector: state.selected ? cssPath(state.selected) : null, url: location.pathname } });
    addChatMsg('ai', 'Saved with pending changes. Ask your AI to "apply moldui" to sync.');
  }
  chatSendBtn.addEventListener('click', doChatSend);
  chatInput.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doChatSend(); } });

  // ── Eyedropper + Recent Colors (localStorage) ────────────
  var recentColors = [];
  try { recentColors = JSON.parse(localStorage.getItem('__moldui_recent_colors__') || '[]'); } catch(x) {}
  function addRecentColor(hex) {
    if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return;
    recentColors = [hex].concat(recentColors.filter(function(c) { return c !== hex; })).slice(0, 12);
    try { localStorage.setItem('__moldui_recent_colors__', JSON.stringify(recentColors)); } catch(x) {}
  }

  // ── Image Replace (works on selected img) ────────────────
  var imgReplaceBtn = document.createElement('button');
  imgReplaceBtn.className = 'moldui-img-replace-btn';
  imgReplaceBtn.textContent = 'Replace Image';
  imgReplaceBtn.style.display = 'none';
  toolbar.appendChild(imgReplaceBtn);

  imgReplaceBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (!state.selected || state.selected.tagName !== 'IMG') return;
    var url = prompt('Image URL (or leave empty to upload a file):', state.selected.src || '');
    if (url === null) return;
    if (url) {
      var oldSrc = state.selected.src, savedEl = state.selected, newS = url;
      savedEl.src = newS;
      sendChangeWithUndo({ type: 'image', element: desc(savedEl), selector: cssPath(savedEl), oldSrc: oldSrc, newSrc: newS, url: location.pathname }, function() { savedEl.src = oldSrc; }, function() { savedEl.src = newS; });
    } else {
      var fi = document.createElement('input');
      fi.type = 'file'; fi.accept = 'image/*';
      fi.addEventListener('change', function() {
        var f = fi.files[0]; if (!f) return;
        var rd = new FileReader();
        rd.onload = function() {
          var d = rd.result, se = state.selected, old = se.src;
          se.src = d;
          sendChangeWithUndo({ type: 'image', element: desc(se), selector: cssPath(se), oldSrc: old, newSrc: 'data:...(uploaded)', url: location.pathname, dataLength: d.length }, function() { se.src = old; }, function() { se.src = d; });
        };
        rd.readAsDataURL(f);
      });
      fi.click();
    }
  });

  // Patch showToolbar to reveal img-replace when an img is selected
  var _origShowToolbar = showToolbar;
  showToolbar = function(el) {
    _origShowToolbar(el);
    imgReplaceBtn.style.display = el.tagName === 'IMG' ? 'inline-block' : 'none';
  };

  // ── Shortcut Cheatsheet (press ?) ────────────────────────
  var cheatsheet = mk('div', 'moldui-cheatsheet', overlay);
  cheatsheet.style.pointerEvents = 'auto';
  var csH = mk('div', 'moldui-cs-header', cheatsheet);
  var csT = mk('span', 'moldui-cs-title', csH);
  csT.textContent = 'Keyboard Shortcuts';
  var csCl = document.createElement('button');
  csCl.className = 'moldui-cs-close';
  csCl.textContent = '\u2715';
  csH.appendChild(csCl);
  var csB = mk('div', 'moldui-cs-body', cheatsheet);
  var csGroups = [
    { section: 'Selection', items: [['Click', 'Select element'], ['Shift+Click', 'Multi-select'], ['Escape', 'Deselect']] },
    { section: 'Editing', items: [['Double-click', 'Edit text'], ['Drag', 'Move / reorder'], ['Handles', 'Resize'], ['Arrows', 'Nudge 1px'], ['Shift+Arrows', 'Nudge 10px'], ['Delete', 'Hide element']] },
    { section: 'Panels', items: [['S', 'Style panel'], ['L', 'Layers panel'], ['Cmd+K', 'Search elements'], ['Cmd+/', 'AI chat'], ['?', 'This cheatsheet']] },
    { section: 'History', items: [['Cmd+Z', 'Undo'], ['Cmd+Shift+Z', 'Redo'], ['Cmd+S', 'Save to source']] },
    { section: 'Zoom', items: [['Cmd+Scroll', 'Zoom canvas'], ['Cmd+0', 'Reset zoom'], ['Cmd+=', 'Zoom in'], ['Cmd+-', 'Zoom out']] },
    { section: 'Context Menu (right-click)', items: [['Duplicate', 'Clone'], ['Copy/Paste Styles', 'Transfer'], ['Copy HTML/CSS', 'To clipboard'], ['Wrap', 'In a <div>']] }
  ];
  csGroups.forEach(function(g) {
    var sec = mk('div', 'moldui-cs-section', csB);
    var st = mk('div', 'moldui-cs-section-title', sec);
    st.textContent = g.section;
    g.items.forEach(function(it) {
      var rw = mk('div', 'moldui-cs-row', sec);
      var k = mk('span', 'moldui-cs-key', rw);
      k.textContent = it[0];
      var d = mk('span', 'moldui-cs-desc', rw);
      d.textContent = it[1];
    });
  });
  var cheatsheetOpen = false;
  function toggleCheatsheet() {
    cheatsheetOpen = !cheatsheetOpen;
    cheatsheet.style.display = cheatsheetOpen ? 'flex' : 'none';
  }
  csCl.addEventListener('click', toggleCheatsheet);

  // ── Onboarding Tour (first launch) ───────────────────────
  var tourOverlay = mk('div', 'moldui-tour-overlay', overlay);
  tourOverlay.style.pointerEvents = 'auto';
  var tourBubble = mk('div', 'moldui-tour-bubble', overlay);
  tourBubble.style.pointerEvents = 'auto';
  var tourStep = 0;
  var tourSteps = [
    { target: '.moldui-viewport-bar', text: 'Switch viewports to test responsive design. Mobile, tablet, desktop — click to preview.' },
    { target: '.moldui-action-bar', text: 'Undo, Redo, and Save your visual changes here. Save writes to your source files via Claude.' },
    { target: null, text: 'Click any element to edit it. Drag to reorder. Double-click to edit text. Press ? for all shortcuts. Happy molding!' }
  ];

  function showTourStep() {
    // Mark as started so reloads don't restart
    try { localStorage.setItem('__moldui_tour_started__', '1'); } catch(x) {}
    if (tourStep >= tourSteps.length) { endTour(); return; }
    var s = tourSteps[tourStep];
    tourOverlay.style.display = 'block';
    while (tourBubble.firstChild) tourBubble.removeChild(tourBubble.firstChild);
    var tx = mk('div', 'moldui-tour-text', tourBubble);
    tx.textContent = s.text;
    var pr = mk('div', 'moldui-tour-progress', tourBubble);
    pr.textContent = 'Step ' + (tourStep + 1) + ' of ' + tourSteps.length;
    var btns = mk('div', 'moldui-tour-btns', tourBubble);
    var skipB = document.createElement('button');
    skipB.className = 'moldui-tour-skip';
    skipB.textContent = 'Skip';
    skipB.addEventListener('click', endTour);
    btns.appendChild(skipB);
    var nextB = document.createElement('button');
    nextB.className = 'moldui-tour-next';
    nextB.textContent = tourStep === tourSteps.length - 1 ? 'Got it \u2713' : 'Next \u2192';
    nextB.addEventListener('click', function() { tourStep++; showTourStep(); });
    btns.appendChild(nextB);

    if (s.target) {
      var t = shadow.querySelector(s.target);
      if (t) {
        var r = t.getBoundingClientRect();
        tourBubble.style.cssText = 'display:block;position:fixed;top:' + (r.bottom + 14) + 'px;left:' + Math.max(12, r.left) + 'px;pointer-events:auto;';
      } else tourBubble.style.cssText = 'display:block;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:auto;';
    } else tourBubble.style.cssText = 'display:block;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:auto;';
  }
  function endTour() {
    tourOverlay.style.display = 'none';
    tourBubble.style.display = 'none';
    try { localStorage.setItem('__moldui_tour_done__', '1'); } catch(x) {}
  }
  (function maybeStartTour() {
    var seen = false;
    try {
      seen = localStorage.getItem('__moldui_tour_done__') === '1' || localStorage.getItem('__moldui_tour_started__') === '1';
    } catch(x) {}
    if (!seen) setTimeout(showTourStep, 900);
  })();

  // ── Visual Viewport Frames (override old handler) ────────
  var bodyFrameStyle = document.createElement('style');
  bodyFrameStyle.textContent = 'body.moldui-has-frame { background: #0a0a0f !important; min-height: 100vh; transition: background 0.3s; }';
  document.head.appendChild(bodyFrameStyle);

  // Replace the viewport bar click handler by cloning + re-attaching
  var newVpBar = vpBar.cloneNode(true);
  vpBar.parentNode.replaceChild(newVpBar, vpBar);
  newVpBar.addEventListener('click', function(e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    newVpBar.querySelectorAll('button').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    var vp = btn.dataset.vp;
    var html = document.documentElement, body = document.body;
    if (vp === 'full') {
      html.style.maxWidth = ''; html.style.margin = ''; html.style.boxShadow = ''; html.style.borderRadius = ''; html.style.overflow = '';
      body.classList.remove('moldui-has-frame');
    } else {
      var w = parseInt(vp);
      html.style.maxWidth = w + 'px';
      html.style.margin = '24px auto 40px';
      html.style.boxShadow = '0 0 0 8px #1a1a1a, 0 0 0 9px rgba(255,255,255,0.08), 0 24px 60px rgba(0,0,0,0.5)';
      html.style.borderRadius = w <= 480 ? '32px' : w <= 900 ? '18px' : '8px';
      html.style.overflow = 'hidden';
      body.classList.add('moldui-has-frame');
    }
  });

  // ── Zoom (Cmd+scroll) ────────────────────────────────────
  var zoomLevel = 1;
  var zoomBadge = mk('div', 'moldui-zoom-badge', overlay);
  zoomBadge.textContent = '100%';
  zoomBadge.style.pointerEvents = 'auto';
  zoomBadge.addEventListener('click', function() { zoomLevel = 1; applyZoom(); });

  function applyZoom() {
    document.documentElement.style.transform = 'scale(' + zoomLevel + ')';
    document.documentElement.style.transformOrigin = 'top center';
    zoomBadge.textContent = Math.round(zoomLevel * 100) + '%';
    if (state.selected) syncSel();
  }
  document.addEventListener('wheel', function(e) {
    if (!(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    zoomLevel = Math.max(0.25, Math.min(3, zoomLevel + (e.deltaY > 0 ? -0.1 : 0.1)));
    applyZoom();
  }, { passive: false });

  // ── Global keyboard: L, Cmd+K, Cmd+/, ?, Cmd+0, Cmd+=, Cmd+- ─
  document.addEventListener('keydown', function(e) {
    if (textEdit) return;
    // Cmd+K always works (even while typing in a different input — it's a palette trigger)
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); togglePalette(); return; }
    // Don't hijack single-letter shortcuts if user is typing somewhere
    if (isTypingTarget(e)) return;
    if (e.key === 'l' && !e.metaKey && !e.ctrlKey && !paletteOpen) { e.preventDefault(); toggleLayersPanel(); }
    else if ((e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); toggleChatPanel(); }
    else if (e.key === '?') { e.preventDefault(); toggleCheatsheet(); }
    else if ((e.metaKey || e.ctrlKey) && e.key === '0') { e.preventDefault(); zoomLevel = 1; applyZoom(); }
    else if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomLevel = Math.min(3, zoomLevel + 0.1); applyZoom(); }
    else if ((e.metaKey || e.ctrlKey) && e.key === '-') { e.preventDefault(); zoomLevel = Math.max(0.25, zoomLevel - 0.1); applyZoom(); }
  }, true);

  // Patch selectEl to also re-render layers tree
  var _origSelectEl = selectEl;
  selectEl = function(el) {
    _origSelectEl(el);
    if (layersPanelOpen) renderLayersTree();
  };

  console.log('[moldui] v2.0 loaded. Press ? for shortcuts. Cmd+K to search, L for layers, Cmd+/ for AI chat.');
})();
