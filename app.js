/**
 * Career Knowledge Graph Engine
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
        if (progressPill) progressPill.title = `${data.completed}/${data.total} Completed (${percent}%)`;
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
    const nextBanner = document.getElementById('next-node-banner');
    const bannerKicker = document.getElementById('next-banner-kicker');
    const bannerTitle = document.getElementById('next-banner-title');
    const bannerCategory = document.getElementById('next-banner-category');
    const bannerJumpBtn = document.getElementById('btn-next-banner-jump');

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
        nextPill.classList.remove('is-completed');
        if (isCurrent) {
          nextPill.classList.add('is-current');
          nextLabel.textContent = 'Current:';
          nextPill.title = `Current Focus: ${node.title} (${node.category}) — click to view info.md`;
        } else {
          nextPill.classList.remove('is-current');
          nextLabel.textContent = 'Next:';
          nextPill.title = `Next to Learn: ${node.title} in ${node.category} — click to jump`;
        }
        nextTitle.textContent = node.title;

        if (nextBanner) {
          nextBanner.style.display = 'flex';
          nextBanner.classList.remove('all-completed');
          if (isCurrent) {
            bannerKicker.textContent = '🎯 CURRENT LEARNING STATION';
            bannerTitle.textContent = node.title;
            bannerCategory.textContent = `in ${node.category} • Complete checkpoints in info.md`;
            if (bannerJumpBtn) bannerJumpBtn.style.display = 'none';
          } else {
            bannerKicker.textContent = '🎯 RECOMMENDED NEXT STATION';
            bannerTitle.textContent = node.title;
            bannerCategory.textContent = `in ${node.category}`;
            if (bannerJumpBtn) {
              bannerJumpBtn.style.display = 'inline-flex';
              bannerJumpBtn.innerHTML = `<span>Go to Station</span> →`;
            }
          }
        }
      } else if (data.allCompleted) {
        currentRecommendedNode = null;
        nextPill.style.display = 'inline-flex';
        nextPill.classList.remove('is-current');
        nextPill.classList.add('is-completed');
        nextLabel.textContent = 'Status:';
        nextTitle.textContent = 'Completed 🎉';
        nextPill.title = 'All stations in this section are completed!';

        if (nextBanner) {
          nextBanner.style.display = 'flex';
          nextBanner.classList.add('all-completed');
          bannerKicker.textContent = '🎉 ALL CAUGHT UP';
          bannerTitle.textContent = 'All stations completed!';
          bannerCategory.textContent = 'Great work! All stations in this section are marked done.';
          if (bannerJumpBtn) bannerJumpBtn.style.display = 'none';
        }
      } else {
        nextPill.style.display = 'none';
        if (nextBanner) nextBanner.style.display = 'none';
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
    // Extra files badge & button visibility rule:
    // Only display the Extra Files button if extra files actually exist in this station's folder.
    const extraFilesCount = (currentNode.extraFiles && currentNode.extraFiles.length) || 0;
    const extraFilesBtnHtml = extraFilesCount > 0
      ? `<button class="btn-graph-action btn-graph-files" id="btn-parent-extra-files" title="View ${extraFilesCount} extra files">📁 Extra Files (${extraFilesCount})</button>`
      : '';

    // 1. Render Parent Node Card
    parentAnchor.innerHTML = `
      <div class="graph-parent-card">
        <div class="graph-parent-top-row">
          <button class="btn-status-cycle status-${currentStatus}" id="btn-status-toggle" title="Cycle status: To Do → In Progress → Done">
            ${currentStatus === 'completed' ? '● Done' : (currentStatus === 'in-progress' ? '◐ In Progress' : '○ To Do')}
          </button>
          ${badgeText ? `<span style="font-size: 0.72rem; color: var(--accent-blue); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">${badgeText}</span>` : ''}
        </div>
        <div class="graph-parent-title">${currentNode.title}</div>
        <div class="graph-parent-actions">
          <button class="btn-graph-action btn-graph-info" id="btn-parent-info" title="View & edit info.md">ℹ️ Info</button>
          <button class="btn-graph-action btn-graph-notes" id="btn-parent-notes" title="View & edit notes.md">📝 Notes</button>
          ${extraFilesBtnHtml}
        </div>
      </div>
    `;

    // Bind Parent Card Actions
    document.getElementById('btn-status-toggle').onclick = () => {
      const nextMap = { 'todo': 'in-progress', 'in-progress': 'completed', 'completed': 'todo' };
      setNodeStatus(nextMap[currentStatus] || 'todo');
    };

    document.getElementById('btn-parent-info').onclick = () => {
      openMarkdownModal(currentNode.relPath, 'info');
    };

    document.getElementById('btn-parent-notes').onclick = () => {
      openMarkdownModal(currentNode.relPath, 'notes');
    };

    const btnFiles = document.getElementById('btn-parent-extra-files');
    if (btnFiles) {
      btnFiles.onclick = () => openExtraFilesModal(currentNode);
    }

    // 2. Render Immediate Child Stations
    childrenAnchor.innerHTML = '';
    const children = currentNode.children || [];
    const childEls = [];

    children.forEach((child, index) => {
      const childStatus = child.status || 'todo';
      const branchBadge = child.hasChildren ? '<span class="child-branch-indicator" title="Contains sub-stations">⑂</span>' : '';

      const nodeEl = document.createElement('div');
      nodeEl.className = `graph-child-node ${direction === 'forward' ? 'spawning' : ''}`;
      nodeEl.dataset.status = childStatus;
      nodeEl.dataset.id = child.id;

      const dotClass = childStatus === 'completed' ? 'completed' : (childStatus === 'in-progress' ? 'in-progress' : 'todo');

      nodeEl.innerHTML = `
        <span class="child-status-dot ${dotClass}"></span>
        <span class="child-index">${String(index + 1).padStart(2, '0')}</span>
        <span class="child-node-title" title="${child.title}">${child.title}</span>
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
    activeModalNodeRelPath = relPath;
    activeDocType = docType;

    const overlay = document.getElementById('markdown-modal-overlay');
    const titleEl = document.getElementById('md-modal-title');
    const pathEl = document.getElementById('md-modal-path');
    const iconEl = document.getElementById('md-modal-icon');
    const textarea = document.getElementById('md-textarea');
    const previewEl = document.getElementById('md-rendered-view');

    const filename = docType === 'info' ? 'info.md' : 'notes.md';
    titleEl.textContent = `${filename}`;
    pathEl.textContent = `graph/${relPath ? relPath + '/' : ''}${filename}`;
    iconEl.textContent = docType === 'info' ? 'ℹ️' : '📝';

    updateDocSwitchTabs(docType);

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
    renderMarkdownContent(content, previewEl);
    switchEditorMode('preview');

    overlay.classList.add('open');
  }

  function closeMarkdownModal() {
    document.getElementById('markdown-modal-overlay').classList.remove('open');
  }

  function updateDocSwitchTabs(docType) {
    const btnInfo = document.getElementById('btn-doc-info');
    const btnNotes = document.getElementById('btn-doc-notes');
    if (!btnInfo || !btnNotes) return;

    if (docType === 'info') {
      btnInfo.classList.add('active');
      btnNotes.classList.remove('active');
    } else {
      btnNotes.classList.add('active');
      btnInfo.classList.remove('active');
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

  async function saveMarkdownToDisk() {
    const textarea = document.getElementById('md-textarea');
    const btnSave = document.getElementById('btn-save-markdown');
    const content = textarea.value;
    const relPath = activeModalNodeRelPath;
    const filename = activeDocType === 'info' ? 'info.md' : 'notes.md';
    const endpoint = activeDocType === 'info' ? '/api/save-info' : '/api/save-notes';

    if (btnSave) {
      btnSave.disabled = true;
      btnSave.textContent = '💾 Saving...';
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: relPath, content: content })
      });

      if (res.ok) {
        const data = await res.json();
        if (btnSave) {
          btnSave.textContent = '✓ Saved!';
          setTimeout(() => {
            btnSave.textContent = '💾 Save to Disk';
            btnSave.disabled = false;
          }, 1500);
        }

        if (data.node) {
          nodeCache[relPath] = data.node;
          if (currentNode && currentNode.relPath === relPath) {
            currentNode = data.node;
          }
        }

        if (activeDocType === 'info') {
          loadNodeOnDemand(getCurrentRelPath(), true);
        }
      } else {
        if (btnSave) {
          btnSave.textContent = '⚠️ Save Failed';
          setTimeout(() => {
            btnSave.textContent = '💾 Save to Disk';
            btnSave.disabled = false;
          }, 2000);
        }
      }
    } catch (err) {
      if (btnSave) {
        btnSave.textContent = '⚠️ Error';
        setTimeout(() => {
          btnSave.textContent = '💾 Save to Disk';
          btnSave.disabled = false;
        }, 2000);
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

  function openAddChildModal(parentRelPath) {
    targetAddChildParentId = parentRelPath !== undefined ? parentRelPath : getCurrentRelPath();
    const parentTitle = currentNode ? currentNode.title : '';

    document.getElementById('add-child-parent-label').textContent = parentTitle ? `Under: ${parentTitle} (graph/${targetAddChildParentId || '(root)'})` : '';

    const nameInput = document.getElementById('new-child-name');
    const statusEl = document.getElementById('add-child-status');

    nameInput.value = '';
    statusEl.textContent = '';

    document.getElementById('add-child-modal-overlay').classList.add('open');
    setTimeout(() => nameInput.focus(), 60);
  }

  function closeAddChildModal() {
    document.getElementById('add-child-modal-overlay').classList.remove('open');
  }

  async function handleAddChildSubmit(e) {
    e.preventDefault();

    const name = document.getElementById('new-child-name').value.trim();
    const statusEl = document.getElementById('add-child-status');

    if (!name) {
      statusEl.textContent = 'Please enter a station name';
      return;
    }

    statusEl.textContent = 'Creating station on disk...';
    const parentRel = targetAddChildParentId;

    try {
      const res = await fetch('/api/add-child', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentPath: parentRel,
          name: name
        })
      });

      if (res.ok) {
        closeAddChildModal();
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
  // 10. Event Listeners & Bootstrapping
  // ---------------------------------------------------------------------------

  function setupEventListeners() {
    setupSearch();
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

    const btnNextBannerJump = document.getElementById('btn-next-banner-jump');
    if (btnNextBannerJump) {
      btnNextBannerJump.onclick = () => {
        if (currentRecommendedNode && currentRecommendedNode.relPath !== getCurrentRelPath()) {
          navigateToNode(currentRecommendedNode.relPath, currentRecommendedNode.breadcrumbs);
        }
      };
    }

    // Keyboard Shortcuts (Ctrl+S / Cmd+S)
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        const modal = document.getElementById('markdown-modal-overlay');
        if (modal && modal.classList.contains('open')) {
          e.preventDefault();
          saveMarkdownToDisk();
        }
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
