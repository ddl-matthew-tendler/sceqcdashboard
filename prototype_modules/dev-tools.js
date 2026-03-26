/**
 * Domino Dev Tools — Drop-in module for prototype dev mode + comment system.
 * Prefix: ddt- (Domino Dev Tools) for all DOM classes/IDs.
 *
 * Requires: data-domino-component attributes on elements (added by domino-components.js alias layer).
 * Optional: comment-api.py mounted in the prototype's FastAPI app for persistence.
 *           Falls back to localStorage if the server is unavailable.
 */
(function DominoDevTools() {
  'use strict';

  var h = React.createElement;

  var CONFIG = {
    apiBase: 'api/dev-tools',
    navHeight: 44,
    storageKey: 'ddt-comments',
    pinZIndex: 10000,
    overlayZIndex: 10001,
    drawerZIndex: 10002,
    toolbarZIndex: 10003,
  };

  var state = {
    devMode: false,
    commentMode: false,
    drawerOpen: false,
    comments: [],
    currentPage: location.pathname,
    serverAvailable: true,
    pinElements: {},
    highlightedEl: null,
  };

  // ==================== API Client ====================

  var api = {
    async getComments(page) {
      try {
        var res = await fetch(CONFIG.apiBase + '/comments?page=' + encodeURIComponent(page));
        if (!res.ok) throw new Error(res.status);
        state.serverAvailable = true;
        return await res.json();
      } catch (e) {
        state.serverAvailable = false;
        var all = JSON.parse(localStorage.getItem(CONFIG.storageKey) || '[]');
        return all.filter(function (c) { return c.page === page; });
      }
    },

    async createComment(data) {
      var comment = Object.assign({
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
        resolved: false,
        createdAt: new Date().toISOString(),
      }, data);

      if (state.serverAvailable) {
        try {
          var res = await fetch(CONFIG.apiBase + '/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          if (res.ok) return await res.json();
        } catch (e) { state.serverAvailable = false; }
      }
      var all = JSON.parse(localStorage.getItem(CONFIG.storageKey) || '[]');
      all.push(comment);
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(all));
      return comment;
    },

    async updateComment(id, update) {
      if (state.serverAvailable) {
        try {
          var res = await fetch(CONFIG.apiBase + '/comments/' + id, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(update),
          });
          if (res.ok) return await res.json();
        } catch (e) { state.serverAvailable = false; }
      }
      var all = JSON.parse(localStorage.getItem(CONFIG.storageKey) || '[]');
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === id) { Object.assign(all[i], update); break; }
      }
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(all));
      return all.find(function (c) { return c.id === id; });
    },

    async deleteComment(id) {
      if (state.serverAvailable) {
        try {
          var res = await fetch(CONFIG.apiBase + '/comments/' + id, { method: 'DELETE' });
          if (res.ok) return;
        } catch (e) { state.serverAvailable = false; }
      }
      var all = JSON.parse(localStorage.getItem(CONFIG.storageKey) || '[]');
      all = all.filter(function (c) { return c.id !== id; });
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(all));
    },
  };

  // ==================== DOM Helpers ====================

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'className') node.className = attrs[k];
      else if (k === 'textContent') node.textContent = attrs[k];
      else if (k === 'innerHTML') node.innerHTML = attrs[k];
      else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else if (child) node.appendChild(child);
    }
    return node;
  }

  function findComponentEl(target) {
    var node = target;
    while (node && node !== document.body) {
      if (node.getAttribute && node.getAttribute('data-domino-component')) return node;
      node = node.parentElement;
    }
    return null;
  }

  function getViewState(target) {
    var states = [];
    var node = target;
    while (node && node !== document.body) {
      var vs = node.getAttribute && node.getAttribute('data-domino-view-state');
      if (vs) states.unshift(vs);
      node = node.parentElement;
    }
    return states.length > 0 ? states.join('/') : null;
  }

  function resolveViewStateScope(viewState) {
    if (!viewState) return document;
    var parts = viewState.split('/');
    var scope = document;
    for (var i = 0; i < parts.length; i++) {
      var match = scope.querySelector('[data-domino-view-state="' + parts[i] + '"]');
      if (!match) return null;
      scope = match;
    }
    return scope;
  }

  function getComponentIndex(el) {
    var name = el.getAttribute('data-domino-component');
    var viewStateEl = el.closest('[data-domino-view-state]');
    var scope = viewStateEl || document;
    var all = scope.querySelectorAll('[data-domino-component="' + name + '"]');
    for (var i = 0; i < all.length; i++) { if (all[i] === el) return i; }
    return 0;
  }

  function findTargetEl(comment) {
    var scope = resolveViewStateScope(comment.viewState);
    if (!scope) return null;
    var all = scope.querySelectorAll('[data-domino-component="' + comment.targetComponent + '"]');
    return all[comment.targetIndex] || null;
  }

  // ==================== SVG Icons ====================

  var ICONS = {
    code: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    comment: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    undo: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
  };

  // ==================== Toolbar ====================

  var toolbar = {
    container: null,
    devBtn: null,
    commentBtn: null,
    badge: null,

    create: function () {
      this.container = el('div', { className: 'ddt-toolbar' });

      this.devBtn = el('button', {
        className: 'ddt-toolbar-btn',
        innerHTML: ICONS.code,
        title: 'Dev Mode — hover to see component names',
        onClick: function () { state.devMode ? devMode.disable() : devMode.enable(); },
      });

      this.badge = el('span', { className: 'ddt-badge', textContent: '0' });
      this.badge.style.display = 'none';

      this.commentBtn = el('button', {
        className: 'ddt-toolbar-btn',
        innerHTML: ICONS.comment,
        title: 'Comment Mode — click to add comments',
        onClick: function (e) {
          if (e.shiftKey || state.commentMode) {
            if (state.commentMode) commentMode.disable();
            else commentMode.enable();
          } else {
            if (state.drawerOpen) commentDrawer.close();
            else commentDrawer.open();
          }
        },
      });
      this.commentBtn.appendChild(this.badge);

      this.container.appendChild(this.devBtn);
      this.container.appendChild(this.commentBtn);
      document.body.appendChild(this.container);

      var hint = el('div', { className: 'ddt-toolbar-hint', textContent: 'Shift+click for comment mode' });
      this.commentBtn.appendChild(hint);
    },

    updateBadge: function () {
      var unresolvedCount = state.comments.filter(function (c) { return !c.resolved; }).length;
      this.badge.textContent = unresolvedCount;
      this.badge.style.display = unresolvedCount > 0 ? '' : 'none';
    },
  };

  // ==================== Dev Mode ====================

  var devMode = {
    tooltipEl: null,
    outlineEl: null,

    enable: function () {
      state.devMode = true;
      toolbar.devBtn.classList.add('ddt-active');
      document.body.classList.add('ddt-dev-mode-active');
      document.addEventListener('mouseover', this._onOver, true);
      document.addEventListener('mouseout', this._onOut, true);
    },

    disable: function () {
      state.devMode = false;
      toolbar.devBtn.classList.remove('ddt-active');
      document.body.classList.remove('ddt-dev-mode-active');
      document.removeEventListener('mouseover', this._onOver, true);
      document.removeEventListener('mouseout', this._onOut, true);
      this.hideTooltip();
    },

    _onOver: function (e) {
      var comp = findComponentEl(e.target);
      if (comp) devMode.showTooltip(comp);
    },

    _onOut: function (e) {
      var comp = findComponentEl(e.relatedTarget);
      if (!comp || comp !== state.highlightedEl) devMode.hideTooltip();
    },

    showTooltip: function (compEl) {
      if (state.highlightedEl === compEl) return;
      this.hideTooltip();
      state.highlightedEl = compEl;

      var name = compEl.getAttribute('data-domino-component');
      compEl.classList.add('ddt-component-outline');

      this.tooltipEl = el('div', { className: 'ddt-dev-tooltip' },
        el('div', { className: 'ddt-dev-tooltip-name', textContent: name }),
        el('div', { className: 'ddt-dev-tooltip-import', textContent: "import { " + name + " } from '@domino/base-components'" })
      );
      document.body.appendChild(this.tooltipEl);

      var rect = compEl.getBoundingClientRect();
      var tipRect = this.tooltipEl.getBoundingClientRect();
      var left = rect.left + (rect.width - tipRect.width) / 2;
      var top = rect.top - tipRect.height - 8;
      if (top < 4) top = rect.bottom + 8;
      if (left < 4) left = 4;
      if (left + tipRect.width > window.innerWidth - 4) left = window.innerWidth - tipRect.width - 4;

      this.tooltipEl.style.left = left + 'px';
      this.tooltipEl.style.top = top + 'px';
      this.tooltipEl.style.opacity = '1';
    },

    hideTooltip: function () {
      if (this.tooltipEl) { this.tooltipEl.remove(); this.tooltipEl = null; }
      if (state.highlightedEl) { state.highlightedEl.classList.remove('ddt-component-outline'); state.highlightedEl = null; }
    },
  };

  // ==================== Comment Mode ====================

  var commentMode = {
    formEl: null,

    enable: function () {
      state.commentMode = true;
      toolbar.commentBtn.classList.add('ddt-active');
      document.body.classList.add('ddt-comment-mode-active');
      document.addEventListener('click', this._onClick, true);
      pins.render();
    },

    disable: function () {
      state.commentMode = false;
      toolbar.commentBtn.classList.remove('ddt-active');
      document.body.classList.remove('ddt-comment-mode-active');
      document.removeEventListener('click', this._onClick, true);
      this.closeForm();
      pins.remove();
    },

    _onClick: function (e) {
      if (e.target.closest('.ddt-toolbar, .ddt-comment-form, .ddt-drawer, .ddt-pin')) return;
      e.preventDefault();
      e.stopPropagation();

      var compEl = findComponentEl(e.target);
      if (!compEl) return;

      commentMode.showForm(e.clientX, e.clientY, compEl);
    },

    showForm: function (x, y, compEl) {
      this.closeForm();
      var name = compEl.getAttribute('data-domino-component');
      var rect = compEl.getBoundingClientRect();
      var xPct = ((x - rect.left) / rect.width) * 100;
      var yPct = ((y - rect.top) / rect.height) * 100;

      var textarea = el('textarea', {
        className: 'ddt-comment-textarea',
        placeholder: 'Add a comment on ' + name + '...',
      });

      var self = this;
      this.formEl = el('div', { className: 'ddt-comment-form' },
        el('div', { className: 'ddt-comment-form-header' },
          el('span', { textContent: name }),
          el('button', { className: 'ddt-icon-btn', innerHTML: ICONS.close, onClick: function () { self.closeForm(); } })
        ),
        textarea,
        el('div', { className: 'ddt-comment-form-actions' },
          el('button', {
            className: 'ddt-btn ddt-btn-primary',
            textContent: 'Add Comment',
            onClick: async function () {
              var text = textarea.value.trim();
              if (!text) return;
              await commentMode.submitComment(text, compEl, xPct, yPct);
              self.closeForm();
            },
          })
        )
      );
      document.body.appendChild(this.formEl);

      var formW = 300, formH = 200;
      var left = Math.min(x + 12, window.innerWidth - formW - 12);
      var top = Math.min(y + 12, window.innerHeight - formH - 12);
      this.formEl.style.left = left + 'px';
      this.formEl.style.top = top + 'px';
      textarea.focus();
    },

    closeForm: function () {
      if (this.formEl) { this.formEl.remove(); this.formEl = null; }
    },

    submitComment: async function (text, compEl, xPct, yPct) {
      var name = compEl.getAttribute('data-domino-component');
      var comment = await api.createComment({
        page: state.currentPage,
        targetComponent: name,
        targetIndex: getComponentIndex(compEl),
        xPercent: xPct,
        yPercent: yPct,
        text: text,
        author: 'Anonymous',
        viewState: getViewState(compEl),
      });
      state.comments.push(comment);
      toolbar.updateBadge();
      pins.render();
      if (state.drawerOpen) commentDrawer.render();
    },
  };

  // ==================== Comment Pins ====================

  var pins = {
    container: null,

    render: function () {
      this.remove();
      this.container = el('div', { className: 'ddt-pins-container' });
      document.body.appendChild(this.container);

      state.comments.forEach(function (comment, idx) {
        var target = findTargetEl(comment);
        if (!target) return;

        var pinEl = el('button', {
          className: 'ddt-pin' + (comment.resolved ? ' ddt-pin-resolved' : ''),
          textContent: idx + 1,
          title: comment.text.slice(0, 60),
          onClick: function (e) {
            e.stopPropagation();
            commentDrawer.open();
            commentDrawer.scrollTo(comment.id);
          },
        });
        state.pinElements[comment.id] = pinEl;
        pins.container.appendChild(pinEl);
      });
      this.updatePositions();
    },

    remove: function () {
      if (this.container) { this.container.remove(); this.container = null; }
      state.pinElements = {};
    },

    updatePositions: function () {
      state.comments.forEach(function (comment) {
        var pinEl = state.pinElements[comment.id];
        if (!pinEl) return;
        var target = findTargetEl(comment);
        if (!target) { pinEl.style.display = 'none'; return; }

        var rect = target.getBoundingClientRect();
        pinEl.style.display = '';
        pinEl.style.left = (rect.left + rect.width * comment.xPercent / 100 - 12) + 'px';
        pinEl.style.top = (rect.top + rect.height * comment.yPercent / 100 - 12 + window.scrollY) + 'px';
      });
    },
  };

  // ==================== Comment Drawer ====================

  var commentDrawer = {
    el: null,
    listEl: null,

    open: function () {
      state.drawerOpen = true;
      if (!this.el) this.create();
      this.el.classList.add('ddt-drawer-open');
      this.render();
      if (!state.commentMode) pins.render();
    },

    close: function () {
      state.drawerOpen = false;
      if (this.el) this.el.classList.remove('ddt-drawer-open');
      if (!state.commentMode) pins.remove();
      this.clearHighlight();
    },

    create: function () {
      var self = this;
      this.listEl = el('div', { className: 'ddt-drawer-list' });
      this.el = el('div', { className: 'ddt-drawer' },
        el('div', { className: 'ddt-drawer-header' },
          el('span', { className: 'ddt-drawer-title', textContent: 'Comments' }),
          el('div', { className: 'ddt-drawer-header-actions' },
            el('button', {
              className: 'ddt-btn ddt-btn-small',
              textContent: state.commentMode ? 'Exit Comment Mode' : 'Add Comments',
              onClick: function () {
                if (state.commentMode) commentMode.disable();
                else commentMode.enable();
                this.textContent = state.commentMode ? 'Exit Comment Mode' : 'Add Comments';
              },
            }),
            el('button', { className: 'ddt-icon-btn', innerHTML: ICONS.close, onClick: function () { self.close(); } })
          )
        ),
        this.listEl
      );
      document.body.appendChild(this.el);
    },

    render: function () {
      if (!this.listEl) return;
      this.listEl.innerHTML = '';
      var self = this;

      if (state.comments.length === 0) {
        this.listEl.appendChild(el('div', { className: 'ddt-drawer-empty', textContent: 'No comments yet. Shift+click the comment icon to start adding comments.' }));
        return;
      }

      var grouped = {};
      state.comments.forEach(function (c) {
        var key = c.targetComponent || 'Unknown';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(c);
      });

      Object.keys(grouped).forEach(function (compName) {
        var group = el('div', { className: 'ddt-drawer-group' },
          el('div', { className: 'ddt-drawer-group-title', textContent: compName })
        );

        grouped[compName].forEach(function (comment) {
          var card = self.createCommentCard(comment);
          group.appendChild(card);
        });

        self.listEl.appendChild(group);
      });
    },

    createCommentCard: function (comment) {
      var self = this;
      var card = el('div', {
        className: 'ddt-drawer-card' + (comment.resolved ? ' ddt-resolved' : ''),
        id: 'ddt-comment-' + comment.id,
        onMouseenter: function () { self.highlightElement(comment); },
        onMouseleave: function () { self.clearHighlight(); },
      });

      var dot = el('span', { className: 'ddt-status-dot' + (comment.resolved ? ' ddt-dot-resolved' : '') });
      var text = el('div', { className: 'ddt-drawer-card-text', textContent: comment.text });
      var timeParts = [self.formatTime(comment.createdAt)];
      if (comment.viewState) timeParts.push('· ' + comment.viewState.split('/').pop());
      var time = el('div', { className: 'ddt-drawer-card-time', textContent: timeParts.join(' ') });

      var resolveBtn = el('button', {
        className: 'ddt-icon-btn',
        innerHTML: comment.resolved ? ICONS.undo : ICONS.check,
        title: comment.resolved ? 'Unresolve' : 'Resolve',
        onClick: async function (e) {
          e.stopPropagation();
          var updated = await api.updateComment(comment.id, { resolved: !comment.resolved });
          var idx = state.comments.findIndex(function (c) { return c.id === comment.id; });
          if (idx !== -1) state.comments[idx] = Object.assign(state.comments[idx], updated);
          toolbar.updateBadge();
          self.render();
          pins.render();
        },
      });

      var deleteBtn = el('button', {
        className: 'ddt-icon-btn ddt-icon-btn-danger',
        innerHTML: ICONS.trash,
        title: 'Delete',
        onClick: async function (e) {
          e.stopPropagation();
          await api.deleteComment(comment.id);
          state.comments = state.comments.filter(function (c) { return c.id !== comment.id; });
          toolbar.updateBadge();
          self.render();
          pins.render();
        },
      });

      var actions = el('div', { className: 'ddt-drawer-card-actions' }, resolveBtn, deleteBtn);
      var header = el('div', { className: 'ddt-drawer-card-header' }, dot, time, actions);

      card.appendChild(header);
      card.appendChild(text);
      return card;
    },

    scrollTo: function (commentId) {
      var cardEl = document.getElementById('ddt-comment-' + commentId);
      if (cardEl) cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    highlightElement: function (comment) {
      this.clearHighlight();
      var target = findTargetEl(comment);
      if (target) {
        target.classList.add('ddt-comment-highlight');
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    },

    clearHighlight: function () {
      document.querySelectorAll('.ddt-comment-highlight').forEach(function (el) {
        el.classList.remove('ddt-comment-highlight');
      });
    },

    formatTime: function (iso) {
      if (!iso) return '';
      var d = new Date(iso);
      var now = new Date();
      var diff = (now - d) / 1000;
      if (diff < 60) return 'just now';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      return d.toLocaleDateString();
    },
  };

  // ==================== Scroll/Resize Tracking ====================

  function onScrollOrResize() {
    if (pins.container) pins.updatePositions();
  }

  // ==================== Page Navigation Watcher ====================

  async function onPageChange() {
    var newPage = location.pathname;
    if (newPage === state.currentPage) return;
    state.currentPage = newPage;
    state.comments = await api.getComments(newPage);
    toolbar.updateBadge();
    if (state.drawerOpen) commentDrawer.render();
    if (state.commentMode || state.drawerOpen) pins.render();
  }

  // ==================== Init ====================

  async function init() {
    toolbar.create();
    state.comments = await api.getComments(state.currentPage);
    toolbar.updateBadge();

    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);

    var pushState = history.pushState;
    history.pushState = function () {
      pushState.apply(history, arguments);
      setTimeout(onPageChange, 50);
    };
    window.addEventListener('popstate', function () { setTimeout(onPageChange, 50); });

    if (!state.serverAvailable) {
      console.warn('[DominoDevTools] Comment server not available — using localStorage fallback. Mount comment-api.py in your FastAPI app for persistence.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
