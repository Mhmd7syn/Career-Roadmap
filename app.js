/**
 * Career Knowledge Graph Engine
 * Directory-as-Graph + Context-Aware BFS Traversal Engine + Live Disk Sync (Python 3.14)
 * Supports Parent-Child Status Cascading, Leaf-Node Learning, and Context-Aware Progression
 */
(function () {
  'use strict';

  const STORAGE_STATUS_KEY = 'career_roadmap_node_statuses';
  const STORAGE_NOTES_CACHE = 'career_roadmap_notes_cache';
  const DEFAULT_START_STACK = ['root', 'tech'];

  // Global In-Memory Graph State
  let graphManifest = {}; // node_id -> { id, relPath, metadata, summaryExists }
  let isServerConnected = false;
  let historyStack = [...DEFAULT_START_STACK];
  let activeNode = null;
  let currentSummaryContent = '';
  let viewMode = 'swimlanes'; // 'swimlanes' | 'road' for tech domain

  // The 4 Parallel Tracks + Fusion
  const PARALLEL_TRACKS = ['core-cs', 'swe', 'data', 'ai', 'fusion'];

  // ---------------------------------------------------------------------------
  // 1. Persistence & Status Helpers with Status Cascading
  // ---------------------------------------------------------------------------

  function getSavedStatuses() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_STATUS_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function getSavedNotesCache() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_NOTES_CACHE)) || {};
    } catch (e) {
      return {};
    }
  }

  function getNodeStatus(nodeId) {
    const statuses = getSavedStatuses();
    if (statuses[nodeId]) return statuses[nodeId];

    const node = getNode(nodeId);
    if (node && node.status) return node.status;
    return 'todo';
  }

  function findParentNodeId(childId) {
    for (const [nid, item] of Object.entries(graphManifest)) {
      const meta = item.metadata;
      if (meta && meta.children && meta.children.includes(childId)) {
        return nid;
      }
    }
    // Fallback checks
    if (PARALLEL_TRACKS.includes(childId)) return 'tech';
    if (['tech', 'freelancing', 'marketing'].includes(childId)) return 'root';
    return null;
  }

  function cascadeStatusUpwards(nodeId) {
    const parentId = findParentNodeId(nodeId);
    if (!parentId || parentId === 'root') return;

    const parentNode = getNode(parentId);
    if (!parentNode || !parentNode.children || parentNode.children.length === 0) return;

    const statuses = getSavedStatuses();
    let allDone = true;
    let anyActive = false;

    for (const cid of parentNode.children) {
      const cstatus = statuses[cid] || (getNode(cid) ? getNode(cid).status : 'todo');
      if (cstatus !== 'completed') {
        allDone = false;
      }
      if (cstatus === 'in-progress' || cstatus === 'completed') {
        anyActive = true;
      }
    }

    const currentParentStatus = statuses[parentId] || parentNode.status || 'todo';
    let newParentStatus = currentParentStatus;

    if (allDone) {
      newParentStatus = 'completed';
    } else if (anyActive || currentParentStatus === 'completed') {
      newParentStatus = 'in-progress';
    }

    if (newParentStatus !== currentParentStatus) {
      statuses[parentId] = newParentStatus;
      parentNode.status = newParentStatus;
      localStorage.setItem(STORAGE_STATUS_KEY, JSON.stringify(statuses));

      if (isServerConnected) {
        const parentRel = getNodeRelPath(parentId);
        fetch('/api/save-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: parentRel, status: newParentStatus })
        }).catch(err => console.warn('Parent cascade server save error:', err));
      }

      cascadeStatusUpwards(parentId);
    }
  }

  async function setNodeStatus(nodeId, status) {
    const statuses = getSavedStatuses();
    statuses[nodeId] = status;
    localStorage.setItem(STORAGE_STATUS_KEY, JSON.stringify(statuses));

    const node = getNode(nodeId);
    if (node) {
      node.status = status;
    }

    if (isServerConnected) {
      const relPath = getNodeRelPath(nodeId);
      try {
        await fetch('/api/save-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: relPath, status: status })
        });
      } catch (err) {
        console.warn('[Status Save Disk Error]:', err);
      }
    }

    cascadeStatusUpwards(nodeId);

    renderCurrentView();
    updateNextUpBanner();
    updateOverallProgress();

    updateDrawerStatusButtons(status);
    const selectEl = document.getElementById('select-quick-status');
    if (selectEl) selectEl.value = status;
  }

  // ---------------------------------------------------------------------------
  // 2. Node Retrieval & RelPath Helpers
  // ---------------------------------------------------------------------------

  function getNode(nodeId) {
    if (graphManifest[nodeId] && graphManifest[nodeId].metadata) {
      const m = graphManifest[nodeId].metadata;
      if (!m.children) m.children = [];
      return m;
    }
    if (window.RoadmapRegistry) {
      if (window.RoadmapRegistry[nodeId]) {
        const reg = window.RoadmapRegistry[nodeId];
        if (!reg.children && reg.stations) {
          reg.children = reg.stations.map(s => s.id || s.targetRoadmapId).filter(Boolean);
        }
        if (!reg.children) reg.children = [];
        return reg;
      }
      for (const parentId of Object.keys(window.RoadmapRegistry)) {
        const pNode = window.RoadmapRegistry[parentId];
        if (pNode && pNode.stations) {
          const match = pNode.stations.find(s => s.id === nodeId);
          if (match) {
            if (!match.children && match.stations) {
              match.children = match.stations.map(s => s.id || s.targetRoadmapId).filter(Boolean);
            }
            if (!match.children) match.children = [];
            return match;
          }
        }
      }
    }
    return null;
  }

  function getNodeRelPath(nodeId) {
    if (graphManifest[nodeId] && typeof graphManifest[nodeId].relPath === 'string') {
      return graphManifest[nodeId].relPath;
    }
    const map = {
      'root': '',
      'tech': 'tech',
      'freelancing': 'freelancing',
      'marketing': 'marketing',
      'core-cs': 'tech/core-cs',
      'swe': 'tech/swe',
      'data': 'tech/data',
      'ai': 'tech/ai',
      'fusion': 'tech/fusion'
    };
    return map[nodeId] || nodeId;
  }

  function getCurrentNode() {
    const currentId = historyStack[historyStack.length - 1];
    return getNode(currentId);
  }

  // ---------------------------------------------------------------------------
  // 3. Context-Aware Learning Progression Engine (Local Branch vs Global BFS)
  // ---------------------------------------------------------------------------

  // Global BFS Queue (Macro balanced round-robin across tracks)
  function getGlobalBFSRecommendation() {
    const depth1Nodes = PARALLEL_TRACKS.map(id => getNode(id)).filter(Boolean);

    let hasDepth2Children = false;
    for (const track of depth1Nodes) {
      if (track.children && track.children.length > 0) {
        hasDepth2Children = true;
        break;
      }
    }

    // Phase 1: Depth 1 tracks as leaf nodes
    if (!hasDepth2Children) {
      for (const track of depth1Nodes) {
        if (getNodeStatus(track.id) === 'in-progress') {
          return {
            node: track,
            parent: getNode('tech'),
            depth: 1,
            isLeaf: true,
            tag: 'GLOBAL: IN PROGRESS',
            title: track.title,
            subtitle: track.description || ''
          };
        }
      }
      for (const track of depth1Nodes) {
        if (getNodeStatus(track.id) === 'todo') {
          return {
            node: track,
            parent: getNode('tech'),
            depth: 1,
            isLeaf: true,
            tag: 'GLOBAL: SURVEY',
            title: track.title,
            subtitle: track.description || ''
          };
        }
      }
      return {
        node: depth1Nodes[0],
        parent: getNode('tech'),
        depth: 1,
        isLeaf: false,
        allDone: true,
        tag: 'DEPTH 1 DONE',
        title: 'Macro Survey Done',
        subtitle: 'Return to any track to expand Depth 2 sub-stations.'
      };
    }

    // Phase 2: Depth 2 leaf nodes round-robin across tracks
    const trackChildrenMap = {};
    let maxChildren = 0;
    PARALLEL_TRACKS.forEach(trackId => {
      const track = getNode(trackId);
      const childIds = track && track.children ? track.children : [];
      trackChildrenMap[trackId] = childIds.map(cid => getNode(cid)).filter(Boolean);
      maxChildren = Math.max(maxChildren, trackChildrenMap[trackId].length);
    });

    for (let i = 0; i < maxChildren; i++) {
      for (const trackId of PARALLEL_TRACKS) {
        const childNode = trackChildrenMap[trackId][i];
        if (!childNode) continue;
        if (getNodeStatus(childNode.id) === 'in-progress') {
          const parentTrack = getNode(trackId);
          return {
            node: childNode,
            parent: parentTrack,
            depth: 2,
            isLeaf: (!childNode.children || childNode.children.length === 0),
            tag: 'GLOBAL: IN PROGRESS',
            title: `${parentTrack.title} → ${childNode.title}`,
            subtitle: childNode.description || ''
          };
        }
      }
    }

    for (let i = 0; i < maxChildren; i++) {
      for (const trackId of PARALLEL_TRACKS) {
        const childNode = trackChildrenMap[trackId][i];
        if (!childNode) continue;
        if (getNodeStatus(childNode.id) === 'todo') {
          const parentTrack = getNode(trackId);
          return {
            node: childNode,
            parent: parentTrack,
            depth: 2,
            isLeaf: (!childNode.children || childNode.children.length === 0),
            tag: 'GLOBAL: APPLIED',
            title: `${parentTrack.title} → ${childNode.title}`,
            subtitle: childNode.description || ''
          };
        }
      }
    }

    return null;
  }

  // Local Context Next Step (adapted to currently viewed branch/node)
  function getLocalContextRecommendation() {
    const currentId = historyStack[historyStack.length - 1];

    // If at macro level, defer to global recommendation
    if (currentId === 'root' || currentId === 'tech') {
      return null;
    }

    const currentNode = getNode(currentId);
    if (!currentNode) return null;

    // Case A: Current node has children (viewing a branch hub)
    if (currentNode.children && currentNode.children.length > 0) {
      // Prioritize in-progress child
      for (const cid of currentNode.children) {
        const child = getNode(cid);
        if (child && getNodeStatus(cid) === 'in-progress') {
          return {
            node: child,
            parent: currentNode,
            tag: 'LOCAL: IN PROGRESS',
            title: child.title,
            subtitle: `Active station in ${currentNode.title}`,
            targetStack: [...historyStack, cid]
          };
        }
      }
      // First todo child
      for (const cid of currentNode.children) {
        const child = getNode(cid);
        if (child && getNodeStatus(cid) === 'todo') {
          return {
            node: child,
            parent: currentNode,
            tag: 'LOCAL: NEXT IN BRANCH',
            title: child.title,
            subtitle: `Next station in ${currentNode.title}`,
            targetStack: [...historyStack, cid]
          };
        }
      }
      // All children in branch completed
      return {
        node: currentNode,
        allDone: true,
        tag: 'BRANCH COMPLETE ✓',
        title: `${currentNode.title} Mastered`,
        subtitle: 'All child stations in this branch completed'
      };
    }

    // Case B: Current node is a leaf node
    const parentId = findParentNodeId(currentId);
    if (parentId && parentId !== 'root') {
      const parentNode = getNode(parentId);
      if (parentNode && parentNode.children && parentNode.children.length > 0) {
        const idx = parentNode.children.indexOf(currentId);
        // Look for next uncompleted sibling
        for (let i = idx + 1; i < parentNode.children.length; i++) {
          const sibId = parentNode.children[i];
          const sib = getNode(sibId);
          if (sib && getNodeStatus(sibId) !== 'completed') {
            const nextStack = historyStack.slice(0, -1);
            nextStack.push(sibId);
            return {
              node: sib,
              parent: parentNode,
              tag: 'LOCAL: NEXT IN TRACK',
              title: sib.title,
              subtitle: `Next station in ${parentNode.title}`,
              targetStack: nextStack
            };
          }
        }
      }
    }

    return null;
  }

  function getNextSiblingNode(nodeId) {
    const parentId = findParentNodeId(nodeId);
    if (!parentId) return null;
    const parentNode = getNode(parentId);
    if (!parentNode || !parentNode.children) return null;

    const idx = parentNode.children.indexOf(nodeId);
    if (idx >= 0 && idx < parentNode.children.length - 1) {
      const nextId = parentNode.children[idx + 1];
      return getNode(nextId);
    }
    return null;
  }

  function updateNextUpBanner() {
    const nextPill = document.getElementById('next-up-pill');
    const pillTitle = document.getElementById('next-pill-title');
    const legacyTagEl = document.getElementById('next-up-tag');
    const legacyTitleEl = document.getElementById('next-up-title');
    const legacySubtitleEl = document.getElementById('next-up-subtitle');
    const legacyBtnJump = document.getElementById('btn-jump-next');

    const currentId = historyStack[historyStack.length - 1];
    const isMacroView = (currentId === 'root' || currentId === 'tech');

    const localRec = !isMacroView ? getLocalContextRecommendation() : null;
    const globalRec = getGlobalBFSRecommendation();

    if (localRec && !localRec.allDone) {
      if (nextPill && pillTitle) {
        nextPill.style.display = 'inline-flex';
        pillTitle.textContent = localRec.node.title;
        nextPill.onclick = () => {
          if (localRec.targetStack) {
            historyStack = localRec.targetStack;
          } else {
            historyStack.push(localRec.node.id);
          }
          renderCurrentView('forward');
        };
      }
      if (legacyBtnJump && legacyTagEl) {
        legacyBtnJump.style.display = 'inline-flex';
        legacyTagEl.textContent = localRec.tag;
        legacyTitleEl.textContent = localRec.title;
        if (legacySubtitleEl) legacySubtitleEl.textContent = localRec.subtitle;
        legacyBtnJump.onclick = () => {
          if (localRec.targetStack) historyStack = localRec.targetStack;
          else historyStack.push(localRec.node.id);
          renderCurrentView('forward');
        };
      }
      return;
    }

    if (!globalRec) {
      if (nextPill && pillTitle) {
        nextPill.style.display = 'inline-flex';
        pillTitle.textContent = 'Mastered ✓';
        nextPill.onclick = null;
      }
      if (legacyBtnJump && legacyTagEl) {
        legacyTagEl.textContent = 'MASTERED';
        legacyTitleEl.textContent = 'All Available Stations Completed!';
        legacyBtnJump.style.display = 'none';
      }
      return;
    }

    if (nextPill && pillTitle) {
      nextPill.style.display = 'inline-flex';
      pillTitle.textContent = globalRec.node.title;
      nextPill.onclick = () => {
        if (globalRec.depth === 1) {
          historyStack = ['root', 'tech', globalRec.node.id];
        } else if (globalRec.depth === 2) {
          historyStack = ['root', 'tech', globalRec.parent.id, globalRec.node.id];
        }
        renderCurrentView('forward');
      };
    }

    if (legacyBtnJump && legacyTagEl) {
      legacyBtnJump.style.display = 'inline-flex';
      legacyTagEl.textContent = globalRec.tag;
      legacyTitleEl.textContent = globalRec.title;
      if (legacySubtitleEl) legacySubtitleEl.textContent = globalRec.subtitle;
      legacyBtnJump.onclick = () => {
        if (globalRec.depth === 1) {
          historyStack = ['root', 'tech', globalRec.node.id];
        } else if (globalRec.depth === 2) {
          historyStack = ['root', 'tech', globalRec.parent.id, globalRec.node.id];
        }
        renderCurrentView('forward');
      };
    }
  }

  function updateOverallProgress() {
    const progressFill = document.getElementById('overall-progress-fill');
    const progressText = document.getElementById('overall-progress-text');
    const progressPill = document.getElementById('overall-progress-pill');

    let total = 0;
    let completed = 0;

    Object.keys(graphManifest).forEach(id => {
      if (id === 'root') return;
      total++;
      if (getNodeStatus(id) === 'completed') {
        completed++;
      }
    });

    if (total === 0) {
      PARALLEL_TRACKS.forEach(tid => {
        total++;
        if (getNodeStatus(tid) === 'completed') completed++;
      });
    }

    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    if (progressFill) progressFill.style.width = percent + '%';
    if (progressText) progressText.textContent = `${percent}%`;
    if (progressPill) progressPill.title = `${completed}/${total} Stations Completed (${percent}%)`;
  }

  // 5. Breadcrumbs & Unified Navigation
  // ---------------------------------------------------------------------------

  let isNavigating = false;

  function renderHeaderAndBreadcrumbs() {
    const breadcrumbsEl = document.getElementById('breadcrumbs');
    const backBtnEl = document.getElementById('btn-back');
    const logoEl = document.getElementById('logo');

    if (logoEl) {
      logoEl.onclick = () => {
        if (historyStack.length > 1) {
          navigateBack(['root']);
        }
      };
    }

    if (breadcrumbsEl) {
      breadcrumbsEl.innerHTML = '';
      historyStack.forEach((id, index) => {
        const node = getNode(id);
        const title = node ? node.title : id;
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
            if (index < historyStack.length - 1) {
              navigateBack(historyStack.slice(0, index + 1));
            }
          };
        }
        breadcrumbsEl.appendChild(item);
      });
    }

    if (backBtnEl) {
      backBtnEl.style.display = historyStack.length > 1 ? 'inline-flex' : 'none';
      backBtnEl.onclick = () => {
        if (historyStack.length > 1) {
          navigateBack();
        }
      };
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Local Graph Canvas, Splitting Animation & SVG Connectors
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

  function drillDownToChild(childId, childEl) {
    if (isNavigating) return;
    isNavigating = true;

    const parentCard = document.querySelector('.graph-parent-card');
    const allChildNodes = document.querySelectorAll('.graph-child-node');
    const svgEl = document.getElementById('graph-svg');

    if (!parentCard || !childEl) {
      historyStack.push(childId);
      renderCurrentView('forward');
      isNavigating = false;
      return;
    }

    const pRect = parentCard.getBoundingClientRect();
    const cRect = childEl.getBoundingClientRect();
    const deltaX = (pRect.left + pRect.width / 2) - (cRect.left + cRect.width / 2);
    const deltaY = (pRect.top + pRect.height / 2) - (cRect.top + cRect.height / 2);

    if (svgEl) svgEl.classList.add('svg-fading');
    parentCard.classList.add('node-parent-exiting');

    allChildNodes.forEach(node => {
      if (node === childEl) {
        node.classList.add('node-drilling-target');
        node.style.transform = `translate(${deltaX.toFixed(1)}px, ${deltaY.toFixed(1)}px) scale(1.12)`;
      } else {
        node.classList.add('node-sibling-fading');
      }
    });

    setTimeout(() => {
      historyStack.push(childId);
      renderCurrentView('forward');
      isNavigating = false;
    }, 320);
  }

  function navigateBack(targetStack = null) {
    if (isNavigating) return;
    if (historyStack.length <= 1 && !targetStack) return;
    isNavigating = true;

    const parentCard = document.querySelector('.graph-parent-card');
    const allChildNodes = document.querySelectorAll('.graph-child-node');
    const svgEl = document.getElementById('graph-svg');

    if (svgEl) svgEl.classList.add('svg-fading');
    if (parentCard) parentCard.classList.add('node-parent-collapsing');

    allChildNodes.forEach(node => {
      node.classList.add('node-children-collapsing');
    });

    setTimeout(() => {
      if (targetStack) {
        historyStack = targetStack;
      } else {
        historyStack.pop();
      }
      renderCurrentView('back');
      isNavigating = false;
    }, 220);
  }

  function renderCurrentView(direction = 'none') {
    renderHeaderAndBreadcrumbs();
    updateNextUpBanner();

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

    activeNode = currentNode;
    const currentStatus = getNodeStatus(currentId);

    // 1. Render Active Parent Node Card
    parentAnchor.innerHTML = `
      <div class="graph-parent-card">
        <div class="graph-parent-top-row">
          <button class="btn-status-cycle status-${currentStatus}" id="btn-status-toggle" title="Click to cycle status: To Do → In Progress → Completed">
            ${currentStatus === 'completed' ? '● Done' : (currentStatus === 'in-progress' ? '◐ In Progress' : '○ To Do')}
          </button>
        </div>
        <div class="graph-parent-title">${currentNode.title}</div>
        <div class="graph-parent-actions">
          <button class="btn-graph-action btn-graph-summary" id="btn-parent-summary" title="View and edit Markdown notes">
            📝 Summary
          </button>
          <button class="btn-graph-action btn-graph-info" id="btn-parent-info" title="Inspect mental models and resources">
            ℹ️ Info
          </button>
        </div>
      </div>
    `;

    // Bind Status Toggle
    const statusToggleBtn = document.getElementById('btn-status-toggle');
    if (statusToggleBtn) {
      statusToggleBtn.onclick = () => {
        const nextMap = { 'todo': 'in-progress', 'in-progress': 'completed', 'completed': 'todo' };
        const nextStatus = nextMap[currentStatus] || 'todo';
        setNodeStatus(currentId, nextStatus);
      };
    }

    // Bind Summary & Info buttons
    const btnSummary = document.getElementById('btn-parent-summary');
    if (btnSummary) btnSummary.onclick = () => openSummaryModal(currentId);

    const btnInfo = document.getElementById('btn-parent-info');
    if (btnInfo) btnInfo.onclick = () => openInfoDrawer(currentId);

    // 2. Render Children or Leaf Dock
    childrenAnchor.innerHTML = '';
    const children = currentNode.children || [];

    if (children.length === 0) {
      // Leaf Node Presentation
      const nextSibling = getNextSiblingNode(currentId);
      let nextBtnHtml = '';
      if (nextSibling) {
        nextBtnHtml = `
          <button class="btn-leaf-action btn-leaf-next" id="btn-leaf-next">
            ➔ Next: ${nextSibling.title}
          </button>
        `;
      }

      const leafDock = document.createElement('div');
      leafDock.className = 'leaf-dock';
      leafDock.innerHTML = `
        <button class="btn-leaf-action btn-graph-summary" id="btn-leaf-summary">
          📝 Notes & Code
        </button>
        <button class="btn-leaf-action ${currentStatus === 'completed' ? 'btn-leaf-action' : 'btn-leaf-complete'}" id="btn-leaf-toggle">
          ${currentStatus === 'completed' ? '✓ Completed' : '✓ Mark Complete'}
        </button>
        ${nextBtnHtml}
        <button class="btn-leaf-action btn-leaf-expand" id="btn-leaf-expand" title="Create and expand sub-stations on disk">
          ➕ Expand Sub-stations
        </button>
      `;

      childrenAnchor.appendChild(leafDock);

      const leafSumBtn = document.getElementById('btn-leaf-summary');
      if (leafSumBtn) leafSumBtn.onclick = () => openSummaryModal(currentId);

      const leafTogBtn = document.getElementById('btn-leaf-toggle');
      if (leafTogBtn) {
        leafTogBtn.onclick = () => {
          const next = currentStatus === 'completed' ? 'in-progress' : 'completed';
          setNodeStatus(currentId, next);
        };
      }

      const leafExpBtn = document.getElementById('btn-leaf-expand');
      if (leafExpBtn) leafExpBtn.onclick = () => expandNodeChildren(currentId);

      const leafNextBtn = document.getElementById('btn-leaf-next');
      if (leafNextBtn && nextSibling) {
        leafNextBtn.onclick = () => {
          const nextStack = historyStack.slice(0, -1);
          nextStack.push(nextSibling.id);
          historyStack = nextStack;
          renderCurrentView('forward');
        };
      }

      if (svgEl) svgEl.innerHTML = '';
      return;
    }

    // Branch Hub: Render Immediate Child Stations
    let firstUncompletedFound = false;
    const childEls = [];

    children.forEach((childId, index) => {
      const childNode = getNode(childId);
      if (!childNode) return;

      const childStatus = getNodeStatus(childId);
      const isNextInBranch = (!firstUncompletedFound && childStatus !== 'completed');
      if (isNextInBranch) firstUncompletedFound = true;

      const nodeEl = document.createElement('div');
      nodeEl.className = `graph-child-node ${isNextInBranch ? 'next-target' : ''} ${direction === 'forward' ? 'spawning' : ''}`;
      nodeEl.dataset.status = childStatus;
      nodeEl.dataset.id = childId;

      const dotClass = childStatus === 'completed' ? 'completed' : (childStatus === 'in-progress' ? 'in-progress' : 'todo');
      const subCount = childNode.children ? childNode.children.length : 0;
      const branchHtml = subCount > 0 ? `<span class="child-branch-indicator" title="${subCount} sub-stations">⑂ ${subCount}</span>` : '';
      const nextTag = isNextInBranch ? `<span class="next-tag-chip">Next</span>` : '';

      nodeEl.innerHTML = `
        <span class="child-status-dot ${dotClass}"></span>
        <span class="child-index">${String(index + 1).padStart(2, '0')}</span>
        <span class="child-node-title" title="${childNode.title}">${childNode.title}</span>
        ${branchHtml}
        ${nextTag}
      `;

      nodeEl.onclick = () => drillDownToChild(childId, nodeEl);

      childrenAnchor.appendChild(nodeEl);
      childEls.push(nodeEl);
    });

    // Splitting Animation (organic fan out from parent)
    if (direction === 'forward') {
      requestAnimationFrame(() => {
        childEls.forEach((el, i) => {
          setTimeout(() => {
            el.classList.remove('spawning');
            el.classList.add('spawned');
          }, i * 45);
        });
      });
    }

    // Draw SVG Connector Lines after layout stabilizes
    setTimeout(() => {
      drawConnectorLines();
    }, direction === 'forward' ? (childEls.length * 45 + 100) : 30);
  }

  window.addEventListener('resize', () => {
    requestAnimationFrame(drawConnectorLines);
  });

  // 6C. Just-in-Time Child Expansion
  // ---------------------------------------------------------------------------

  async function expandNodeChildren(nodeId) {
    if (!isServerConnected) {
      alert('Local Python server must be running to expand folders on disk. Run run.bat first.');
      return;
    }

    const relPath = getNodeRelPath(nodeId);

    try {
      const res = await fetch('/api/expand-node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: relPath })
      });

      if (res.ok) {
        const statuses = getSavedStatuses();
        statuses[nodeId] = 'in-progress';
        localStorage.setItem(STORAGE_STATUS_KEY, JSON.stringify(statuses));

        await checkServerConnection();
        renderCurrentView();
        updateNextUpBanner();
        updateOverallProgress();
      } else {
        const err = await res.json();
        alert(`Expansion error: ${err.error || 'Failed to expand'}`);
      }
    } catch (e) {
      console.error('Error expanding children:', e);
      alert('Failed to connect to local server for expansion.');
    }
  }

  // ---------------------------------------------------------------------------
  // 7. Side Drawer: Node Info & Details
  // ---------------------------------------------------------------------------

  function openInfoDrawer(nodeId) {
    const node = getNode(nodeId);
    if (!node) return;

    const overlay = document.getElementById('drawer-overlay');
    const drawer = document.getElementById('drawer');
    const titleEl = document.getElementById('drawer-title');
    const contentEl = document.getElementById('drawer-body-content');

    titleEl.textContent = node.title;

    const currentStatus = getNodeStatus(nodeId);
    updateDrawerStatusButtons(currentStatus);

    let html = '';

    const relPath = getNodeRelPath(nodeId);
    html += `
      <div>
        <div class="drawer-section-title">Graph File Location</div>
        <div style="font-family: var(--font-mono); font-size: 0.8rem; background: var(--bg-card); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border); color: var(--text-secondary);">
          graph/${relPath || '(root)'}
        </div>
      </div>
    `;

    if (node.concept) {
      html += `
        <div>
          <div class="drawer-section-title">Core Mental Model</div>
          <div class="concept-box">${node.concept}</div>
        </div>
      `;
    }

    if (node.activeRecall) {
      html += `
        <div>
          <div class="drawer-section-title">Active Recall Check</div>
          <div class="recall-box">💡 ${node.activeRecall}</div>
        </div>
      `;
    }

    if (node.resources && node.resources.length > 0) {
      html += `
        <div>
          <div class="drawer-section-title">Curated Resources</div>
          <ul class="resource-list">
            ${node.resources.map(r => `
              <li class="resource-item">
                <a href="${r.url}" target="_blank" rel="noopener noreferrer">${r.label} ↗</a>
              </li>
            `).join('')}
          </ul>
        </div>
      `;
    }

    contentEl.innerHTML = html;

    overlay.classList.add('open');
    drawer.classList.add('open');
  }

  function closeInfoDrawer() {
    document.getElementById('drawer-overlay').classList.remove('open');
    document.getElementById('drawer').classList.remove('open');
  }

  function updateDrawerStatusButtons(status) {
    const btnTodo = document.getElementById('btn-status-todo');
    const btnInProg = document.getElementById('btn-status-inprogress');
    const btnComp = document.getElementById('btn-status-completed');

    [btnTodo, btnInProg, btnComp].forEach(b => {
      b.className = 'btn-status';
    });

    if (status === 'completed') {
      btnComp.classList.add('active-completed');
    } else if (status === 'in-progress') {
      btnInProg.classList.add('active-in-progress');
    } else {
      btnTodo.classList.add('active-todo');
    }
  }

  // ---------------------------------------------------------------------------
  // 8. Summary Modal: Rich Markdown View & Disk Editor
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
        console.warn('Failed to load summary from server, trying cache:', e);
      }
    }

    if (!content) {
      const cache = getSavedNotesCache();
      content = cache[nodeId] || `# ${node.title}\n\n> Add your personal engineering notes, code snippets, and formulas here.\n`;
    }

    currentSummaryContent = content;
    textarea.value = content;
    saveStatusEl.textContent = isServerConnected ? 'Synced with disk' : 'Local cache mode';

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
    const previewEl = document.getElementById('summary-rendered-view');

    const content = textarea.value;
    const relPath = getNodeRelPath(currentId);

    saveStatusEl.textContent = 'Saving to disk...';

    const cache = getSavedNotesCache();
    cache[currentId] = content;
    localStorage.setItem(STORAGE_NOTES_CACHE, JSON.stringify(cache));

    if (isServerConnected) {
      try {
        const res = await fetch('/api/save-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: relPath, content: content })
        });

        if (res.ok) {
          saveStatusEl.textContent = `Saved to disk at graph/${relPath}/summary.md ✓`;
          const badge = document.getElementById('header-summary-badge');
          if (badge) {
            badge.textContent = 'Disk Synced ✓';
            badge.style.color = 'var(--accent-green-text)';
          }
        } else {
          saveStatusEl.textContent = 'Server error during save';
        }
      } catch (err) {
        saveStatusEl.textContent = 'Network error saving to disk';
        console.error('Error saving summary to server:', err);
      }
    } else {
      saveStatusEl.textContent = 'Saved to browser local storage ✓';
    }

    renderMarkdownContent(content, previewEl);
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
  // 9. Server Discovery & Initialization
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
        pill.title = `Serving ${data.count} nodes from D:\\Career Roadmap\\graph`;

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
    pill.title = 'Run "run.bat" or "python server.py" for live disk synchronization.';
    return false;
  }

  // ---------------------------------------------------------------------------
  // 10. Event Listeners & Bootstrapping
  // ---------------------------------------------------------------------------

  function setupEventListeners() {
    const logo = document.getElementById('logo');
    if (logo) {
      logo.onclick = () => {
        if (historyStack.length > 1) {
          navigateBack(['root']);
        }
      };
    }

    const drawerClose = document.getElementById('drawer-close');
    if (drawerClose) drawerClose.onclick = closeInfoDrawer;

    const drawerOverlay = document.getElementById('drawer-overlay');
    if (drawerOverlay) drawerOverlay.onclick = closeInfoDrawer;

    ['todo', 'inprogress', 'completed'].forEach(stKey => {
      const val = stKey === 'inprogress' ? 'in-progress' : stKey;
      const btn = document.getElementById(`btn-status-${stKey}`);
      if (btn) {
        btn.onclick = () => {
          const currentId = historyStack[historyStack.length - 1];
          setNodeStatus(currentId, val);
        };
      }
    });

    const btnTabPrev = document.getElementById('btn-tab-preview');
    if (btnTabPrev) btnTabPrev.onclick = () => switchSummaryTab('preview');

    const btnTabEdit = document.getElementById('btn-tab-edit');
    if (btnTabEdit) btnTabEdit.onclick = () => switchSummaryTab('edit');

    const btnSave = document.getElementById('btn-save-summary');
    if (btnSave) btnSave.onclick = saveSummaryToDisk;

    const btnClose = document.getElementById('btn-close-summary');
    if (btnClose) btnClose.onclick = closeSummaryModal;

    const btnDone = document.getElementById('btn-summary-done');
    if (btnDone) btnDone.onclick = closeSummaryModal;

    const modalOverlay = document.getElementById('summary-modal-overlay');
    if (modalOverlay) {
      modalOverlay.onclick = (e) => {
        if (e.target.id === 'summary-modal-overlay') closeSummaryModal();
      };
    }

    document.querySelectorAll('.btn-tool').forEach(btn => {
      btn.onclick = () => insertEditorFormatting(btn.getAttribute('data-tool'));
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        const overlay = document.getElementById('summary-modal-overlay');
        if (overlay && overlay.classList.contains('open')) {
          e.preventDefault();
          saveSummaryToDisk();
        }
      }
    });
  }

  async function init() {
    setupEventListeners();
    await checkServerConnection();
    renderCurrentView();
    updateOverallProgress();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
