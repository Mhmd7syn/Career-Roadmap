/**
 * Career Knowledge Graph Engine
 * Directory-as-Graph:
 * - Any subfolder inside a node folder is automatically a child station.
 * - Any non-metadata file inside a node folder is automatically a resource.
 * - Child creation is a simple '+' button viewed as a child, opening a prompt for the node name only.
 * - Clicking Info opens all node details as directly editable text fields.
 * - Clicking Notes opens a window to view and edit summary.md with live disk save.
 */
(function () {
  'use strict';

  // State
  let graphManifest = {}; // node_id -> { id, folderName, relPath, metadata, summaryExists }
  let isServerConnected = false;
  let historyStack = ['root'];
  let activeDrawerNodeId = null;
  let targetAddChildParentId = 'root';

  // ---------------------------------------------------------------------------
  // 1. Helpers
  // ---------------------------------------------------------------------------

  function getNode(nodeId) {
    if (!nodeId) return null;
    if (graphManifest[nodeId] && graphManifest[nodeId].metadata) {
      return graphManifest[nodeId].metadata;
    }
    for (const key of Object.keys(graphManifest)) {
      const item = graphManifest[key];
      if (item && (item.id === nodeId || item.folderName === nodeId || item.relPath === nodeId)) {
        return item.metadata;
      }
    }
    return null;
  }

  function getNodeRelPath(nodeId) {
    if (graphManifest[nodeId] && typeof graphManifest[nodeId].relPath === 'string') {
      return graphManifest[nodeId].relPath;
    }
    for (const key of Object.keys(graphManifest)) {
      const item = graphManifest[key];
      if (item && (item.id === nodeId || item.folderName === nodeId)) {
        return item.relPath;
      }
    }
    return nodeId === 'root' ? '' : nodeId;
  }

  function getCurrentNode() {
    const currentId = historyStack[historyStack.length - 1];
    return getNode(currentId);
  }

  function getNodeStatus(nodeId) {
    const node = getNode(nodeId);
    return (node && node.status) ? node.status : 'todo';
  }

  // ---------------------------------------------------------------------------
  // 2. Server API & Graph Loading
  // ---------------------------------------------------------------------------

  async function checkServerConnection() {
    const pill = document.getElementById('server-status-pill');

    try {
      const res = await fetch('/api/graph', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        isServerConnected = true;
        pill.textContent = '🟢 Server Connected';
        pill.className = 'server-status-dot connected';
        pill.title = `Serving ${data.count} directory stations from graph/`;

        if (data.nodes) {
          graphManifest = data.nodes;
        }
        return true;
      }
    } catch (e) {
      // Offline mode
    }

    isServerConnected = false;
    pill.textContent = '🟡 Offline';
    pill.className = 'server-status-dot offline';
    pill.title = 'Run "run.bat" or "python server.py" for live disk sync.';
    return false;
  }

  async function setNodeStatus(nodeId, newStatus) {
    const node = getNode(nodeId);
    if (node) {
      node.status = newStatus;
    }

    if (isServerConnected) {
      const relPath = getNodeRelPath(nodeId);
      try {
        const res = await fetch('/api/save-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: relPath, status: newStatus })
        });
        if (res.ok) {
          await checkServerConnection();
        }
      } catch (err) {
        console.warn('Failed to save status to server:', err);
      }
    }

    renderCurrentView();
    updateOverallProgress();

    if (activeDrawerNodeId === nodeId) {
      updateDrawerStatusButtons(newStatus);
    }
  }

  // ---------------------------------------------------------------------------
  // 3. UI Rendering: Breadcrumbs, Header & Progress
  // ---------------------------------------------------------------------------

  function updateOverallProgress() {
    const progressFill = document.getElementById('overall-progress-fill');
    const progressText = document.getElementById('overall-progress-text');
    const progressPill = document.getElementById('overall-progress-pill');

    const uniqueNodes = new Set();
    let completed = 0;

    Object.values(graphManifest).forEach(item => {
      if (!item || !item.metadata || item.id === 'root') return;
      if (!uniqueNodes.has(item.id)) {
        uniqueNodes.add(item.id);
        if (item.metadata.status === 'completed') {
          completed++;
        }
      }
    });

    const total = uniqueNodes.size;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    if (progressFill) progressFill.style.width = percent + '%';
    if (progressText) progressText.textContent = `${percent}%`;
    if (progressPill) progressPill.title = `${completed}/${total} Stations Completed (${percent}%)`;
  }

  function renderHeaderAndBreadcrumbs() {
    const breadcrumbsEl = document.getElementById('breadcrumbs');
    const backBtnEl = document.getElementById('btn-back');

    if (breadcrumbsEl) {
      breadcrumbsEl.innerHTML = '';
      historyStack.forEach((id, index) => {
        const node = getNode(id);
        const title = node ? node.title : (id === 'root' ? 'Master Graph' : id);
        const isLast = index === historyStack.length - 1;

        if (index > 0) {
          const sep = document.createElement('span');
          sep.className = 'breadcrumb-sep';
          sep.textContent = '/';
          breadcrumbsEl.appendChild(sep);
        }

        const item = document.createElement('span');
        if (isLast) {
          item.className = 'breadcrumb-current';
          item.textContent = title;
        } else {
          item.className = 'breadcrumb-item';
          item.textContent = title;
          item.onclick = () => {
            historyStack = historyStack.slice(0, index + 1);
            renderCurrentView('back');
          };
        }
        breadcrumbsEl.appendChild(item);
      });
    }

    if (backBtnEl) {
      backBtnEl.style.display = historyStack.length > 1 ? 'inline-flex' : 'none';
      backBtnEl.onclick = () => {
        if (historyStack.length > 1) {
          historyStack.pop();
          renderCurrentView('back');
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
    svgEl.classList.remove('svg-fading');
  }

  window.addEventListener('resize', () => {
    requestAnimationFrame(drawConnectorLines);
  });

  // ---------------------------------------------------------------------------
  // 5. Main Canvas View: Parent Card & Children with '+' Button Child
  // ---------------------------------------------------------------------------

  function renderCurrentView(direction = 'none') {
    renderHeaderAndBreadcrumbs();
    updateOverallProgress();

    const currentNode = getCurrentNode();
    const currentId = historyStack[historyStack.length - 1];

    const parentAnchor = document.getElementById('graph-parent-anchor');
    const childrenAnchor = document.getElementById('graph-children-anchor');
    const svgEl = document.getElementById('graph-svg');

    if (!parentAnchor || !childrenAnchor) return;

    if (!currentNode) {
      parentAnchor.innerHTML = '<div class="graph-parent-card"><span class="graph-parent-title">Station Loading...</span></div>';
      childrenAnchor.innerHTML = '';
      if (svgEl) svgEl.innerHTML = '';
      return;
    }

    const currentStatus = getNodeStatus(currentId);
    const badgeText = currentNode.badge || (currentId === 'root' ? 'Master Graph' : 'Station');
    const descText = currentNode.description ? `<p style="font-size: 0.84rem; color: var(--text-secondary); max-width: 520px; margin: 4px 0 8px 0; line-height: 1.4;">${currentNode.description}</p>` : '';

    // 1. Render Active Parent Node Card
    parentAnchor.innerHTML = `
      <div class="graph-parent-card">
        <div class="graph-parent-top-row">
          <button class="btn-status-cycle status-${currentStatus}" id="btn-status-toggle" title="Click to cycle status: To Do → In Progress → Completed">
            ${currentStatus === 'completed' ? '● Done' : (currentStatus === 'in-progress' ? '◐ In Progress' : '○ To Do')}
          </button>
          <span style="font-size: 0.72rem; color: var(--accent-blue); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">${badgeText}</span>
        </div>
        <div class="graph-parent-title">${currentNode.title}</div>
        ${descText}
        <div class="graph-parent-actions">
          <button class="btn-graph-action btn-graph-summary" id="btn-parent-summary" title="View & edit notes (summary.md)">
            📝 Notes
          </button>
          <button class="btn-graph-action btn-graph-info" id="btn-parent-info" title="Inspect & edit all station details">
            ℹ️ Info
          </button>
        </div>
      </div>
    `;

    // Bind Parent Card Actions
    document.getElementById('btn-status-toggle').onclick = () => {
      const nextMap = { 'todo': 'in-progress', 'in-progress': 'completed', 'completed': 'todo' };
      setNodeStatus(currentId, nextMap[currentStatus] || 'todo');
    };
    document.getElementById('btn-parent-summary').onclick = () => openSummaryModal(currentId);
    document.getElementById('btn-parent-info').onclick = () => openInfoDrawer(currentId);

    // 2. Render Children (Every subfolder is a child) + '+' Button as a Child
    childrenAnchor.innerHTML = '';
    const children = currentNode.children || [];
    const childEls = [];

    // Render existing children
    children.forEach((childId, index) => {
      const childNode = getNode(childId);
      const title = childNode ? childNode.title : childId;
      const childStatus = getNodeStatus(childId);
      const subCount = (childNode && childNode.children) ? childNode.children.length : 0;
      const branchBadge = subCount > 0 ? `<span class="child-branch-indicator" title="${subCount} sub-stations">⑂ ${subCount}</span>` : '';

      const nodeEl = document.createElement('div');
      nodeEl.className = `graph-child-node ${direction === 'forward' ? 'spawning' : ''}`;
      nodeEl.dataset.status = childStatus;
      nodeEl.dataset.id = childId;

      const dotClass = childStatus === 'completed' ? 'completed' : (childStatus === 'in-progress' ? 'in-progress' : 'todo');

      nodeEl.innerHTML = `
        <span class="child-status-dot ${dotClass}"></span>
        <span class="child-index">${String(index + 1).padStart(2, '0')}</span>
        <span class="child-node-title" title="${title}">${title}</span>
        ${branchBadge}
        <button class="btn-child-quick-info" title="Edit info for ${title}">ℹ️</button>
      `;

      // Quick Info Button opens drawer with all editable text fields
      const quickBtn = nodeEl.querySelector('.btn-child-quick-info');
      if (quickBtn) {
        quickBtn.onclick = (e) => {
          e.stopPropagation();
          openInfoDrawer(childId);
        };
      }

      // Clicking card drills down into that child
      nodeEl.onclick = () => {
        historyStack.push(childId);
        renderCurrentView('forward');
      };

      childrenAnchor.appendChild(nodeEl);
      childEls.push(nodeEl);
    });

    // 3. Render the '+' Button as a Child in this node
    const addCardEl = document.createElement('div');
    addCardEl.className = 'graph-child-node btn-child-add-card';
    addCardEl.title = `Add new child station under ${currentNode.title}`;
    addCardEl.dataset.status = 'todo';
    addCardEl.innerHTML = `
      <span class="child-add-plus-icon">+</span>
      ${children.length === 0 ? '<span style="font-size: 0.82rem; font-weight: 600; margin-left: 6px;">Add Child</span>' : ''}
    `;
    addCardEl.onclick = () => openAddChildModal(currentId);

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

    // Draw SVG Connectors after DOM settles
    setTimeout(() => {
      drawConnectorLines();
    }, direction === 'forward' ? (childEls.length * 35 + 80) : 20);
  }

  // ---------------------------------------------------------------------------
  // 6. Side Drawer: All Node Info Directly as Editable Text Fields
  // ---------------------------------------------------------------------------

  function openInfoDrawer(nodeId) {
    const node = getNode(nodeId);
    if (!node) return;

    activeDrawerNodeId = nodeId;

    const overlay = document.getElementById('drawer-overlay');
    const drawer = document.getElementById('drawer');
    const titleEl = document.getElementById('drawer-title');
    const kickerEl = document.getElementById('drawer-kicker');
    const pathEl = document.getElementById('drawer-info-path');
    const relPath = getNodeRelPath(nodeId);

    titleEl.textContent = `Edit Station: ${node.title}`;
    kickerEl.textContent = `graph/${relPath || '(root)'}`;
    pathEl.textContent = `📁 graph/${relPath || '(root)'}`;

    // Fill in all editable text fields
    document.getElementById('drawer-info-title').value = node.title || '';
    document.getElementById('drawer-info-badge').value = node.badge || 'Module';
    document.getElementById('drawer-info-desc').value = node.description || '';
    document.getElementById('drawer-info-concept').value = node.concept || '';
    document.getElementById('drawer-info-recall').value = node.activeRecall || '';
    document.getElementById('drawer-save-status').textContent = 'Ready';

    // Status Buttons in Drawer
    updateDrawerStatusButtons(node.status || 'todo');

    // Render Files list (files found in this directory on disk)
    renderDrawerFilesList(node);

    // Render External Link Resources editor
    renderDrawerLinksList(node);

    overlay.classList.add('open');
    drawer.classList.add('open');
  }

  function closeInfoDrawer() {
    document.getElementById('drawer-overlay').classList.remove('open');
    document.getElementById('drawer').classList.remove('open');
    activeDrawerNodeId = null;
  }

  function updateDrawerStatusButtons(status) {
    const btnTodo = document.getElementById('btn-status-todo');
    const btnInProg = document.getElementById('btn-status-inprogress');
    const btnComp = document.getElementById('btn-status-completed');

    if (!btnTodo || !btnInProg || !btnComp) return;

    [btnTodo, btnInProg, btnComp].forEach(b => b.className = 'btn-status');

    if (status === 'completed') {
      btnComp.classList.add('active-completed');
    } else if (status === 'in-progress') {
      btnInProg.classList.add('active-in-progress');
    } else {
      btnTodo.classList.add('active-todo');
    }
  }

  function renderDrawerFilesList(node) {
    const container = document.getElementById('drawer-files-list');
    const titleLabel = document.getElementById('drawer-resources-title');
    const resources = node.resources || [];
    const files = resources.filter(r => r.type === 'file');

    if (titleLabel) {
      titleLabel.textContent = `Files in Folder (${files.length})`;
    }

    if (files.length === 0) {
      container.innerHTML = `
        <div style="font-size: 0.8rem; color: var(--text-muted); font-style: italic; padding: 4px 0;">
          No files in this folder yet. Drop any files into graph/${getNodeRelPath(node.id)} or click "Upload File".
        </div>
      `;
      return;
    }

    container.innerHTML = files.map(f => {
      const icon = getFileIcon(f.ext || f.label);
      const sizeStr = f.size ? formatBytes(f.size) : '';
      return `
        <a href="${f.url}" target="_blank" rel="noopener noreferrer" class="resource-file-card" title="Click to open or view ${f.label}">
          <div class="resource-left">
            <span class="resource-icon">${icon}</span>
            <span class="resource-name">${f.label}</span>
          </div>
          <div class="resource-right">
            <span class="resource-size">${sizeStr}</span>
            <span class="resource-tag tag-file">${f.ext || 'FILE'}</span>
          </div>
        </a>
      `;
    }).join('');
  }

  function renderDrawerLinksList(node) {
    const listEl = document.getElementById('resources-edit-list');
    listEl.innerHTML = '';

    const resources = node.resources || [];
    const links = resources.filter(r => r.type !== 'file');

    if (links.length === 0) {
      addResourceEditRow('', '');
    } else {
      links.forEach(l => addResourceEditRow(l.label || '', l.url || ''));
    }
  }

  function addResourceEditRow(label = '', url = '') {
    const listEl = document.getElementById('resources-edit-list');
    const row = document.createElement('div');
    row.className = 'resource-edit-row';
    row.innerHTML = `
      <input type="text" class="form-input res-label" placeholder="Link Title (e.g. Documentation)" value="${escapeHtml(label)}" style="flex: 1;">
      <input type="text" class="form-input res-url" placeholder="URL (https://...)" value="${escapeHtml(url)}" style="flex: 1.5;">
      <button type="button" class="btn-remove-row" title="Delete link">&times;</button>
    `;

    row.querySelector('.btn-remove-row').onclick = () => row.remove();
    listEl.appendChild(row);
  }

  async function handleDrawerSave(e) {
    e.preventDefault();
    if (!activeDrawerNodeId) return;

    const statusEl = document.getElementById('drawer-save-status');
    statusEl.textContent = 'Saving to disk...';

    const title = document.getElementById('drawer-info-title').value.trim();
    const badge = document.getElementById('drawer-info-badge').value.trim();
    const description = document.getElementById('drawer-info-desc').value.trim();
    const concept = document.getElementById('drawer-info-concept').value.trim();
    const activeRecall = document.getElementById('drawer-info-recall').value.trim();

    // Gather external links
    const linkResources = [];
    document.querySelectorAll('#resources-edit-list .resource-edit-row').forEach(row => {
      const l = row.querySelector('.res-label').value.trim();
      const u = row.querySelector('.res-url').value.trim();
      if (l || u) {
        linkResources.push({ label: l || u, url: u || '#', type: 'link' });
      }
    });

    const currentNode = getNode(activeDrawerNodeId);
    const updates = {
      title: title || activeDrawerNodeId,
      badge: badge || 'Module',
      description: description,
      concept: concept,
      activeRecall: activeRecall,
      resources: linkResources
    };

    if (isServerConnected) {
      try {
        const res = await fetch('/api/save-node', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: getNodeRelPath(activeDrawerNodeId),
            metadata: updates
          })
        });

        if (res.ok) {
          const data = await res.json();
          if (data.node && data.node.metadata) {
            graphManifest[activeDrawerNodeId] = data.node;
          }
          statusEl.textContent = 'Saved to node.json ✓';
        } else {
          statusEl.textContent = 'Server save error';
        }
      } catch (err) {
        statusEl.textContent = 'Network error saving';
        console.error('Error saving node:', err);
      }
    } else {
      if (currentNode) Object.assign(currentNode, updates);
      statusEl.textContent = 'Saved locally ✓';
    }

    renderCurrentView();
    updateOverallProgress();

    setTimeout(() => {
      if (statusEl.textContent.includes('Saved')) {
        statusEl.textContent = 'Ready';
      }
    }, 2000);
  }

  // ---------------------------------------------------------------------------
  // 7. Add Child Station Modal (Choose Name Only)
  // ---------------------------------------------------------------------------

  function openAddChildModal(parentId) {
    targetAddChildParentId = parentId || historyStack[historyStack.length - 1];
    const parentNode = getNode(targetAddChildParentId);
    const parentTitle = parentNode ? parentNode.title : targetAddChildParentId;
    const parentRel = getNodeRelPath(targetAddChildParentId);

    document.getElementById('add-child-parent-label').textContent = `Under: ${parentTitle} (graph/${parentRel || '(root)'})`;

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

  function slugify(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
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

    const childId = slugify(name);
    const parentRel = getNodeRelPath(targetAddChildParentId);

    if (isServerConnected) {
      try {
        const res = await fetch('/api/add-child', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parentPath: parentRel,
            childId: childId,
            title: name
          })
        });

        if (res.ok) {
          closeAddChildModal();
          await checkServerConnection();
          renderCurrentView('forward');
          updateOverallProgress();
          return;
        } else {
          const err = await res.json();
          statusEl.textContent = `Error: ${err.error || 'Failed to create station'}`;
          return;
        }
      } catch (err) {
        statusEl.textContent = 'Network error contacting server';
        console.error('Error adding child:', err);
        return;
      }
    }

    // Local offline mode
    const parentNode = getNode(targetAddChildParentId);
    if (parentNode) {
      if (!parentNode.children) parentNode.children = [];
      if (!parentNode.children.includes(childId)) {
        parentNode.children.push(childId);
      }
      graphManifest[childId] = {
        id: childId,
        folderName: childId,
        relPath: parentRel ? `${parentRel}/${childId}` : childId,
        metadata: {
          id: childId,
          title: name,
          badge: 'Module',
          description: '',
          status: 'todo',
          children: [],
          resources: []
        }
      };
    }

    closeAddChildModal();
    renderCurrentView('forward');
    updateOverallProgress();
  }

  // ---------------------------------------------------------------------------
  // 8. Resource File Upload (Direct to Node Directory on Disk)
  // ---------------------------------------------------------------------------

  function triggerFileUpload() {
    const input = document.getElementById('resource-file-input');
    if (input) {
      input.value = '';
      input.click();
    }
  }

  async function handleFileSelected(e) {
    const files = e.target.files;
    if (!files || files.length === 0 || !activeDrawerNodeId) return;

    const relPath = getNodeRelPath(activeDrawerNodeId);

    for (const file of files) {
      const reader = new FileReader();
      reader.onload = async function (evt) {
        const base64Data = evt.target.result;

        try {
          const res = await fetch('/api/upload-resource', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              path: relPath,
              filename: file.name,
              content: base64Data
            })
          });

          if (res.ok) {
            await checkServerConnection();
            const updatedNode = getNode(activeDrawerNodeId);
            if (updatedNode) {
              renderDrawerFilesList(updatedNode);
            }
          }
        } catch (err) {
          console.error('File upload error:', err);
        }
      };
      reader.readAsDataURL(file);
    }
  }

  // ---------------------------------------------------------------------------
  // 9. Notes & Markdown Editor (summary.md)
  // ---------------------------------------------------------------------------

  async function openSummaryModal(nodeId) {
    const node = getNode(nodeId);
    if (!node) return;

    const overlay = document.getElementById('summary-modal-overlay');
    const titleEl = document.getElementById('summary-modal-title');
    const pathEl = document.getElementById('summary-modal-path');
    const textarea = document.getElementById('summary-textarea');
    const saveStatusEl = document.getElementById('summary-save-status');
    const previewEl = document.getElementById('summary-rendered-view');

    const relPath = getNodeRelPath(nodeId);
    titleEl.textContent = `summary.md — ${node.title}`;
    pathEl.textContent = `graph/${relPath}/summary.md`;
    saveStatusEl.textContent = 'Loading notes...';

    let content = '';
    if (isServerConnected) {
      try {
        const res = await fetch(`/api/node?path=${encodeURIComponent(relPath)}`);
        if (res.ok) {
          const data = await res.json();
          content = data.summary || '';
        }
      } catch (e) {
        console.warn('Failed to load summary from server:', e);
      }
    }

    if (!content) {
      content = `# ${node.title}\n\n> Add your notes, code snippets, and formulas here.\n`;
    }

    textarea.value = content;
    saveStatusEl.textContent = isServerConnected ? 'Synced with disk' : 'Local mode';

    renderMarkdownContent(content, previewEl);
    switchSummaryTab('preview');

    overlay.classList.add('open');
  }

  function closeSummaryModal() {
    document.getElementById('summary-modal-overlay').classList.remove('open');
  }

  function switchSummaryTab(tab) {
    const btnPreview = document.getElementById('btn-tab-preview');
    const btnEdit = document.getElementById('btn-tab-edit');
    const previewView = document.getElementById('summary-rendered-view');
    const editorView = document.getElementById('summary-editor-view');
    const textarea = document.getElementById('summary-textarea');

    if (tab === 'edit') {
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

  async function saveSummaryToDisk() {
    const currentId = historyStack[historyStack.length - 1];
    const textarea = document.getElementById('summary-textarea');
    const saveStatusEl = document.getElementById('summary-save-status');

    const content = textarea.value;
    const relPath = getNodeRelPath(currentId);

    saveStatusEl.textContent = 'Saving to disk...';

    if (isServerConnected) {
      try {
        const res = await fetch('/api/save-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: relPath, content: content })
        });

        if (res.ok) {
          saveStatusEl.textContent = `Saved to graph/${relPath}/summary.md ✓`;
        } else {
          saveStatusEl.textContent = 'Server error during save';
        }
      } catch (err) {
        saveStatusEl.textContent = 'Network error saving to disk';
      }
    } else {
      saveStatusEl.textContent = 'Saved locally ✓';
    }
  }

  function insertEditorFormatting(tool) {
    const textarea = document.getElementById('summary-textarea');
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
  // 10. Utility Helpers
  // ---------------------------------------------------------------------------

  function getFileIcon(ext) {
    const map = {
      'pdf': '📑',
      'png': '🖼️',
      'jpg': '🖼️',
      'jpeg': '🖼️',
      'svg': '🎨',
      'py': '🐍',
      'js': '📜',
      'json': '📋',
      'md': '📝',
      'txt': '📄',
      'csv': '📊',
      'sql': '🗄️'
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

  function escapeHtml(str) {
    return (str || '').replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  // ---------------------------------------------------------------------------
  // 11. Event Listeners & Bootstrapping
  // ---------------------------------------------------------------------------

  function setupEventListeners() {
    // Logo returns to root
    const logo = document.getElementById('logo');
    if (logo) {
      logo.onclick = () => {
        if (historyStack.length > 1) {
          historyStack = ['root'];
          renderCurrentView('back');
        }
      };
    }

    // Drawer Controls
    const drawerClose = document.getElementById('drawer-close');
    if (drawerClose) drawerClose.onclick = closeInfoDrawer;

    const drawerCloseBottom = document.getElementById('btn-drawer-close-bottom');
    if (drawerCloseBottom) drawerCloseBottom.onclick = closeInfoDrawer;

    const drawerOverlay = document.getElementById('drawer-overlay');
    if (drawerOverlay) drawerOverlay.onclick = closeInfoDrawer;

    // Status Buttons in Drawer
    ['todo', 'inprogress', 'completed'].forEach(stKey => {
      const val = stKey === 'inprogress' ? 'in-progress' : stKey;
      const btn = document.getElementById(`btn-status-${stKey}`);
      if (btn) {
        btn.onclick = () => {
          if (activeDrawerNodeId) setNodeStatus(activeDrawerNodeId, val);
        };
      }
    });

    // Drawer Info Form (Save changes to node.json)
    const drawerInfoForm = document.getElementById('drawer-info-form');
    if (drawerInfoForm) drawerInfoForm.onsubmit = handleDrawerSave;

    const btnAddResLink = document.getElementById('btn-add-resource-link');
    if (btnAddResLink) btnAddResLink.onclick = () => addResourceEditRow('', '');

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

    // Resource file input upload
    const fileInput = document.getElementById('resource-file-input');
    if (fileInput) fileInput.onchange = handleFileSelected;

    const btnTriggerUpload = document.getElementById('btn-trigger-upload');
    if (btnTriggerUpload) btnTriggerUpload.onclick = triggerFileUpload;

    // Summary Notes Modal Controls
    const btnTabPrev = document.getElementById('btn-tab-preview');
    if (btnTabPrev) btnTabPrev.onclick = () => switchSummaryTab('preview');

    const btnTabEdit = document.getElementById('btn-tab-edit');
    if (btnTabEdit) btnTabEdit.onclick = () => switchSummaryTab('edit');

    const btnSaveSummary = document.getElementById('btn-save-summary');
    if (btnSaveSummary) btnSaveSummary.onclick = saveSummaryToDisk;

    const btnCloseSummary = document.getElementById('btn-close-summary');
    if (btnCloseSummary) btnCloseSummary.onclick = closeSummaryModal;

    const btnSummaryDone = document.getElementById('btn-summary-done');
    if (btnSummaryDone) btnSummaryDone.onclick = closeSummaryModal;

    const summaryOverlay = document.getElementById('summary-modal-overlay');
    if (summaryOverlay) {
      summaryOverlay.onclick = (e) => {
        if (e.target.id === 'summary-modal-overlay') closeSummaryModal();
      };
    }

    document.querySelectorAll('.btn-tool').forEach(btn => {
      btn.onclick = () => insertEditorFormatting(btn.getAttribute('data-tool'));
    });

    // Keyboard Shortcuts (Ctrl+S / Cmd+S)
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        const summaryOverlay = document.getElementById('summary-modal-overlay');
        const drawer = document.getElementById('drawer');

        if (summaryOverlay && summaryOverlay.classList.contains('open')) {
          e.preventDefault();
          saveSummaryToDisk();
        } else if (drawer && drawer.classList.contains('open') && activeDrawerNodeId) {
          e.preventDefault();
          const submitBtn = document.getElementById('btn-save-drawer-info');
          if (submitBtn) submitBtn.click();
        }
      }
    });
  }

  async function init() {
    setupEventListeners();
    await checkServerConnection();
    renderCurrentView();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
