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
      return graphManifest[nodeId].metadata;
    }
    if (window.RoadmapRegistry && window.RoadmapRegistry[nodeId]) {
      return window.RoadmapRegistry[nodeId];
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
    const tagEl = document.getElementById('next-up-tag');
    const titleEl = document.getElementById('next-up-title');
    const subtitleEl = document.getElementById('next-up-subtitle');
    const btnJump = document.getElementById('btn-jump-next');

    const currentId = historyStack[historyStack.length - 1];
    const isMacroView = (currentId === 'root' || currentId === 'tech');

    // 1. Try local context first if inside a specific branch
    const localRec = !isMacroView ? getLocalContextRecommendation() : null;
    const globalRec = getGlobalBFSRecommendation();

    if (localRec && !localRec.allDone) {
      // Local context active
      btnJump.style.display = 'inline-flex';
      tagEl.textContent = localRec.tag;
      tagEl.style.background = 'var(--accent-blue)';
      titleEl.textContent = localRec.title;
      subtitleEl.textContent = localRec.subtitle;
      btnJump.textContent = '➔ Next Station';

      btnJump.onclick = () => {
        if (localRec.targetStack) {
          historyStack = localRec.targetStack;
        } else {
          historyStack.push(localRec.node.id);
        }
        renderCurrentView();
      };
      return;
    }

    // 2. Global BFS queue fallback
    if (!globalRec) {
      tagEl.textContent = 'MASTERED';
      tagEl.style.background = 'var(--accent-green-text)';
      titleEl.textContent = 'All Available Stations Completed!';
      subtitleEl.textContent = '';
      btnJump.style.display = 'none';
      return;
    }

    btnJump.style.display = 'inline-flex';
    tagEl.textContent = globalRec.tag;
    tagEl.style.background = globalRec.depth === 1 ? 'var(--accent-blue)' : 'var(--accent-purple)';
    titleEl.textContent = globalRec.title;
    subtitleEl.textContent = globalRec.subtitle;
    btnJump.textContent = '➔ Jump to Station';

    btnJump.onclick = () => {
      if (globalRec.depth === 1) {
        historyStack = ['root', 'tech', globalRec.node.id];
      } else if (globalRec.depth === 2) {
        historyStack = ['root', 'tech', globalRec.parent.id, globalRec.node.id];
      }
      renderCurrentView();
    };
  }

  // ---------------------------------------------------------------------------
  // 4. Overall Progress Calculation
  // ---------------------------------------------------------------------------

  function updateOverallProgress() {
    const progressFill = document.getElementById('overall-progress-fill');
    const progressText = document.getElementById('overall-progress-text');

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
    progressFill.style.width = percent + '%';
    progressText.textContent = `${percent}% (${completed}/${total} Stations Completed)`;
  }

  // ---------------------------------------------------------------------------
  // 5. Breadcrumbs & Header Rendering
  // ---------------------------------------------------------------------------

  function renderHeaderAndBreadcrumbs() {
    const breadcrumbsEl = document.getElementById('breadcrumbs');
    const backBtnEl = document.getElementById('btn-back');

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
          historyStack = historyStack.slice(0, index + 1);
          renderCurrentView();
        };
      }
      breadcrumbsEl.appendChild(item);
    });

    backBtnEl.style.display = historyStack.length > 1 ? 'inline-flex' : 'none';
    backBtnEl.onclick = () => {
      if (historyStack.length > 1) {
        historyStack.pop();
        renderCurrentView();
      }
    };
  }

  // ---------------------------------------------------------------------------
  // 6. View Rendering (Node View + Child Roads or Macro Swimlanes)
  // ---------------------------------------------------------------------------

  function renderCurrentView() {
    renderHeaderAndBreadcrumbs();
    updateNextUpBanner();

    const currentNode = getCurrentNode();
    const currentId = historyStack[historyStack.length - 1];

    const titleEl = document.getElementById('node-title');
    const descEl = document.getElementById('node-desc');
    const badgesGroupEl = document.getElementById('node-badges');
    const viewToggleEl = document.getElementById('view-mode-toggle');
    const selectQuickStatus = document.getElementById('select-quick-status');
    const container = document.getElementById('roadmap-container');
    const roadsHeaderTitle = document.getElementById('child-roads-title');
    const roadsHeaderCount = document.getElementById('child-roads-count');

    if (!currentNode) {
      titleEl.textContent = 'Node Initializing';
      descEl.textContent = 'Loading graph station details...';
      container.innerHTML = '<p style="color: var(--text-muted); padding: 20px;">Fetching node metadata...</p>';
      return;
    }

    activeNode = currentNode;
    titleEl.textContent = currentNode.title;
    descEl.textContent = currentNode.description || '';

    // Badges
    const status = getNodeStatus(currentId);
    badgesGroupEl.innerHTML = '';

    const depthBadge = document.createElement('span');
    depthBadge.className = 'badge-pill depth';
    depthBadge.textContent = `d=${currentNode.depth !== undefined ? currentNode.depth : (historyStack.length - 1)}`;
    badgesGroupEl.appendChild(depthBadge);

    if (currentNode.badge) {
      const badgePill = document.createElement('span');
      badgePill.className = 'badge-pill';
      badgePill.textContent = currentNode.badge;
      badgesGroupEl.appendChild(badgePill);
    }

    const statusBadge = document.createElement('span');
    statusBadge.className = `badge-pill status-${status}`;
    const statusLabels = { 'todo': 'To Do', 'in-progress': 'In Progress', 'completed': 'Done ✓' };
    statusBadge.textContent = statusLabels[status] || status;
    badgesGroupEl.appendChild(statusBadge);

    // Quick Status Select
    if (selectQuickStatus) {
      selectQuickStatus.value = status;
      selectQuickStatus.onchange = (e) => {
        setNodeStatus(currentId, e.target.value);
      };
    }

    if (currentId === 'tech') {
      viewToggleEl.style.display = 'flex';
      document.getElementById('btn-view-swimlanes').className = `btn-toggle ${viewMode === 'swimlanes' ? 'active' : ''}`;
      document.getElementById('btn-view-road').className = `btn-toggle ${viewMode === 'road' ? 'active' : ''}`;
    } else {
      viewToggleEl.style.display = 'none';
    }

    container.innerHTML = '';

    if (currentId === 'tech' && viewMode === 'swimlanes') {
      roadsHeaderTitle.textContent = 'Parallel Track Swimlanes';
      roadsHeaderCount.textContent = '4 Tracks + Fusion';
      renderMacroSwimlanes(container);
      return;
    }

    renderChildRoads(currentNode, container);
  }

  // ---------------------------------------------------------------------------
  // 6A. Macro Swimlanes (Parallel Tracks side-by-side)
  // ---------------------------------------------------------------------------

  function renderMacroSwimlanes(container) {
    const swimlanesDiv = document.createElement('div');
    swimlanesDiv.className = 'macro-swimlanes-container';

    const gridDiv = document.createElement('div');
    gridDiv.className = 'parallel-tracks-grid';

    const trackKeys = ['core-cs', 'swe', 'data', 'ai'];

    trackKeys.forEach(trackId => {
      const trackNode = getNode(trackId);
      if (!trackNode) return;

      const trackStatus = getNodeStatus(trackId);
      const laneDiv = document.createElement('div');
      laneDiv.className = 'track-lane';

      const headerDiv = document.createElement('div');
      headerDiv.className = 'track-lane-header';
      headerDiv.title = `Click to drill down into ${trackNode.title}`;
      headerDiv.onclick = () => {
        historyStack.push(trackId);
        renderCurrentView();
      };

      const titleEl = document.createElement('div');
      titleEl.className = 'track-lane-title';
      titleEl.textContent = trackNode.title;

      const statusEl = document.createElement('div');
      statusEl.className = 'track-lane-progress';
      const statusText = trackStatus === 'completed' ? 'Done ✓' : (trackStatus === 'in-progress' ? 'In Progress ⏳' : 'To Do');
      statusEl.textContent = statusText;

      headerDiv.appendChild(titleEl);
      headerDiv.appendChild(statusEl);
      laneDiv.appendChild(headerDiv);

      const modulesDiv = document.createElement('div');
      modulesDiv.className = 'track-lane-modules';

      const childIds = trackNode.children || [];
      if (childIds.length === 0) {
        const emptyHint = document.createElement('div');
        emptyHint.style.fontSize = '0.78rem';
        emptyHint.style.color = 'var(--text-muted)';
        emptyHint.style.padding = '8px 4px';
        emptyHint.textContent = trackStatus === 'completed' ? '✓ Done (Ready to expand)' : '0 child stations';
        modulesDiv.appendChild(emptyHint);
      } else {
        childIds.forEach(cid => {
          const childNode = getNode(cid);
          if (!childNode) return;

          const cstatus = getNodeStatus(cid);
          const pill = document.createElement('div');
          pill.className = `module-pill status-${cstatus}`;
          pill.title = childNode.description || '';

          const mTitle = document.createElement('span');
          mTitle.className = 'module-pill-title';
          mTitle.textContent = childNode.title;

          const mBadge = document.createElement('span');
          mBadge.className = 'module-pill-badge';
          mBadge.textContent = `${childNode.badge || ''} • ${cstatus.toUpperCase()}`;

          pill.appendChild(mTitle);
          pill.appendChild(mBadge);

          pill.onclick = () => {
            historyStack.push(trackId);
            historyStack.push(cid);
            renderCurrentView();
          };

          modulesDiv.appendChild(pill);
        });
      }

      laneDiv.appendChild(modulesDiv);
      gridDiv.appendChild(laneDiv);
    });

    swimlanesDiv.appendChild(gridDiv);

    const fusionNode = getNode('fusion');
    if (fusionNode) {
      const fusionDiv = document.createElement('div');
      fusionDiv.className = 'macro-fusion-banner';

      const fHeader = document.createElement('div');
      fHeader.className = 'fusion-banner-header';

      const fTitle = document.createElement('div');
      fTitle.className = 'fusion-banner-title';
      fTitle.innerHTML = '<span>⚡</span> Milestone Cross-Domain Fusion Projects';

      const fAction = document.createElement('button');
      fAction.className = 'btn-secondary';
      fAction.textContent = 'Explore Fusion Track →';
      fAction.onclick = () => {
        historyStack.push('fusion');
        renderCurrentView();
      };

      fHeader.appendChild(fTitle);
      fHeader.appendChild(fAction);
      fusionDiv.appendChild(fHeader);

      swimlanesDiv.appendChild(fusionDiv);
    }

    container.appendChild(swimlanesDiv);
  }

  // ---------------------------------------------------------------------------
  // 6B. Recursive Child Road View & Leaf Node Learning Presentation
  // ---------------------------------------------------------------------------

  function renderChildRoads(currentNode, container) {
    const currentId = historyStack[historyStack.length - 1];
    const roadsHeaderTitle = document.getElementById('child-roads-title');
    const roadsHeaderCount = document.getElementById('child-roads-count');

    const children = currentNode.children || [];
    const currentStatus = getNodeStatus(currentId);

    if (children.length === 0) {
      roadsHeaderTitle.textContent = 'Sub-stations';
      roadsHeaderCount.textContent = '0';

      const leafDiv = document.createElement('div');
      leafDiv.className = 'leaf-station-banner compact';

      const nextSibling = getNextSiblingNode(currentId);
      let nextBtnHtml = '';
      if (nextSibling) {
        nextBtnHtml = `
          <button class="btn-node-action btn-action-next-sibling" id="btn-next-sibling">
            ➔ Next: ${nextSibling.title}
          </button>
        `;
      }

      if (currentStatus === 'completed') {
        leafDiv.innerHTML = `
          <div class="leaf-compact-row">
            <span class="leaf-status-indicator done">✓ Completed</span>
            <div style="display: flex; gap: 8px; align-items: center;">
              ${nextBtnHtml}
              <button class="btn-node-action btn-action-expand" id="btn-expand-children">
                ➕ Expand Child Stations
              </button>
            </div>
          </div>
        `;
      } else {
        leafDiv.innerHTML = `
          <div class="leaf-compact-row">
            <span class="leaf-status-indicator">Leaf Station</span>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button class="btn-node-action btn-action-summary" id="btn-leaf-open-summary">
                📝 Notes
              </button>
              <button class="btn-node-action btn-action-complete" id="btn-leaf-mark-done">
                ✓ Mark Done
              </button>
              ${nextBtnHtml}
            </div>
          </div>
        `;
      }

      container.appendChild(leafDiv);

      const leafSummaryBtn = document.getElementById('btn-leaf-open-summary');
      if (leafSummaryBtn) leafSummaryBtn.onclick = () => openSummaryModal(currentId);

      const leafDoneBtn = document.getElementById('btn-leaf-mark-done');
      if (leafDoneBtn) leafDoneBtn.onclick = () => setNodeStatus(currentId, 'completed');

      const expandBtn = document.getElementById('btn-expand-children');
      if (expandBtn) expandBtn.onclick = () => expandNodeChildren(currentId);

      const nextSibBtn = document.getElementById('btn-next-sibling');
      if (nextSibBtn && nextSibling) {
        nextSibBtn.onclick = () => {
          const nextStack = historyStack.slice(0, -1);
          nextStack.push(nextSibling.id);
          historyStack = nextStack;
          renderCurrentView();
        };
      }
      return;
    }

    // Branch Hub Presentation: Has Children
    roadsHeaderTitle.textContent = 'Child Stations';
    roadsHeaderCount.textContent = `${children.length}`;

    const roadLine = document.createElement('div');
    roadLine.className = 'road-line';

    const trackLine = document.createElement('div');
    trackLine.className = 'road-track';
    roadLine.appendChild(trackLine);

    // Identify first uncompleted child for contextual emphasis
    let firstUncompletedFound = false;

    children.forEach((childId, index) => {
      const childNode = getNode(childId);
      if (!childNode) return;

      const childStatus = getNodeStatus(childId);
      const isNextInBranch = (!firstUncompletedFound && childStatus !== 'completed');
      if (isNextInBranch) firstUncompletedFound = true;

      const stationEl = document.createElement('div');
      stationEl.className = `station status-${childStatus} ${isNextInBranch ? 'next-in-branch' : ''}`;

      const nodeEl = document.createElement('div');
      nodeEl.className = 'station-node';
      nodeEl.title = `Station ${index + 1}: ${childStatus.toUpperCase()}`;

      const cardEl = document.createElement('div');
      cardEl.className = 'station-card';

      const headerEl = document.createElement('div');
      headerEl.className = 'station-card-header';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'station-title';
      titleSpan.textContent = `${String(index + 1).padStart(2, '0')}. ${childNode.title}`;

      const badgesGroup = document.createElement('div');
      badgesGroup.className = 'station-badges-group';

      if (isNextInBranch) {
        const nextBadge = document.createElement('span');
        nextBadge.className = 'station-badge priority';
        nextBadge.textContent = '👉 Next';
        badgesGroup.appendChild(nextBadge);
      }

      if (childNode.badge) {
        const badgeSpan = document.createElement('span');
        badgeSpan.className = 'station-badge';
        badgeSpan.textContent = childNode.badge;
        badgesGroup.appendChild(badgeSpan);
      }

      const statusBadge = document.createElement('span');
      statusBadge.className = `station-badge status-${childStatus}`;
      const statusLabel = childStatus === 'completed' ? 'Done ✓' : (childStatus === 'in-progress' ? 'In Progress' : 'To Do');
      statusBadge.textContent = statusLabel;
      badgesGroup.appendChild(statusBadge);

      headerEl.appendChild(titleSpan);
      headerEl.appendChild(badgesGroup);
      cardEl.appendChild(headerEl);

      if (childNode.description) {
        const descP = document.createElement('p');
        descP.className = 'station-desc';
        descP.textContent = childNode.description;
        cardEl.appendChild(descP);
      }

      const footerEl = document.createElement('div');
      footerEl.className = 'station-footer';

      const childCountSpan = document.createElement('span');
      const subCount = childNode.children ? childNode.children.length : 0;
      childCountSpan.textContent = subCount > 0 ? `${subCount} Sub-stations` : 'Leaf Station';

      const actionSpan = document.createElement('span');
      actionSpan.className = 'station-action-hint';
      actionSpan.textContent = isNextInBranch ? 'Continue here ➔' : 'Explore station ➔';

      footerEl.appendChild(childCountSpan);
      footerEl.appendChild(actionSpan);
      cardEl.appendChild(footerEl);

      cardEl.onclick = () => {
        historyStack.push(childId);
        renderCurrentView();
      };

      stationEl.appendChild(nodeEl);
      stationEl.appendChild(cardEl);
      roadLine.appendChild(stationEl);
    });

    container.appendChild(roadLine);
  }

  // ---------------------------------------------------------------------------
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
        pill.className = 'server-badge connected';
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
    pill.className = 'server-badge offline';
    pill.title = 'Run "run.bat" or "python server.py" for live disk synchronization.';
    return false;
  }

  // ---------------------------------------------------------------------------
  // 10. Event Listeners & Bootstrapping
  // ---------------------------------------------------------------------------

  function setupEventListeners() {
    document.getElementById('logo').onclick = () => {
      historyStack = ['root', 'tech'];
      renderCurrentView();
    };

    document.getElementById('btn-open-info').onclick = () => {
      const currentId = historyStack[historyStack.length - 1];
      openInfoDrawer(currentId);
    };

    document.getElementById('btn-open-summary').onclick = () => {
      const currentId = historyStack[historyStack.length - 1];
      openSummaryModal(currentId);
    };

    document.getElementById('drawer-close').onclick = closeInfoDrawer;
    document.getElementById('drawer-overlay').onclick = closeInfoDrawer;

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

    document.getElementById('btn-tab-preview').onclick = () => switchSummaryTab('preview');
    document.getElementById('btn-tab-edit').onclick = () => switchSummaryTab('edit');
    document.getElementById('btn-save-summary').onclick = saveSummaryToDisk;
    document.getElementById('btn-close-summary').onclick = closeSummaryModal;
    document.getElementById('btn-summary-done').onclick = closeSummaryModal;
    document.getElementById('summary-modal-overlay').onclick = (e) => {
      if (e.target.id === 'summary-modal-overlay') closeSummaryModal();
    };

    document.querySelectorAll('.btn-tool').forEach(btn => {
      btn.onclick = () => insertEditorFormatting(btn.getAttribute('data-tool'));
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        const overlay = document.getElementById('summary-modal-overlay');
        if (overlay.classList.contains('open')) {
          e.preventDefault();
          saveSummaryToDisk();
        }
      }
    });

    document.getElementById('btn-view-swimlanes').onclick = () => {
      viewMode = 'swimlanes';
      renderCurrentView();
    };
    document.getElementById('btn-view-road').onclick = () => {
      viewMode = 'road';
      renderCurrentView();
    };
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
