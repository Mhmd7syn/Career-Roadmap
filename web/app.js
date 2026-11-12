/**
 * Knowledge Graph Engine
 * Lazy-Loading Directory-as-Graph:
 * - Loads station data on demand directly from disk.
 * - Each station has strictly two files:
 *     1. info.md   : Station description, mental models, recall questions, links
 *     2. notes.md  : Personal summary of what was learned
 * - Any other file in the folder is an "extra file" viewable via the "Extra Files" button.
 * - Child creation is a simple '+' button that prompts only for the station name.
 */
(function () {
  'use strict';

  // State
  const nodeCache = {}; // relPath -> node data
  let historyStack = [{ id: 'root', relPath: '', title: '' }];
  let currentNode = null;
  let currentRecommendedNode = null;
  let activeModalNodeRelPath = '';
  let activeDocType = 'info'; // 'info' (info.md) | 'notes' (notes.md)
  let activeEditorMode = 'preview'; // 'preview' | 'edit'
  let autoSaveTimer = null;
  let lastSavedContent = '';
  let isSavingMarkdown = false;
  let targetAddChildParentId = '';

  // ---------------------------------------------------------------------------
  // 1. Navigation & State Accessors
  // ---------------------------------------------------------------------------

  function getCurrentHistoryItem() {
    return historyStack[historyStack.length - 1];
  }

  function getCurrentRelPath() {
    const item = getCurrentHistoryItem();
    return item ? item.relPath : '';
  }

  function syncHistoryTitle(relPath, title) {
    if (!title) return;
    for (const item of historyStack) {
      if (item.relPath === relPath) {
        item.title = title;
      }
    }
  }

  function navigateToNode(relPath, breadcrumbs = null) {
    if (isFullGraphMode) {
      toggleFullGraphMode(false);
    }
    if (breadcrumbs && Array.isArray(breadcrumbs) && breadcrumbs.length > 0) {
      historyStack = breadcrumbs.map(b => ({
        id: b.id,
        relPath: b.relPath,
        title: b.title
      }));
    } else {
      if (!relPath) {
        historyStack = [{ id: 'root', relPath: '', title: 'Root' }];
      } else {
        const parts = relPath.split('/');
        historyStack = [{ id: 'root', relPath: '', title: 'Root' }];
        let currPath = '';
        for (const part of parts) {
          currPath = currPath ? `${currPath}/${part}` : part;
          const cached = nodeCache[currPath];
          const title = cached ? cached.title : part.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          historyStack.push({ id: part, relPath: currPath, title: title });
        }
      }
    }
    loadNodeOnDemand(relPath, false, 'forward');
  }

  // ---------------------------------------------------------------------------
  // 2. Data Loading & Disk Sync
  // ---------------------------------------------------------------------------

  async function updateProgressStats() {
    const progressFill = document.getElementById('overall-progress-fill');
    const progressText = document.getElementById('overall-progress-text');
    const progressPill = document.getElementById('overall-progress-pill');

    try {
      const res = await fetch('/api/stats', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const percent = data.percent || 0;
        if (progressFill) progressFill.style.width = percent + '%';
        if (progressText) progressText.textContent = `${percent}%`;
        if (progressPill) {
          let tooltip = `${data.completed}/${data.total} Completed (${percent}%)`;
          if (data.needsReview) {
            tooltip += ` • ${data.needsReview} Need Review`;
          }
          progressPill.title = tooltip;
        }
      }
    } catch (e) {
      // Disk fetch error
    }
  }

  async function loadNodeOnDemand(relPath, forceRefresh = false, direction = 'none') {
    if (!forceRefresh && nodeCache[relPath]) {
      currentNode = nodeCache[relPath];
      syncHistoryTitle(relPath, currentNode.title);
      if (currentNode.title) document.title = `${currentNode.title} — Knowledge Graph`;
      renderCurrentView(direction);
      updateNextNodeRecommendation(relPath);
      return;
    }

    try {
      const res = await fetch(`/api/node?path=${encodeURIComponent(relPath)}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        nodeCache[relPath] = data;
        currentNode = data;
        syncHistoryTitle(relPath, data.title);
        if (data.title) document.title = `${data.title} — Knowledge Graph`;
        renderCurrentView(direction);
        updateNextNodeRecommendation(relPath);
      }
    } catch (err) {
      console.error('Error loading node from disk:', err);
    }
  }

  async function setNodeStatus(newStatus) {
    if (!currentNode) return;

    currentNode.status = newStatus;
    const relPath = currentNode.relPath;

    try {
      const res = await fetch('/api/save-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: relPath, status: newStatus })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.node) {
          nodeCache[relPath] = data.node;
          currentNode = data.node;
        }
        updateProgressStats();
        updateNextNodeRecommendation(relPath);
        fullGraphTreeData = null;
      }
    } catch (err) {
      console.warn('Failed to save status to disk:', err);
    }

    renderCurrentView();
  }

  async function updateNextNodeRecommendation(relPath = '') {
    const nextPill = document.getElementById('next-node-pill');
    const nextLabel = document.getElementById('next-node-label');
    const nextTitle = document.getElementById('next-node-title');

    if (!nextPill) return;

    try {
      const res = await fetch(`/api/next-node?path=${encodeURIComponent(relPath)}`, { cache: 'no-store' });
      if (!res.ok) return;

      const data = await res.json();

      if (data.found && data.node) {
        currentRecommendedNode = data.node;
        const node = data.node;
        const isCurrent = data.isCurrentNode;

        nextPill.style.display = 'inline-flex';
        nextPill.classList.remove('is-completed', 'is-needs-review');
        if (node.status === 'needs-review') {
          nextPill.classList.add('is-needs-review');
          nextLabel.textContent = 'Review:';
          nextPill.title = `Needs Review: ${node.title} (${node.category}) — click to review`;
        } else if (isCurrent) {
          nextPill.classList.add('is-current');
          nextLabel.textContent = 'Current:';
          nextPill.title = `Current Focus: ${node.title} (${node.category}) — click to view info.md`;
        } else {
          nextPill.classList.remove('is-current');
          nextLabel.textContent = 'Next:';
          nextPill.title = `Next to Learn: ${node.title} in ${node.category} — click to jump`;
        }
        nextTitle.textContent = node.title;
      } else if (data.allCompleted) {
        currentRecommendedNode = null;
        nextPill.style.display = 'inline-flex';
        nextPill.classList.remove('is-current');
        nextPill.classList.add('is-completed');
        nextLabel.textContent = 'Status:';
        nextTitle.textContent = 'Completed 🎉';
        nextPill.title = 'All stations in this section are completed!';
      } else {
        nextPill.style.display = 'none';
        currentRecommendedNode = null;
      }
    } catch (e) {
      console.warn('Failed to load next node recommendation:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // 3. UI Rendering: Breadcrumbs & Header
  // ---------------------------------------------------------------------------

  function renderHeaderAndBreadcrumbs() {
    const breadcrumbsEl = document.getElementById('breadcrumbs');
    const backBtnEl = document.getElementById('btn-back');

    if (breadcrumbsEl) {
      breadcrumbsEl.innerHTML = '';
      historyStack.forEach((item, index) => {
        const isLast = index === historyStack.length - 1;

        if (index > 0) {
          const sep = document.createElement('span');
          sep.className = 'breadcrumb-sep';
          sep.textContent = '/';
          breadcrumbsEl.appendChild(sep);
        }

        const span = document.createElement('span');
        if (isLast) {
          span.className = 'breadcrumb-current';
          span.textContent = item.title;
        } else {
          span.className = 'breadcrumb-item';
          span.textContent = item.title;
          span.onclick = () => {
            historyStack = historyStack.slice(0, index + 1);
            loadNodeOnDemand(item.relPath, false, 'back');
          };
        }
        breadcrumbsEl.appendChild(span);
      });
    }

    if (backBtnEl) {
      backBtnEl.style.display = historyStack.length > 1 ? 'inline-flex' : 'none';
      backBtnEl.onclick = () => {
        if (historyStack.length > 1) {
          historyStack.pop();
          const prev = getCurrentHistoryItem();
          loadNodeOnDemand(prev.relPath, false, 'back');
        }
      };
    }
  }

  // ---------------------------------------------------------------------------
  // 4. SVG Connector Splines
  // ---------------------------------------------------------------------------

  function drawConnectorLines() {
    const svgEl = document.getElementById('graph-svg');
    const parentCard = document.querySelector('.graph-parent-card');
    const childNodes = document.querySelectorAll('.graph-child-node');

    if (!svgEl || !parentCard || childNodes.length === 0) {
      if (svgEl) svgEl.innerHTML = '';
      return;
    }

    const svgRect = svgEl.getBoundingClientRect();
    const pRect = parentCard.getBoundingClientRect();

    const x1 = pRect.left + pRect.width / 2 - svgRect.left;
    const y1 = pRect.bottom - svgRect.top;

    let svgHtml = '';

    childNodes.forEach((childEl, index) => {
      const cRect = childEl.getBoundingClientRect();
      const x2 = cRect.left + cRect.width / 2 - svgRect.left;
      const y2 = cRect.top - svgRect.top;

      const dy = y2 - y1;
      const cp1_y = y1 + dy * 0.55;
      const cp2_y = y2 - dy * 0.45;

      const pathData = `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1.toFixed(1)} ${cp1_y.toFixed(1)}, ${x2.toFixed(1)} ${cp2_y.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
      const status = childEl.dataset.status || 'todo';
      const pathId = `spline-${index}`;

      svgHtml += `<path id="${pathId}" class="graph-svg-path ${status}" d="${pathData}" />`;

      childEl.onmouseenter = () => {
        const p = document.getElementById(pathId);
        if (p) p.classList.add('highlight');
      };
      childEl.onmouseleave = () => {
        const p = document.getElementById(pathId);
        if (p) p.classList.remove('highlight');
      };
    });

    svgEl.innerHTML = svgHtml;
  }

  window.addEventListener('resize', () => {
    requestAnimationFrame(drawConnectorLines);
  });

  // ---------------------------------------------------------------------------
  // 5. Main Canvas View
  // ---------------------------------------------------------------------------

  function renderCurrentView(direction = 'none') {
    renderHeaderAndBreadcrumbs();

    const parentAnchor = document.getElementById('graph-parent-anchor');
    const childrenAnchor = document.getElementById('graph-children-anchor');
    const svgEl = document.getElementById('graph-svg');

    if (!parentAnchor || !childrenAnchor) return;

    if (!currentNode) {
      parentAnchor.innerHTML = '<div class="graph-parent-card"><span class="graph-parent-title">Loading...</span></div>';
      childrenAnchor.innerHTML = '';
      if (svgEl) svgEl.innerHTML = '';
      return;
    }

    const currentStatus = currentNode.status || 'todo';
    const badgeText = currentNode.badge || '';
    const isParentShortcut = currentNode.isShortcut || false;
    const shortcutBadgeHtml = isParentShortcut
      ? `<span class="badge-shortcut" title="Linked to ${currentNode.canonicalRelPath}">↗ Shared from ${currentNode.canonicalRelPath}</span>`
      : '';
    const shortcutJumpBtnHtml = (isParentShortcut && currentNode.canonicalRelPath && currentNode.canonicalRelPath !== currentNode.relPath)
      ? `<button class="btn-graph-action btn-graph-shortcut-jump" id="btn-parent-shortcut-jump" title="Jump to canonical station location">↗ Canonical</button>`
      : '';

    // Extra files badge & button visibility rule:
    // Only display the Extra Files button if extra files actually exist in this station's folder.
    const extraFilesCount = (currentNode.extraFiles && currentNode.extraFiles.length) || 0;
    const extraFilesBtnHtml = extraFilesCount > 0
      ? `<button class="btn-graph-action btn-graph-files" id="btn-parent-extra-files" title="View ${extraFilesCount} extra files">📁 Extra Files (${extraFilesCount})</button>`
      : '';

    const isRoot = !currentNode.relPath || currentNode.relPath === 'root';
    const stationMgmtButtonsHtml = !isRoot ? `
      <button class="btn-graph-action btn-graph-rename" id="btn-parent-rename" title="Rename station title & slug">✏️ Rename</button>
      <button class="btn-graph-action btn-graph-move" id="btn-parent-move" title="Move station to another parent hub">📁 Move</button>
      <button class="btn-graph-action btn-graph-share" id="btn-parent-share" title="Create shortcut link in another hub">↗ Share</button>
      <button class="btn-graph-action btn-graph-delete" id="btn-parent-delete" title="Delete station">🗑️ Delete</button>
    ` : '';

    // 1. Render Parent Node Card
    parentAnchor.innerHTML = `
      <div class="graph-parent-card">
        <div class="graph-parent-top-row">
          <button class="btn-status-cycle status-${currentStatus}" id="btn-status-toggle" title="${currentStatus === 'needs-review' ? 'Needs review after 1 month. Click to mark reviewed and completed' : 'Cycle status: To Do → In Progress → Done'}">
            ${currentStatus === 'completed' ? '● Done' : (currentStatus === 'in-progress' ? '◐ In Progress' : (currentStatus === 'needs-review' ? '⚠ Needs Review' : '○ To Do'))}
          </button>
          ${shortcutBadgeHtml}
          ${badgeText ? `<span style="font-size: 0.72rem; color: var(--accent-blue); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">${badgeText}</span>` : ''}
        </div>
        <div class="graph-parent-title">${currentNode.title}</div>
        <div class="graph-parent-actions">
          <button class="btn-graph-action btn-graph-info" id="btn-parent-info" title="View & edit info.md">ℹ️ Info</button>
          <button class="btn-graph-action btn-graph-notes" id="btn-parent-notes" title="View & edit notes.md">📝 Notes</button>
          ${shortcutJumpBtnHtml}
          ${extraFilesBtnHtml}
          ${stationMgmtButtonsHtml}
        </div>
      </div>
    `;

    // Bind Parent Card Actions
    document.getElementById('btn-status-toggle').onclick = () => {
      const nextMap = {
        'todo': 'in-progress',
        'in-progress': 'completed',
        'completed': 'todo',
        'needs-review': 'completed'
      };
      setNodeStatus(nextMap[currentStatus] || 'todo');
    };

    document.getElementById('btn-parent-info').onclick = () => {
      openMarkdownModal(currentNode.relPath, 'info');
    };

    document.getElementById('btn-parent-notes').onclick = () => {
      openMarkdownModal(currentNode.relPath, 'notes');
    };

    const btnJumpCanonical = document.getElementById('btn-parent-shortcut-jump');
    if (btnJumpCanonical) {
      btnJumpCanonical.onclick = () => {
        navigateToNode(currentNode.canonicalRelPath);
      };
    }

    const btnFiles = document.getElementById('btn-parent-extra-files');
    if (btnFiles) {
      btnFiles.onclick = () => openExtraFilesModal(currentNode);
    }

    const btnRename = document.getElementById('btn-parent-rename');
    if (btnRename) btnRename.onclick = () => openRenameModal(currentNode.relPath);

    const btnMove = document.getElementById('btn-parent-move');
    if (btnMove) btnMove.onclick = () => openMoveModal(currentNode.relPath);

    const btnShare = document.getElementById('btn-parent-share');
    if (btnShare) btnShare.onclick = () => openShareModal(currentNode.relPath);

    const btnDelete = document.getElementById('btn-parent-delete');
    if (btnDelete) btnDelete.onclick = () => openDeleteModal(currentNode.relPath);

    // 2. Render Immediate Child Stations
    childrenAnchor.innerHTML = '';
    const children = currentNode.children || [];
    const childEls = [];

    children.forEach((child, index) => {
      const childStatus = child.status || 'todo';
      const branchBadge = child.hasChildren ? '<span class="child-branch-indicator" title="Contains sub-stations">⑂</span>' : '';
      const isChildShortcut = child.isShortcut || false;
      const shortcutIndicator = isChildShortcut ? `<span class="child-shortcut-indicator" title="Shortcut to ${child.canonicalRelPath || child.title}">↗</span>` : '';

      const nodeEl = document.createElement('div');
      nodeEl.className = `graph-child-node ${isChildShortcut ? 'is-shortcut' : ''} ${direction === 'forward' ? 'spawning' : ''}`;
      nodeEl.dataset.status = childStatus;
      nodeEl.dataset.id = child.id;

      const dotClass = childStatus === 'completed'
        ? 'completed'
        : (childStatus === 'in-progress'
          ? 'in-progress'
          : (childStatus === 'needs-review' ? 'needs-review' : 'todo'));

      nodeEl.innerHTML = `
        <span class="child-status-dot ${dotClass}"></span>
        <span class="child-index">${String(index + 1).padStart(2, '0')}</span>
        <span class="child-node-title" title="${child.title}">${child.title}</span>
        ${shortcutIndicator}
        ${branchBadge}
        <button class="btn-child-quick-info" title="Quick view info.md">ℹ️</button>
      `;

      // Quick Info Button opens info.md
      const quickBtn = nodeEl.querySelector('.btn-child-quick-info');
      if (quickBtn) {
        quickBtn.onclick = (e) => {
          e.stopPropagation();
          openMarkdownModal(child.relPath, 'info');
        };
      }

      // Clicking child drills down into it
      nodeEl.onclick = () => {
        historyStack.push({ id: child.id, relPath: child.relPath, title: child.title });
        loadNodeOnDemand(child.relPath, false, 'forward');
      };

      childrenAnchor.appendChild(nodeEl);
      childEls.push(nodeEl);
    });

    // 3. Render the '+' Button as a Child Station
    const addCardEl = document.createElement('div');
    addCardEl.className = 'graph-child-node btn-child-add-card';
    addCardEl.title = `Add child node under ${currentNode.title}`;
    addCardEl.dataset.status = 'todo';
    addCardEl.innerHTML = `
      <span class="child-add-plus-icon">+</span>
      ${children.length === 0 ? '<span style="font-size: 0.82rem; font-weight: 600; margin-left: 6px;">Add Child</span>' : ''}
    `;
    addCardEl.onclick = () => openAddChildModal(currentNode.relPath);

    childrenAnchor.appendChild(addCardEl);
    childEls.push(addCardEl);

    // Spawning animation
    if (direction === 'forward') {
      requestAnimationFrame(() => {
        childEls.forEach((el, i) => {
          setTimeout(() => {
            el.classList.remove('spawning');
            el.classList.add('spawned');
          }, i * 35);
        });
      });
    }

    setTimeout(() => {
      drawConnectorLines();
    }, direction === 'forward' ? (childEls.length * 35 + 80) : 20);
  }

  // ---------------------------------------------------------------------------
  // 6. Markdown Modal: info.md & notes.md
  // ---------------------------------------------------------------------------

  async function openMarkdownModal(relPath, docType = 'info') {
    const textarea = document.getElementById('md-textarea');
    if (textarea && activeModalNodeRelPath && textarea.value !== lastSavedContent) {
      await saveMarkdownToDisk();
    }

    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }

    activeModalNodeRelPath = relPath;
    activeDocType = docType;

    const overlay = document.getElementById('markdown-modal-overlay');
    const titleEl = document.getElementById('md-modal-title');
    const pathEl = document.getElementById('md-modal-path');
    const iconEl = document.getElementById('md-modal-icon');
    const previewEl = document.getElementById('md-rendered-view');

    const filename = docType === 'info' ? 'info.md' : 'notes.md';
    titleEl.textContent = `${filename}`;
    pathEl.textContent = `graph/${relPath ? relPath + '/' : ''}${filename}`;
    iconEl.textContent = docType === 'info' ? 'ℹ️' : '📝';

    updateDocSwitchTabs(docType);

    const stationModalActions = document.getElementById('station-modal-actions');
    if (stationModalActions) {
      stationModalActions.style.display = relPath ? 'inline-flex' : 'none';
    }

    let content = '';
    const cachedNode = nodeCache[relPath];
    if (cachedNode && cachedNode[docType]) {
      content = cachedNode[docType];
    } else {
      try {
        const res = await fetch(`/api/node?path=${encodeURIComponent(relPath)}`);
        if (res.ok) {
          const data = await res.json();
          nodeCache[relPath] = data;
          content = docType === 'info' ? (data.info || '') : (data.notes || '');
        }
      } catch (e) {
        console.warn(`Failed to load ${filename} from disk:`, e);
      }
    }

    if (!content) {
      const nodeTitle = cachedNode ? cachedNode.title : '';
      content = docType === 'info'
        ? `# ${nodeTitle}\n\n**Status:** todo\n\n`
        : `# ${nodeTitle} — Notes\n\n`;
    }

    textarea.value = content;
    lastSavedContent = content;
    setAutosaveStatus('saved');
    renderMarkdownContent(content, previewEl);
    switchEditorMode('preview');

    overlay.classList.add('open');
  }

  function closeMarkdownModal() {
    const textarea = document.getElementById('md-textarea');
    if (textarea && textarea.value !== lastSavedContent) {
      saveMarkdownToDisk();
    }
    document.getElementById('markdown-modal-overlay').classList.remove('open');
  }

  function updateDocSwitchTabs(docType) {
    const btnInfo = document.getElementById('btn-doc-info');
    const btnNotes = document.getElementById('btn-doc-notes');
    const btnExtract = document.getElementById('btn-doc-extract');
    if (!btnInfo || !btnNotes) return;

    if (docType === 'info') {
      btnInfo.classList.add('active');
      btnNotes.classList.remove('active');
    } else {
      btnNotes.classList.add('active');
      btnInfo.classList.remove('active');
    }

    if (btnExtract) {
      btnExtract.style.display = docType === 'notes' ? 'inline-flex' : 'none';
    }
  }

  function switchEditorMode(mode) {
    activeEditorMode = mode;
    const btnPreview = document.getElementById('btn-tab-preview');
    const btnEdit = document.getElementById('btn-tab-edit');
    const previewView = document.getElementById('md-rendered-view');
    const editorView = document.getElementById('md-editor-view');
    const textarea = document.getElementById('md-textarea');

    if (mode === 'edit') {
      btnEdit.classList.add('active');
      btnPreview.classList.remove('active');
      previewView.style.display = 'none';
      editorView.style.display = 'flex';
      textarea.focus();
    } else {
      btnPreview.classList.add('active');
      btnEdit.classList.remove('active');
      editorView.style.display = 'none';
      previewView.style.display = 'block';
      if (textarea.value !== lastSavedContent) {
        saveMarkdownToDisk();
      }
      renderMarkdownContent(textarea.value, previewView);
    }
  }

  function renderMarkdownContent(markdownText, targetEl) {
    let html = '';
    if (window.marked && typeof window.marked.parse === 'function') {
      html = window.marked.parse(markdownText);
    } else if (window.marked && typeof window.marked === 'function') {
      html = window.marked(markdownText);
    } else {
      html = `<pre style="white-space: pre-wrap;">${markdownText}</pre>`;
    }

    targetEl.innerHTML = html;
    targetEl.setAttribute('dir', 'auto');

    // Apply dir="auto" to block elements for bidirectional (BiDi) text alignment
    targetEl.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote').forEach(el => {
      if (!el.getAttribute('dir')) {
        el.setAttribute('dir', 'auto');
      }
    });

    if (window.renderMathInElement) {
      try {
        window.renderMathInElement(targetEl, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false },
            { left: '\\[', right: '\\]', display: true }
          ],
          throwOnError: false
        });
      } catch (err) {
        console.warn('KaTeX render error:', err);
      }
    }
  }

  function setAutosaveStatus(state) {
    const el = document.getElementById('autosave-status');
    const textEl = document.getElementById('autosave-text');
    if (!el || !textEl) return;

    el.classList.remove('saving', 'saved', 'error');

    if (state === 'saving') {
      el.classList.add('saving');
      textEl.textContent = 'Saving...';
    } else if (state === 'saved') {
      el.classList.add('saved');
      textEl.textContent = 'Saved';
    } else if (state === 'error') {
      el.classList.add('error');
      textEl.textContent = 'Save failed';
    }
  }

  function scheduleAutoSave() {
    const textarea = document.getElementById('md-textarea');
    if (!textarea) return;

    if (textarea.value === lastSavedContent) {
      setAutosaveStatus('saved');
      return;
    }

    setAutosaveStatus('saving');

    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }

    autoSaveTimer = setTimeout(() => {
      saveMarkdownToDisk();
    }, 600);
  }

  async function saveMarkdownToDisk() {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }

    const textarea = document.getElementById('md-textarea');
    if (!textarea) return;

    const content = textarea.value;
    const relPath = activeModalNodeRelPath;
    const docType = activeDocType;
    const filename = docType === 'info' ? 'info.md' : 'notes.md';
    const endpoint = docType === 'info' ? '/api/save-info' : '/api/save-notes';

    if (content === lastSavedContent && !isSavingMarkdown) {
      setAutosaveStatus('saved');
      return;
    }

    if (isSavingMarkdown) {
      scheduleAutoSave();
      return;
    }

    isSavingMarkdown = true;
    setAutosaveStatus('saving');

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: relPath, content: content, file: filename })
      });

      if (res.ok) {
        const data = await res.json();
        lastSavedContent = content;
        setAutosaveStatus('saved');

        if (data.node) {
          nodeCache[relPath] = data.node;
          if (currentNode && currentNode.relPath === relPath) {
            currentNode = data.node;
          }
        }

        if (docType === 'info') {
          loadNodeOnDemand(getCurrentRelPath(), true);
        }
      } else {
        setAutosaveStatus('error');
      }
    } catch (err) {
      console.warn('Auto-save error:', err);
      setAutosaveStatus('error');
    } finally {
      isSavingMarkdown = false;
      if (textarea && textarea.value !== lastSavedContent) {
        scheduleAutoSave();
      }
    }
  }

  function insertEditorFormatting(tool) {
    const textarea = document.getElementById('md-textarea');
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end);

    let replacement = '';
    switch (tool) {
      case 'bold':
        replacement = `**${selected || 'bold text'}**`;
        break;
      case 'code':
        replacement = selected.includes('\n') ? `\`\`\`python\n${selected || '# code'}\n\`\`\`` : `\`${selected || 'code'}\``;
        break;
      case 'math':
        replacement = selected ? `$${selected}$` : `$$\n\\mathcal{O}(N \\log N)\n$$`;
        break;
      case 'list':
        replacement = `\n- ${selected || 'Item'}\n`;
        break;
      case 'check':
        replacement = `\n- [ ] ${selected || 'Task milestone'}\n`;
        break;
    }

    textarea.setRangeText(replacement, start, end, 'end');
    textarea.focus();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ---------------------------------------------------------------------------
  // 7. Extra Files Modal
  // ---------------------------------------------------------------------------

  function openExtraFilesModal(node) {
    if (!node) return;
    const overlay = document.getElementById('extra-files-modal-overlay');
    const listContainer = document.getElementById('extra-files-list-container') || document.getElementById('extra-files-list');
    const nodeTitleLabel = document.getElementById('extra-files-node-label');

    nodeTitleLabel.textContent = `${node.title} (graph/${node.relPath || '(root)'})`;

    const files = node.extraFiles || [];

    if (files.length === 0) {
      listContainer.innerHTML = `
        <div style="font-size: 0.85rem; color: var(--text-muted); font-style: italic; padding: 12px 0;">
          No extra files in this folder. Drop PDFs, images, or cheatsheets here.
        </div>
      `;
    } else {
      listContainer.innerHTML = files.map(f => {
        const icon = getFileIcon(f.ext);
        const sizeStr = f.size ? formatBytes(f.size) : '';
        return `
          <a href="${f.url}" target="_blank" rel="noopener noreferrer" class="extra-file-item" title="Open ${f.label}">
            <div class="extra-file-left">
              <span class="extra-file-icon">${icon}</span>
              <span class="extra-file-name">${f.label}</span>
            </div>
            <div class="extra-file-right">
              <span class="extra-file-size">${sizeStr}</span>
              <span class="extra-file-tag">${f.ext || 'FILE'}</span>
            </div>
          </a>
        `;
      }).join('');
    }

    overlay.classList.add('open');
  }

  function closeExtraFilesModal() {
    document.getElementById('extra-files-modal-overlay').classList.remove('open');
  }

  function triggerExtraFileUpload() {
    const input = document.getElementById('extra-file-input');
    if (input) {
      input.value = '';
      input.click();
    }
  }

  async function handleExtraFileSelected(e) {
    const files = e.target.files;
    if (!files || files.length === 0 || !currentNode) return;

    const relPath = currentNode.relPath;

    for (const file of files) {
      const reader = new FileReader();
      reader.onload = async function (evt) {
        const base64Data = evt.target.result;

        try {
          const res = await fetch('/api/upload-extra-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              path: relPath,
              filename: file.name,
              content: base64Data
            })
          });

          if (res.ok) {
            await loadNodeOnDemand(relPath, true);
            openExtraFilesModal(currentNode);
          }
        } catch (err) {
          console.error('File upload error:', err);
        }
      };
      reader.readAsDataURL(file);
    }
  }

  // ---------------------------------------------------------------------------
  // 8. Add Child Station Modal
  // ---------------------------------------------------------------------------

  let activeAddChildType = 'new'; // 'new' | 'shortcut'

  async function openAddChildModal(parentRelPath) {
    targetAddChildParentId = parentRelPath !== undefined ? parentRelPath : getCurrentRelPath();
    const parentTitle = currentNode ? currentNode.title : '';

    document.getElementById('add-child-parent-label').textContent = parentTitle ? `Under: ${parentTitle} (graph/${targetAddChildParentId || '(root)'})` : '';

    const nameInput = document.getElementById('new-child-name');
    const statusEl = document.getElementById('add-child-status');
    const shortcutSelect = document.getElementById('shortcut-target-select');

    nameInput.value = '';
    statusEl.textContent = '';
    switchAddChildType('new');

    // Populate existing stations dropdown
    if (shortcutSelect) {
      shortcutSelect.innerHTML = '<option value="">Loading stations...</option>';
      try {
        const res = await fetch('/api/stations');
        if (res.ok) {
          const data = await res.json();
          const stations = data.stations || [];
          shortcutSelect.innerHTML = '<option value="">-- Select an existing station --</option>' +
            stations
              .filter(s => s.relPath !== targetAddChildParentId)
              .map(s => `<option value="${escapeHtml(s.relPath)}">${escapeHtml(s.title)} (${escapeHtml(s.relPath)})</option>`)
              .join('');
        }
      } catch (err) {
        shortcutSelect.innerHTML = '<option value="">Failed to load stations</option>';
      }
    }

    document.getElementById('add-child-modal-overlay').classList.add('open');
    setTimeout(() => nameInput.focus(), 60);
  }

  function switchAddChildType(type) {
    activeAddChildType = type;
    const btnNew = document.getElementById('btn-type-new-station');
    const btnSc = document.getElementById('btn-type-shortcut');
    const groupNew = document.getElementById('group-new-station-name');
    const groupSc = document.getElementById('group-shortcut-select');
    const nameInput = document.getElementById('new-child-name');
    const submitBtn = document.getElementById('btn-submit-add-child');

    if (type === 'shortcut') {
      if (btnNew) btnNew.classList.remove('active');
      if (btnSc) btnSc.classList.add('active');
      if (groupNew) groupNew.style.display = 'none';
      if (groupSc) groupSc.style.display = 'block';
      if (nameInput) nameInput.removeAttribute('required');
      if (submitBtn) submitBtn.textContent = 'Link Shortcut';
    } else {
      if (btnSc) btnSc.classList.remove('active');
      if (btnNew) btnNew.classList.add('active');
      if (groupSc) groupSc.style.display = 'none';
      if (groupNew) groupNew.style.display = 'block';
      if (nameInput) {
        nameInput.setAttribute('required', 'required');
        nameInput.focus();
      }
      if (submitBtn) submitBtn.textContent = 'Create Station';
    }
  }

  function closeAddChildModal() {
    document.getElementById('add-child-modal-overlay').classList.remove('open');
  }

  async function handleAddChildSubmit(e) {
    e.preventDefault();
    const statusEl = document.getElementById('add-child-status');
    const parentRel = targetAddChildParentId;

    if (activeAddChildType === 'shortcut') {
      const selectEl = document.getElementById('shortcut-target-select');
      const targetRel = selectEl ? selectEl.value : '';
      if (!targetRel) {
        statusEl.textContent = 'Please choose a target station to link';
        return;
      }
      const selectedOptionText = selectEl.options[selectEl.selectedIndex].text;
      const targetTitle = selectedOptionText.split(' (')[0] || '';

      statusEl.textContent = 'Creating shortcut on disk...';
      try {
        const res = await fetch('/api/add-child', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parentPath: parentRel,
            isShortcut: true,
            targetPath: targetRel,
            name: targetTitle
          })
        });

        if (res.ok) {
          closeAddChildModal();
          fullGraphTreeData = null;
          await loadNodeOnDemand(parentRel, true, 'forward');
          updateProgressStats();
        } else {
          const err = await res.json();
          statusEl.textContent = `Error: ${err.error || 'Failed to create shortcut'}`;
        }
      } catch (err) {
        statusEl.textContent = 'Error contacting disk server';
      }
      return;
    }

    // Normal station creation
    const name = document.getElementById('new-child-name').value.trim();
    if (!name) {
      statusEl.textContent = 'Please enter a station name';
      return;
    }

    statusEl.textContent = 'Creating station on disk...';
    try {
      const res = await fetch('/api/add-child', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentPath: parentRel,
          isShortcut: false,
          name: name
        })
      });

      if (res.ok) {
        closeAddChildModal();
        fullGraphTreeData = null;
        await loadNodeOnDemand(parentRel, true, 'forward');
        updateProgressStats();
      } else {
        const err = await res.json();
        statusEl.textContent = `Error: ${err.error || 'Failed to create station'}`;
      }
    } catch (err) {
      statusEl.textContent = 'Error contacting disk server';
    }
  }

  // ---------------------------------------------------------------------------
  // 8b. Station Management Modals (Rename, Move, Share, Delete)
  // ---------------------------------------------------------------------------

  let targetStationActionRelPath = '';

  function openRenameModal(relPath) {
    if (!relPath) return;
    targetStationActionRelPath = relPath;

    const overlay = document.getElementById('rename-modal-overlay');
    const contextEl = document.getElementById('rename-modal-context');
    const titleInput = document.getElementById('rename-title-input');
    const slugInput = document.getElementById('rename-slug-input');
    const statusEl = document.getElementById('rename-modal-status');

    statusEl.textContent = '';
    contextEl.textContent = `Path: graph/${relPath}`;

    let initialTitle = '';
    const initialSlug = relPath.split('/').pop();

    if (currentNode && currentNode.relPath === relPath) {
      initialTitle = currentNode.title || '';
    } else if (nodeCache[relPath]) {
      initialTitle = nodeCache[relPath].title || '';
    } else {
      initialTitle = initialSlug.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    titleInput.value = initialTitle;
    slugInput.value = initialSlug;

    let slugManuallyEdited = false;
    slugInput.oninput = () => {
      slugManuallyEdited = true;
    };
    titleInput.oninput = () => {
      if (!slugManuallyEdited) {
        slugInput.value = titleInput.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      }
    };

    overlay.classList.add('open');
    setTimeout(() => titleInput.focus(), 60);
  }

  function closeRenameModal() {
    const overlay = document.getElementById('rename-modal-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  async function handleRenameSubmit(e) {
    e.preventDefault();
    const statusEl = document.getElementById('rename-modal-status');
    const title = document.getElementById('rename-title-input').value.trim();
    const slug = document.getElementById('rename-slug-input').value.trim();

    if (!title && !slug) {
      statusEl.textContent = 'Please enter a valid title or slug';
      return;
    }

    statusEl.textContent = 'Renaming station on disk...';
    try {
      const res = await fetch('/api/rename-node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: targetStationActionRelPath,
          newTitle: title,
          newSlug: slug
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        closeRenameModal();
        fullGraphTreeData = null;
        nodeCache = {};

        const oldRel = targetStationActionRelPath;
        const newRel = data.newPath;

        if (activeModalNodeRelPath === oldRel) {
          activeModalNodeRelPath = newRel;
          const pathEl = document.getElementById('md-modal-path');
          if (pathEl) {
            const filename = activeDocType === 'info' ? 'info.md' : 'notes.md';
            pathEl.textContent = `graph/${newRel ? newRel + '/' : ''}${filename}`;
          }
        }

        const currentRel = getCurrentRelPath();
        if (currentRel === oldRel) {
          await loadNodeOnDemand(newRel, false, 'none');
        } else {
          await loadNodeOnDemand(currentRel, false, 'none');
        }
        updateProgressStats();
      } else {
        statusEl.textContent = `Error: ${data.error || 'Failed to rename station'}`;
      }
    } catch (err) {
      statusEl.textContent = 'Error contacting disk server';
    }
  }

  async function openMoveModal(relPath) {
    if (!relPath) return;
    targetStationActionRelPath = relPath;

    const overlay = document.getElementById('move-modal-overlay');
    const contextEl = document.getElementById('move-modal-context');
    const selectEl = document.getElementById('move-target-parent-select');
    const statusEl = document.getElementById('move-modal-status');

    statusEl.textContent = '';
    const nodeTitle = (currentNode && currentNode.relPath === relPath)
      ? currentNode.title
      : (nodeCache[relPath] ? nodeCache[relPath].title : relPath.split('/').pop());

    contextEl.textContent = `Moving: ${nodeTitle} (graph/${relPath})`;
    selectEl.innerHTML = '<option value="">Loading destinations...</option>';

    try {
      const res = await fetch('/api/stations');
      if (res.ok) {
        const data = await res.json();
        const stations = data.stations || [];

        const parts = relPath.split('/');
        parts.pop();
        const currentParent = parts.join('/');

        let optionsHtml = '';
        if (currentParent !== '') {
          optionsHtml += '<option value="">Root Hub (root)</option>';
        }

        const validStations = stations.filter(s => {
          if (s.relPath === relPath) return false;
          if (s.relPath.startsWith(relPath + '/')) return false;
          if (s.relPath === currentParent) return false;
          return true;
        });

        optionsHtml += validStations.map(s => {
          return `<option value="${escapeHtml(s.relPath)}">${escapeHtml(s.title)} (${escapeHtml(s.relPath)})</option>`;
        }).join('');

        if (!optionsHtml) {
          optionsHtml = '<option value="" disabled>No alternate destinations available</option>';
        }

        selectEl.innerHTML = optionsHtml;
      }
    } catch (e) {
      selectEl.innerHTML = '<option value="">Failed to load destinations</option>';
    }

    overlay.classList.add('open');
  }

  function closeMoveModal() {
    const overlay = document.getElementById('move-modal-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  async function handleMoveSubmit(e) {
    e.preventDefault();
    const statusEl = document.getElementById('move-modal-status');
    const selectEl = document.getElementById('move-target-parent-select');
    const newParent = selectEl.value;

    statusEl.textContent = 'Moving station on disk...';
    try {
      const res = await fetch('/api/move-node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourcePath: targetStationActionRelPath,
          newParentPath: newParent
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        closeMoveModal();
        closeMarkdownModal();
        fullGraphTreeData = null;
        nodeCache = {};

        await loadNodeOnDemand(data.newPath, false, 'forward');
        updateProgressStats();
      } else {
        statusEl.textContent = `Error: ${data.error || 'Failed to move station'}`;
      }
    } catch (err) {
      statusEl.textContent = 'Error contacting disk server';
    }
  }

  async function openShareModal(relPath) {
    if (!relPath) return;
    targetStationActionRelPath = relPath;

    const overlay = document.getElementById('share-modal-overlay');
    const contextEl = document.getElementById('share-modal-context');
    const selectEl = document.getElementById('share-target-parent-select');
    const nameInput = document.getElementById('share-shortcut-name-input');
    const statusEl = document.getElementById('share-modal-status');

    statusEl.textContent = '';
    const nodeTitle = (currentNode && currentNode.relPath === relPath)
      ? currentNode.title
      : (nodeCache[relPath] ? nodeCache[relPath].title : relPath.split('/').pop());

    contextEl.textContent = `Sharing: ${nodeTitle} (graph/${relPath})`;
    nameInput.value = nodeTitle;
    selectEl.innerHTML = '<option value="">Loading destinations...</option>';

    try {
      const res = await fetch('/api/stations');
      if (res.ok) {
        const data = await res.json();
        const stations = data.stations || [];

        let optionsHtml = '<option value="">Root Hub (root)</option>';
        optionsHtml += stations
          .filter(s => s.relPath !== relPath)
          .map(s => `<option value="${escapeHtml(s.relPath)}">${escapeHtml(s.title)} (${escapeHtml(s.relPath)})</option>`)
          .join('');

        selectEl.innerHTML = optionsHtml;
      }
    } catch (e) {
      selectEl.innerHTML = '<option value="">Failed to load destinations</option>';
    }

    overlay.classList.add('open');
    setTimeout(() => nameInput.focus(), 60);
  }

  function closeShareModal() {
    const overlay = document.getElementById('share-modal-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  async function handleShareSubmit(e) {
    e.preventDefault();
    const statusEl = document.getElementById('share-modal-status');
    const selectEl = document.getElementById('share-target-parent-select');
    const nameInput = document.getElementById('share-shortcut-name-input');

    const parentPath = selectEl.value;
    const name = nameInput.value.trim();

    statusEl.textContent = 'Creating shortcut link on disk...';
    try {
      const res = await fetch('/api/share-node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPath: targetStationActionRelPath,
          parentPath: parentPath,
          name: name
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        closeShareModal();
        fullGraphTreeData = null;

        const currentRel = getCurrentRelPath();
        if (currentRel === parentPath) {
          await loadNodeOnDemand(currentRel, true, 'forward');
        }
      } else {
        statusEl.textContent = `Error: ${data.error || 'Failed to create shortcut'}`;
      }
    } catch (err) {
      statusEl.textContent = 'Error contacting disk server';
    }
  }

  async function openDeleteModal(relPath) {
    if (!relPath) return;
    targetStationActionRelPath = relPath;

    const overlay = document.getElementById('delete-modal-overlay');
    const contextEl = document.getElementById('delete-modal-context');
    const warningBox = document.getElementById('delete-warning-box');
    const warningMsg = document.getElementById('delete-warning-message');
    const forceGroup = document.getElementById('delete-force-group');
    const forceCheckbox = document.getElementById('delete-force-checkbox');
    const forceLabel = document.getElementById('delete-force-label');
    const statusEl = document.getElementById('delete-modal-status');

    statusEl.textContent = '';
    forceCheckbox.checked = false;
    forceGroup.style.display = 'none';
    contextEl.textContent = `graph/${relPath}`;

    warningBox.className = 'modal-warning-card';
    warningMsg.innerHTML = 'Analyzing station contents...';
    overlay.classList.add('open');

    try {
      const res = await fetch(`/api/node?path=${encodeURIComponent(relPath)}`);
      if (res.ok) {
        const node = await res.json();
        const isShortcut = node.isShortcut || false;
        const childrenCount = (node.children && node.children.length) || 0;
        const filesCount = (node.extraFiles && node.extraFiles.length) || 0;

        if (isShortcut) {
          warningBox.className = 'modal-warning-card info';
          warningMsg.innerHTML = `
            <strong>↗ Deleting Shortcut Link</strong><br>
            This station is a shortcut pointing to <code>${escapeHtml(node.canonicalRelPath || 'canonical station')}</code>.<br>
            Only this shortcut pointer will be removed. The original canonical station and its notes will remain intact.
          `;
          forceGroup.style.display = 'none';
        } else {
          warningBox.className = 'modal-warning-card';
          let warningHtml = `
            <strong>⚠️ Permanently Delete Station</strong><br>
            Are you sure you want to delete <strong>${escapeHtml(node.title)}</strong>? This will permanently delete the folder on disk.
          `;

          if (childrenCount > 0 || filesCount > 0) {
            warningHtml += `<br><span style="margin-top: 4px; display: block;">⚠️ Contains <strong>${childrenCount} sub-station(s)</strong> and <strong>${filesCount} extra file(s)</strong>.</span>`;
            forceGroup.style.display = 'block';
            forceLabel.textContent = `I confirm permanent deletion of this station, its ${childrenCount} sub-station(s), and all files.`;
          }

          warningMsg.innerHTML = warningHtml;
        }
      }
    } catch (e) {
      warningMsg.textContent = 'Are you sure you want to delete this station from disk?';
    }
  }

  function closeDeleteModal() {
    const overlay = document.getElementById('delete-modal-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  async function handleDeleteSubmit(e) {
    e.preventDefault();
    const statusEl = document.getElementById('delete-modal-status');
    const forceCheckbox = document.getElementById('delete-force-checkbox');
    const warningBox = document.getElementById('delete-warning-box');
    const warningMsg = document.getElementById('delete-warning-message');
    const forceGroup = document.getElementById('delete-force-group');
    const forceLabel = document.getElementById('delete-force-label');

    const force = forceCheckbox ? forceCheckbox.checked : false;
    statusEl.textContent = 'Deleting station on disk...';

    try {
      const res = await fetch('/api/delete-node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: targetStationActionRelPath,
          force: force
        })
      });

      const data = await res.json();
      if (res.status === 409) {
        warningBox.className = 'modal-warning-card';
        const scCount = (data.referencingShortcuts && data.referencingShortcuts.length) || 0;
        let msg = `<strong>⚠️ Confirmation Required:</strong><br>${escapeHtml(data.error || 'Station contains dependent items.')}`;
        if (scCount > 0) {
          msg += `<br>Referenced by <strong>${scCount} active shortcut(s)</strong>: <code>${data.referencingShortcuts.slice(0, 3).map(escapeHtml).join(', ')}</code>`;
        }
        warningMsg.innerHTML = msg;
        forceGroup.style.display = 'block';
        forceLabel.textContent = 'I understand and confirm permanent deletion of this station and all dependent items.';
        statusEl.textContent = 'Please check the confirmation box and click Delete Station.';
        return;
      }

      if (res.ok && data.success) {
        closeDeleteModal();
        closeMarkdownModal();
        fullGraphTreeData = null;
        nodeCache = {};

        const parts = targetStationActionRelPath.split('/');
        parts.pop();
        const parentRel = parts.join('/');

        while (historyStack.length > 0 && historyStack[historyStack.length - 1].relPath.startsWith(targetStationActionRelPath)) {
          historyStack.pop();
        }

        await loadNodeOnDemand(parentRel, false, 'backward');
        updateProgressStats();
      } else {
        statusEl.textContent = `Error: ${data.error || 'Failed to delete station'}`;
      }
    } catch (err) {
      statusEl.textContent = 'Error contacting disk server';
    }
  }

  // ---------------------------------------------------------------------------
  // 8c. Consolidated Notes Extraction Modal (Pre-order DFS)
  // ---------------------------------------------------------------------------

  let currentExtractedData = null;

  async function openExtractModal(relPath = '') {
    const overlay = document.getElementById('extract-modal-overlay');
    const modalTitle = document.getElementById('extract-modal-title');
    const modalPath = document.getElementById('extract-modal-path');
    const statsBadge = document.getElementById('extract-stats-badge');
    const tocNav = document.getElementById('extract-toc-nav');
    const markdownBody = document.getElementById('extract-markdown-body');
    const loadingState = document.getElementById('extract-loading-state');
    const btnExtract = document.getElementById('btn-parent-extract');

    if (!overlay || !markdownBody) return;

    overlay.style.display = 'flex';
    setTimeout(() => overlay.classList.add('open'), 10);

    if (loadingState) loadingState.style.display = 'flex';
    markdownBody.innerHTML = '';
    if (tocNav) tocNav.innerHTML = '';
    if (btnExtract) btnExtract.disabled = true;

    try {
      const res = await fetch(`/api/extract-notes?path=${encodeURIComponent(relPath)}`, { cache: 'no-store' });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to extract notes');
      }

      const data = await res.json();
      currentExtractedData = data;

      if (modalTitle) modalTitle.textContent = `Consolidated Notes — ${data.rootTitle}`;
      if (modalPath) modalPath.textContent = data.relPath ? `Root: ${data.relPath}` : 'Entire Knowledge Graph';
      if (statsBadge) statsBadge.textContent = `${data.notesCount} with notes / ${data.stationCount} stations`;

      // Render Markdown content (with math & code)
      renderMarkdownContent(data.markdown, markdownBody);

      // Build Table of Contents
      if (tocNav && data.toc) {
        let tocHtml = '<ul class="extract-toc-list">';
        data.toc.forEach(item => {
          const depthClass = `toc-depth-${item.depth}`;
          const noteClass = item.hasNotes ? 'has-notes' : 'no-notes';
          tocHtml += `
            <li class="extract-toc-item ${depthClass} ${noteClass}">
              <a href="#${item.anchor}" class="extract-toc-link" title="${escapeHtml(item.title)}">
                <span class="toc-bullet">${item.hasNotes ? '•' : '○'}</span>
                <span class="toc-text">${escapeHtml(item.title)}</span>
              </a>
            </li>
          `;
        });
        tocHtml += '</ul>';
        tocNav.innerHTML = tocHtml;

        // Smooth scroll for TOC links
        tocNav.querySelectorAll('.extract-toc-link').forEach(link => {
          link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').slice(1);
            const targetAnchor = document.getElementById(targetId) || markdownBody.querySelector(`[id="${targetId}"]`);
            if (targetAnchor) {
              targetAnchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          });
        });
      }
    } catch (err) {
      console.error('Extraction error:', err);
      markdownBody.innerHTML = `<div style="color: #f85149; padding: 20px;">⚠️ Failed to extract study notes: ${escapeHtml(err.message)}</div>`;
    } finally {
      if (loadingState) loadingState.style.display = 'none';
      if (btnExtract) btnExtract.disabled = false;
    }
  }

  function closeExtractModal() {
    const overlay = document.getElementById('extract-modal-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 200);
    }
  }

  function downloadExtractedMarkdown() {
    if (!currentExtractedData || !currentExtractedData.markdown) return;
    const filename = `${(currentExtractedData.rootTitle || 'study-notes').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-notes.md`;
    const blob = new Blob([currentExtractedData.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------------------
  // 9. Utility Helpers
  // ---------------------------------------------------------------------------

  function getFileIcon(ext) {
    const map = {
      'pdf': '📑', 'png': '🖼️', 'jpg': '🖼️', 'jpeg': '🖼️',
      'svg': '🎨', 'py': '🐍', 'js': '📜', 'json': '📋',
      'md': '📝', 'txt': '📄', 'csv': '📊', 'sql': '🗄️'
    };
    return map[(ext || '').toLowerCase()] || '📄';
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // ---------------------------------------------------------------------------
  // 9. Deep Search Engine
  // ---------------------------------------------------------------------------

  let searchResults = [];
  let highlightedSearchIndex = -1;
  let searchDebounceTimer = null;

  function escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function highlightQueryText(text, query) {
    if (!text || !query) return escapeHtml(text);
    const escapedText = escapeHtml(text);
    const escapedQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return escapedText.replace(regex, '<mark class="search-highlight">$1</mark>');
  }

  function getSearchMatchIcon(matchType) {
    switch (matchType) {
      case 'title': return '🏷️';
      case 'info': return 'ℹ️';
      case 'notes': return '📝';
      case 'file': return '📁';
      default: return '📍';
    }
  }

  function renderSearchResultsList(query, results, total = 0) {
    const dropdown = document.getElementById('search-dropdown');
    const list = document.getElementById('search-results-list');
    if (!dropdown || !list) return;

    list.innerHTML = '';
    searchResults = results || [];
    highlightedSearchIndex = searchResults.length > 0 ? 0 : -1;

    if (!query || query.trim() === '') {
      dropdown.style.display = 'none';
      return;
    }

    if (searchResults.length === 0) {
      list.innerHTML = `
        <div class="search-empty-state">
          No stations, notes, or files found for "<strong>${escapeHtml(query)}</strong>"
        </div>
      `;
      dropdown.style.display = 'block';
      return;
    }

    searchResults.forEach((item, index) => {
      const itemEl = document.createElement('div');
      itemEl.className = `search-result-item ${index === highlightedSearchIndex ? 'highlighted' : ''}`;
      itemEl.dataset.index = String(index);

      const icon = getSearchMatchIcon(item.matchType);
      const highlightedTitle = highlightQueryText(item.title, query);
      const highlightedSnippet = highlightQueryText(item.snippet, query);
      const categoryText = escapeHtml(item.category || '');

      const typeBadgeClass = `type-${item.matchType}`;
      const typeLabel = item.matchType.toUpperCase();

      itemEl.innerHTML = `
        <div class="search-result-header">
          <div class="search-result-title-group">
            <span class="search-result-icon">${icon}</span>
            <span class="search-result-title">${highlightedTitle}</span>
            <span class="search-result-type-badge ${typeBadgeClass}">${typeLabel}</span>
          </div>
          <span class="search-result-category" title="${categoryText}">${categoryText}</span>
        </div>
        <div class="search-result-snippet">${highlightedSnippet}</div>
      `;

      itemEl.onmouseenter = () => {
        highlightedSearchIndex = index;
        updateHighlightedSearchResult();
      };

      itemEl.onclick = () => {
        selectSearchResult(item);
      };

      list.appendChild(itemEl);
    });

    if (total > searchResults.length) {
      const footerEl = document.createElement('div');
      footerEl.className = 'search-results-footer';
      footerEl.textContent = `Showing top ${searchResults.length} of ${total} matches`;
      list.appendChild(footerEl);
    }

    dropdown.style.display = 'block';
  }

  function updateHighlightedSearchResult() {
    const items = document.querySelectorAll('.search-result-item');
    items.forEach((item, idx) => {
      if (idx === highlightedSearchIndex) {
        item.classList.add('highlighted');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('highlighted');
      }
    });
  }

  function selectSearchResult(item) {
    if (!item) return;

    const dropdown = document.getElementById('search-dropdown');
    if (dropdown) dropdown.style.display = 'none';

    const input = document.getElementById('search-input');
    if (input) input.blur();

    navigateToNode(item.relPath, item.breadcrumbs);

    if (item.matchType === 'info') {
      setTimeout(() => openMarkdownModal(item.relPath, 'info'), 150);
    } else if (item.matchType === 'notes') {
      setTimeout(() => openMarkdownModal(item.relPath, 'notes'), 150);
    } else if (item.matchType === 'file') {
      setTimeout(() => {
        if (currentNode) openExtraFilesModal(currentNode);
      }, 150);
    }
  }

  function setupSearch() {
    const searchInput = document.getElementById('search-input');
    const searchDropdown = document.getElementById('search-dropdown');
    const btnClear = document.getElementById('btn-search-clear');
    const container = document.getElementById('search-container');

    if (!searchInput) return;

    searchInput.addEventListener('input', () => {
      const query = searchInput.value;
      if (btnClear) btnClear.style.display = query ? 'block' : 'none';

      clearTimeout(searchDebounceTimer);
      if (!query.trim()) {
        if (searchDropdown) searchDropdown.style.display = 'none';
        searchResults = [];
        return;
      }

      searchDebounceTimer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}&limit=30`, { cache: 'no-store' });
          if (res.ok) {
            const data = await res.json();
            renderSearchResultsList(query.trim(), data.results || [], data.total || 0);
          }
        } catch (e) {
          console.warn('Search query error:', e);
        }
      }, 150);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (searchResults.length > 0) {
          highlightedSearchIndex = (highlightedSearchIndex + 1) % searchResults.length;
          updateHighlightedSearchResult();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (searchResults.length > 0) {
          highlightedSearchIndex = (highlightedSearchIndex - 1 + searchResults.length) % searchResults.length;
          updateHighlightedSearchResult();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedSearchIndex >= 0 && searchResults[highlightedSearchIndex]) {
          selectSearchResult(searchResults[highlightedSearchIndex]);
        }
      } else if (e.key === 'Escape') {
        if (searchDropdown) searchDropdown.style.display = 'none';
        searchInput.blur();
      }
    });

    if (btnClear) {
      btnClear.onclick = () => {
        searchInput.value = '';
        btnClear.style.display = 'none';
        if (searchDropdown) searchDropdown.style.display = 'none';
        searchResults = [];
        searchInput.focus();
      };
    }

    document.addEventListener('click', (e) => {
      if (container && !container.contains(e.target)) {
        if (searchDropdown) searchDropdown.style.display = 'none';
      }
    });

    searchInput.addEventListener('focus', () => {
      if (searchInput.value.trim() && searchResults.length > 0) {
        if (searchDropdown) searchDropdown.style.display = 'block';
      }
    });

    document.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const isInput = activeTag === 'input' || activeTag === 'textarea' || document.activeElement.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      } else if (e.key === '/' && !isInput) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 10. Full Graph Overview Mode
  // ---------------------------------------------------------------------------

  let isFullGraphMode = false;
  let fullGraphTreeData = null;
  let fgPanX = 0;
  let fgPanY = 0;
  let fgScale = 1;
  let fgIsDragging = false;
  let fgDragStartX = 0;
  let fgDragStartY = 0;
  let fgLayoutNodes = [];
  let fgLayoutEdges = [];

  function toggleFullGraphMode(forceState = null) {
    const nextState = forceState !== null ? forceState : !isFullGraphMode;
    if (nextState === isFullGraphMode) return;

    isFullGraphMode = nextState;

    const btnToggle = document.getElementById('btn-toggle-view');
    const graphStage = document.getElementById('graph-stage');
    const fullGraphStage = document.getElementById('full-graph-stage');

    if (isFullGraphMode) {
      if (btnToggle) {
        btnToggle.classList.add('active');
        btnToggle.innerHTML = '<span class="view-toggle-icon">🎯</span><span class="view-toggle-label">Focused View</span>';
        btnToggle.title = 'Return to Focused Stage View';
      }
      if (graphStage) graphStage.style.display = 'none';
      if (fullGraphStage) fullGraphStage.style.display = 'flex';

      loadAndRenderFullGraph(true);
    } else {
      if (btnToggle) {
        btnToggle.classList.remove('active');
        btnToggle.innerHTML = '<span class="view-toggle-icon">🌐</span><span class="view-toggle-label">Full Graph</span>';
        btnToggle.title = 'Toggle Full Graph Overview Mode';
      }
      if (fullGraphStage) fullGraphStage.style.display = 'none';
      if (graphStage) graphStage.style.display = 'flex';
      renderCurrentView();
      requestAnimationFrame(drawConnectorLines);
      if (currentRecommendedNode) {
        updateNextNodeRecommendation(getCurrentRelPath());
      }
    }
  }

  async function loadAndRenderFullGraph(recomputeFit = false) {
    try {
      const res = await fetch('/api/full-graph', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        fullGraphTreeData = data.tree;
      }
    } catch (err) {
      console.warn('Failed to fetch full graph hierarchy:', err);
    }

    if (!fullGraphTreeData) return;

    computeTreeLayout(fullGraphTreeData);
    renderFullGraphSvg(fullGraphTreeData);

    if (recomputeFit) {
      requestAnimationFrame(() => fitFullGraphToViewport());
    } else {
      updateFullGraphTransform();
    }
  }

  function computeTreeLayout(root) {
    fgLayoutNodes = [];
    fgLayoutEdges = [];

    const CARD_WIDTH = 190;
    const CARD_HEIGHT = 42;
    const ROOT_WIDTH = 170;
    const ROOT_HEIGHT = 46;
    const GAP_X = 75;
    const GAP_Y = 16;

    // 1. Post-order traversal: compute subtree heights
    function calcHeight(node) {
      const children = node.children || [];
      if (children.length === 0) {
        node._h = CARD_HEIGHT + GAP_Y;
        return node._h;
      }
      let sum = 0;
      for (const child of children) {
        sum += calcHeight(child);
      }
      node._h = Math.max(CARD_HEIGHT + GAP_Y, sum);
      return node._h;
    }

    calcHeight(root);

    // 2. Pre-order traversal: assign (x, y) coordinates
    function assignPositions(node, depth, yStart, parent) {
      const isRoot = depth === 0;
      const w = isRoot ? ROOT_WIDTH : CARD_WIDTH;
      const h = isRoot ? ROOT_HEIGHT : CARD_HEIGHT;
      const x = depth * (CARD_WIDTH + GAP_X) + 40;

      const children = node.children || [];
      let y;

      if (children.length === 0) {
        y = yStart + (node._h - h) / 2;
      } else {
        let currY = yStart;
        for (const child of children) {
          assignPositions(child, depth + 1, currY, node);
          currY += child._h;
        }
        const firstY = children[0]._y;
        const lastY = children[children.length - 1]._y;
        y = (firstY + lastY) / 2;
      }

      node._x = x;
      node._y = y;
      node._w = w;
      node._hActual = h;
      node._depth = depth;
      node._parent = parent;

      fgLayoutNodes.push(node);

      if (parent) {
        fgLayoutEdges.push({
          from: parent,
          to: node,
          status: node.status || 'todo'
        });
      }
    }

    assignPositions(root, 0, 40, null);
  }

  function renderFullGraphSvg(root) {
    const edgesGroup = document.getElementById('full-graph-edges');
    const nodesGroup = document.getElementById('full-graph-nodes');
    if (!edgesGroup || !nodesGroup) return;

    edgesGroup.innerHTML = '';
    nodesGroup.innerHTML = '';

    const currentRel = getCurrentRelPath();

    // 1. Render Bezier Connecting Edges
    let edgesHtml = '';
    fgLayoutEdges.forEach((edge, idx) => {
      const x1 = edge.from._x + edge.from._w;
      const y1 = edge.from._y + edge.from._hActual / 2;
      const x2 = edge.to._x;
      const y2 = edge.to._y + edge.to._hActual / 2;
      const dx = x2 - x1;
      const cx1 = x1 + dx * 0.5;
      const cx2 = x2 - dx * 0.5;

      const pathData = `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${cx1.toFixed(1)} ${y1.toFixed(1)}, ${cx2.toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
      const edgeId = `fg-edge-${idx}`;

      edgesHtml += `<path id="${edgeId}" class="fg-edge status-${edge.status}" data-from="${edge.from.relPath}" data-to="${edge.to.relPath}" d="${pathData}" />`;
    });
    edgesGroup.innerHTML = edgesHtml;

    // 2. Render Node Cards
    const frag = document.createDocumentFragment();

    fgLayoutNodes.forEach((node) => {
      const isRoot = node._depth === 0;
      const isCurrent = (node.relPath === currentRel);
      const isShortcut = node.isShortcut || false;
      const hasChildren = node.hasChildren;
      const status = node.status || 'todo';

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', `fg-node ${status} ${isRoot ? 'is-root' : ''} ${isCurrent ? 'is-current' : ''} ${isShortcut ? 'is-shortcut' : ''} ${hasChildren ? 'is-hub' : 'is-leaf'}`);
      g.setAttribute('transform', `translate(${node._x.toFixed(1)}, ${node._y.toFixed(1)})`);
      g.dataset.relpath = node.relPath;

      // Truncate title if needed
      const maxChars = isShortcut ? 12 : (hasChildren ? 14 : 17);
      let displayTitle = node.title || (isRoot ? 'Knowledge Graph' : node.id);
      if (displayTitle.length > maxChars) {
        displayTitle = displayTitle.slice(0, maxChars - 1) + '…';
      }

      // Hub badge, Leaf badge, or Shortcut indicator
      let badgeHtml = '';
      if (isShortcut) {
        badgeHtml = `<text class="fg-shortcut-indicator" x="${node._w - 10}" y="${node._hActual / 2 + 4}" text-anchor="end" title="Shortcut to ${node.canonicalRelPath}">↗</text>`;
      } else if (hasChildren) {
        badgeHtml = `<text class="fg-hub-indicator" x="${node._w - 12}" y="${node._hActual / 2 + 4}" text-anchor="end">⑂ ${node.childCount || ''}</text>`;
      } else if (node.badge) {
        let bText = node.badge;
        if (bText.length > 8) bText = bText.slice(0, 7) + '…';
        badgeHtml = `<text class="fg-node-badge" x="${node._w - 10}" y="${node._hActual / 2 + 3}" text-anchor="end">${escapeHtml(bText)}</text>`;
      }

      const activeIndicatorHtml = isCurrent
        ? `<text class="fg-current-indicator" x="${node._w - (hasChildren || isShortcut ? 38 : 10)}" y="11" text-anchor="end">CURRENT</text>`
        : '';

      const tooltipText = `${node.title}\nPath: ${node.relPath || 'Root'}${isShortcut ? '\nShortcut to: ' + node.canonicalRelPath : ''}\nStatus: ${status}\n${hasChildren ? (node.childCount + ' sub-stations (' + (node.totalDescendants || 0) + ' total)') : 'Leaf Station'}`;

      g.innerHTML = `
        <title>${escapeHtml(tooltipText)}</title>
        <rect class="fg-node-card" width="${node._w}" height="${node._hActual}" rx="8" ry="8"></rect>
        <circle class="fg-status-dot ${status}" cx="14" cy="${node._hActual / 2}" r="4"></circle>
        <text class="fg-node-title" x="25" y="${node._hActual / 2 + 4}">${escapeHtml(displayTitle)}</text>
        ${badgeHtml}
        ${activeIndicatorHtml}
      `;

      // Hover: highlight connecting edges
      g.onmouseenter = () => {
        const relatedEdges = edgesGroup.querySelectorAll(`[data-from="${node.relPath}"], [data-to="${node.relPath}"]`);
        relatedEdges.forEach(e => e.classList.add('highlight'));
      };
      g.onmouseleave = () => {
        const highlighted = edgesGroup.querySelectorAll('.highlight');
        highlighted.forEach(e => e.classList.remove('highlight'));
      };

      // Click: jump to station in focused stage
      g.onclick = (e) => {
        e.stopPropagation();
        navigateToNode(node.relPath);
        toggleFullGraphMode(false);
      };

      frag.appendChild(g);
    });

    nodesGroup.appendChild(frag);
  }

  function updateFullGraphTransform() {
    const canvas = document.getElementById('full-graph-canvas');
    if (canvas) {
      canvas.setAttribute('transform', `translate(${fgPanX.toFixed(1)}, ${fgPanY.toFixed(1)}) scale(${fgScale.toFixed(3)})`);
    }
  }

  function fitFullGraphToViewport() {
    const viewport = document.getElementById('full-graph-viewport');
    if (!viewport || fgLayoutNodes.length === 0) return;

    const vWidth = viewport.clientWidth || window.innerWidth;
    const vHeight = viewport.clientHeight || (window.innerHeight - 48);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    fgLayoutNodes.forEach(node => {
      if (node._x < minX) minX = node._x;
      if (node._y < minY) minY = node._y;
      if (node._x + node._w > maxX) maxX = node._x + node._w;
      if (node._y + node._hActual > maxY) maxY = node._y + node._hActual;
    });

    const graphWidth = maxX - minX + 80;
    const graphHeight = maxY - minY + 80;

    const scaleX = (vWidth - 80) / graphWidth;
    const scaleY = (vHeight - 80) / graphHeight;
    let s = Math.min(scaleX, scaleY, 1.0);
    s = Math.max(0.2, Math.min(s, 1.2));

    fgScale = s;
    fgPanX = (vWidth - graphWidth * s) / 2 - minX * s + 40 * s;
    fgPanY = (vHeight - graphHeight * s) / 2 - minY * s + 40 * s;

    updateFullGraphTransform();
  }

  function zoomFullGraph(factor, centerX = null, centerY = null) {
    const viewport = document.getElementById('full-graph-viewport');
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    const cx = centerX !== null ? (centerX - rect.left) : (rect.width / 2);
    const cy = centerY !== null ? (centerY - rect.top) : (rect.height / 2);

    const oldScale = fgScale;
    let newScale = oldScale * factor;
    newScale = Math.max(0.15, Math.min(newScale, 2.8));

    fgPanX = cx - (cx - fgPanX) * (newScale / oldScale);
    fgPanY = cy - (cy - fgPanY) * (newScale / oldScale);
    fgScale = newScale;

    updateFullGraphTransform();
  }

  function setupFullGraphInteractions() {
    const viewport = document.getElementById('full-graph-viewport');
    if (!viewport) return;

    // 1. Mouse Drag Panning
    viewport.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      fgIsDragging = true;
      fgDragStartX = e.clientX - fgPanX;
      fgDragStartY = e.clientY - fgPanY;
      viewport.classList.add('is-panning');
    });

    window.addEventListener('mousemove', (e) => {
      if (!fgIsDragging) return;
      fgPanX = e.clientX - fgDragStartX;
      fgPanY = e.clientY - fgDragStartY;
      updateFullGraphTransform();
    });

    window.addEventListener('mouseup', () => {
      if (fgIsDragging) {
        fgIsDragging = false;
        viewport.classList.remove('is-panning');
      }
    });

    // 2. Mouse Wheel Zooming
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      zoomFullGraph(factor, e.clientX, e.clientY);
    }, { passive: false });

    // 3. Toolbar Buttons
    const btnZoomIn = document.getElementById('btn-fg-zoom-in');
    if (btnZoomIn) btnZoomIn.onclick = () => zoomFullGraph(1.2);

    const btnZoomOut = document.getElementById('btn-fg-zoom-out');
    if (btnZoomOut) btnZoomOut.onclick = () => zoomFullGraph(1 / 1.2);

    const btnReset = document.getElementById('btn-fg-reset');
    if (btnReset) btnReset.onclick = () => fitFullGraphToViewport();

    const btnClose = document.getElementById('btn-fg-close');
    if (btnClose) btnClose.onclick = () => toggleFullGraphMode(false);

    // 4. Header Toggle Button
    const btnToggle = document.getElementById('btn-toggle-view');
    if (btnToggle) btnToggle.onclick = () => toggleFullGraphMode();

    // 5. Escape Key to Exit Full Graph
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isFullGraphMode) {
        const mdOverlay = document.getElementById('markdown-modal-overlay');
        const extraOverlay = document.getElementById('extra-files-modal-overlay');
        const addOverlay = document.getElementById('add-child-modal-overlay');
        const isModalOpen = (mdOverlay && mdOverlay.classList.contains('open')) ||
                            (extraOverlay && extraOverlay.classList.contains('open')) ||
                            (addOverlay && addOverlay.classList.contains('open'));
        if (!isModalOpen) {
          toggleFullGraphMode(false);
        }
      }
    });

    // 6. Window Resize
    window.addEventListener('resize', () => {
      if (isFullGraphMode) {
        requestAnimationFrame(() => fitFullGraphToViewport());
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 11. Event Listeners & Bootstrapping
  // ---------------------------------------------------------------------------

  function setupEventListeners() {
    setupSearch();
    setupFullGraphInteractions();
    const logo = document.getElementById('logo');
    if (logo) {
      logo.onclick = () => {
        if (historyStack.length > 1) {
          const rootTitle = (nodeCache[''] && nodeCache[''].title) || historyStack[0].title || '';
          historyStack = [{ id: 'root', relPath: '', title: rootTitle }];
          loadNodeOnDemand('', false, 'back');
        }
      };
    }

    // Auto-save on textarea input and blur
    const mdTextarea = document.getElementById('md-textarea');
    if (mdTextarea) {
      mdTextarea.addEventListener('input', scheduleAutoSave);
      mdTextarea.addEventListener('blur', () => {
        if (mdTextarea.value !== lastSavedContent) {
          saveMarkdownToDisk();
        }
      });
    }

    // Modal controls: info.md & notes.md
    const btnCloseMd = document.getElementById('btn-close-markdown');
    if (btnCloseMd) btnCloseMd.onclick = closeMarkdownModal;

    const mdOverlay = document.getElementById('markdown-modal-overlay');
    if (mdOverlay) {
      mdOverlay.onclick = (e) => {
        if (e.target.id === 'markdown-modal-overlay') closeMarkdownModal();
      };
    }

    // Document switcher tabs
    const btnDocInfo = document.getElementById('btn-doc-info');
    if (btnDocInfo) {
      btnDocInfo.onclick = () => openMarkdownModal(activeModalNodeRelPath, 'info');
    }

    const btnDocNotes = document.getElementById('btn-doc-notes');
    if (btnDocNotes) {
      btnDocNotes.onclick = () => openMarkdownModal(activeModalNodeRelPath, 'notes');
    }

    // Mode tabs: Rendered vs Edit
    const btnTabPrev = document.getElementById('btn-tab-preview');
    if (btnTabPrev) btnTabPrev.onclick = () => switchEditorMode('preview');

    const btnTabEdit = document.getElementById('btn-tab-edit');
    if (btnTabEdit) btnTabEdit.onclick = () => switchEditorMode('edit');

    const btnSaveMd = document.getElementById('btn-save-markdown');
    if (btnSaveMd) btnSaveMd.onclick = saveMarkdownToDisk;

    // Window beforeunload auto-save flush
    window.addEventListener('beforeunload', () => {
      const textarea = document.getElementById('md-textarea');
      if (textarea && textarea.value !== lastSavedContent && activeModalNodeRelPath) {
        const filename = activeDocType === 'info' ? 'info.md' : 'notes.md';
        const endpoint = activeDocType === 'info' ? '/api/save-info' : '/api/save-notes';
        const payload = JSON.stringify({ path: activeModalNodeRelPath, content: textarea.value, file: filename });
        try {
          fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true
          });
        } catch (e) {}
      }
    });

    // Formatting tools
    document.querySelectorAll('.btn-tool').forEach(btn => {
      btn.onclick = () => insertEditorFormatting(btn.getAttribute('data-tool'));
    });

    // Extra Files Modal Controls
    const btnCloseExtra = document.getElementById('btn-close-extra-files');
    if (btnCloseExtra) btnCloseExtra.onclick = closeExtraFilesModal;

    const btnDoneExtra = document.getElementById('btn-done-extra-files');
    if (btnDoneExtra) btnDoneExtra.onclick = closeExtraFilesModal;

    const overlayExtra = document.getElementById('extra-files-modal-overlay');
    if (overlayExtra) {
      overlayExtra.onclick = (e) => {
        if (e.target.id === 'extra-files-modal-overlay') closeExtraFilesModal();
      };
    }

    const btnUploadExtraCard = document.getElementById('btn-upload-extra-file-card');
    if (btnUploadExtraCard) btnUploadExtraCard.onclick = triggerExtraFileUpload;

    const fileInput = document.getElementById('extra-file-input');
    if (fileInput) fileInput.onchange = handleExtraFileSelected;

    // Add Child Modal Controls
    const btnTypeNew = document.getElementById('btn-type-new-station');
    if (btnTypeNew) btnTypeNew.onclick = () => switchAddChildType('new');

    const btnTypeSc = document.getElementById('btn-type-shortcut');
    if (btnTypeSc) btnTypeSc.onclick = () => switchAddChildType('shortcut');

    const btnCloseAddChild = document.getElementById('btn-close-add-child');
    if (btnCloseAddChild) btnCloseAddChild.onclick = closeAddChildModal;

    const btnCancelAddChild = document.getElementById('btn-cancel-add-child');
    if (btnCancelAddChild) btnCancelAddChild.onclick = closeAddChildModal;

    const formAddChild = document.getElementById('form-add-child');
    if (formAddChild) formAddChild.onsubmit = handleAddChildSubmit;

    const overlayAddChild = document.getElementById('add-child-modal-overlay');
    if (overlayAddChild) {
      overlayAddChild.onclick = (e) => {
        if (e.target.id === 'add-child-modal-overlay') closeAddChildModal();
      };
    }

    // Next Learning Node Recommendation Pill & Banner
    const nextPill = document.getElementById('next-node-pill');
    if (nextPill) {
      nextPill.onclick = () => {
        if (currentRecommendedNode) {
          if (currentRecommendedNode.relPath !== getCurrentRelPath()) {
            navigateToNode(currentRecommendedNode.relPath, currentRecommendedNode.breadcrumbs);
          } else {
            openMarkdownModal(currentRecommendedNode.relPath, 'info');
          }
        }
      };
    }

    // Extract Modal Controls
    const btnDocExtract = document.getElementById('btn-doc-extract');
    if (btnDocExtract) {
      btnDocExtract.onclick = () => {
        openExtractModal(activeModalNodeRelPath || (currentNode && currentNode.relPath) || '');
      };
    }

    const btnExtractClose = document.getElementById('btn-extract-close');
    if (btnExtractClose) btnExtractClose.onclick = closeExtractModal;

    const btnExtractPdf = document.getElementById('btn-extract-pdf');
    if (btnExtractPdf) btnExtractPdf.onclick = () => window.print();

    const btnExtractMd = document.getElementById('btn-extract-markdown');
    if (btnExtractMd) btnExtractMd.onclick = downloadExtractedMarkdown;

    const extractOverlay = document.getElementById('extract-modal-overlay');
    if (extractOverlay) {
      extractOverlay.onclick = (e) => {
        if (e.target.id === 'extract-modal-overlay') closeExtractModal();
      };
    }

    // Station Management Header Actions (in Markdown modal)
    const btnModalRename = document.getElementById('btn-modal-rename-station');
    if (btnModalRename) {
      btnModalRename.onclick = () => {
        if (activeModalNodeRelPath) openRenameModal(activeModalNodeRelPath);
      };
    }

    const btnModalMove = document.getElementById('btn-modal-move-station');
    if (btnModalMove) {
      btnModalMove.onclick = () => {
        if (activeModalNodeRelPath) openMoveModal(activeModalNodeRelPath);
      };
    }

    const btnModalShare = document.getElementById('btn-modal-share-station');
    if (btnModalShare) {
      btnModalShare.onclick = () => {
        if (activeModalNodeRelPath) openShareModal(activeModalNodeRelPath);
      };
    }

    const btnModalDelete = document.getElementById('btn-modal-delete-station');
    if (btnModalDelete) {
      btnModalDelete.onclick = () => {
        if (activeModalNodeRelPath) openDeleteModal(activeModalNodeRelPath);
      };
    }

    // Rename Modal Controls
    const btnCloseRename = document.getElementById('btn-close-rename');
    if (btnCloseRename) btnCloseRename.onclick = closeRenameModal;

    const btnCancelRename = document.getElementById('btn-cancel-rename');
    if (btnCancelRename) btnCancelRename.onclick = closeRenameModal;

    const formRename = document.getElementById('form-rename-station');
    if (formRename) formRename.onsubmit = handleRenameSubmit;

    const overlayRename = document.getElementById('rename-modal-overlay');
    if (overlayRename) {
      overlayRename.onclick = (e) => {
        if (e.target.id === 'rename-modal-overlay') closeRenameModal();
      };
    }

    // Move Modal Controls
    const btnCloseMove = document.getElementById('btn-close-move');
    if (btnCloseMove) btnCloseMove.onclick = closeMoveModal;

    const btnCancelMove = document.getElementById('btn-cancel-move');
    if (btnCancelMove) btnCancelMove.onclick = closeMoveModal;

    const formMove = document.getElementById('form-move-station');
    if (formMove) formMove.onsubmit = handleMoveSubmit;

    const overlayMove = document.getElementById('move-modal-overlay');
    if (overlayMove) {
      overlayMove.onclick = (e) => {
        if (e.target.id === 'move-modal-overlay') closeMoveModal();
      };
    }

    // Share Modal Controls
    const btnCloseShare = document.getElementById('btn-close-share');
    if (btnCloseShare) btnCloseShare.onclick = closeShareModal;

    const btnCancelShare = document.getElementById('btn-cancel-share');
    if (btnCancelShare) btnCancelShare.onclick = closeShareModal;

    const formShare = document.getElementById('form-share-station');
    if (formShare) formShare.onsubmit = handleShareSubmit;

    const overlayShare = document.getElementById('share-modal-overlay');
    if (overlayShare) {
      overlayShare.onclick = (e) => {
        if (e.target.id === 'share-modal-overlay') closeShareModal();
      };
    }

    // Delete Modal Controls
    const btnCloseDelete = document.getElementById('btn-close-delete');
    if (btnCloseDelete) btnCloseDelete.onclick = closeDeleteModal;

    const btnCancelDelete = document.getElementById('btn-cancel-delete');
    if (btnCancelDelete) btnCancelDelete.onclick = closeDeleteModal;

    const formDelete = document.getElementById('form-delete-station');
    if (formDelete) formDelete.onsubmit = handleDeleteSubmit;

    const overlayDelete = document.getElementById('delete-modal-overlay');
    if (overlayDelete) {
      overlayDelete.onclick = (e) => {
        if (e.target.id === 'delete-modal-overlay') closeDeleteModal();
      };
    }

    // Keyboard Shortcuts (Ctrl+S / Cmd+S, Escape)
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        const modal = document.getElementById('markdown-modal-overlay');
        if (modal && modal.classList.contains('open')) {
          e.preventDefault();
          saveMarkdownToDisk();
        }
      } else if (e.key === 'Escape') {
        closeMarkdownModal();
        closeExtractModal();
        closeAddChildModal();
        closeExtraFilesModal();
        closeRenameModal();
        closeMoveModal();
        closeShareModal();
        closeDeleteModal();
      }
    });
  }

  async function init() {
    setupEventListeners();
    await loadNodeOnDemand('', false);
    updateProgressStats();
    updateNextNodeRecommendation('');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
