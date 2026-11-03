/**
 * Career Knowledge Graph Engine
 * Directory-as-Graph + BFS Traversal Engine + Live Disk Sync (Python 3.14)
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
  let debounceTimeout = null;

  // The 4 Parallel Tracks + Fusion
  const PARALLEL_TRACKS = ['core-cs', 'swe', 'data', 'ai', 'fusion'];

  // ---------------------------------------------------------------------------
  // 1. Persistence & Status Helpers
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

    // Check if status is present in node metadata
    const node = getNode(nodeId);
    if (node && node.status) return node.status;
    return 'todo';
  }

  async function setNodeStatus(nodeId, status) {
    const statuses = getSavedStatuses();
    statuses[nodeId] = status;
    localStorage.setItem(STORAGE_STATUS_KEY, JSON.stringify(statuses));

    const node = getNode(nodeId);
    if (node) {
      node.status = status;
    }

    // If connected to local server, save to node.json on disk
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

    renderCurrentView();
    updateNextUpBanner();
    updateOverallProgress();

    // Update status UI controls if open
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
    // Fallback to RoadmapRegistry if available
    if (window.RoadmapRegistry && window.RoadmapRegistry[nodeId]) {
      return window.RoadmapRegistry[nodeId];
    }
    return null;
  }

  function getNodeRelPath(nodeId) {
    if (graphManifest[nodeId] && typeof graphManifest[nodeId].relPath === 'string') {
      return graphManifest[nodeId].relPath;
    }
    // Fallback mapping
    const map = {
      'root': '',
      'tech': 'tech',
      'freelancing': 'freelancing',
      'marketing': 'marketing',
      'core-cs': 'tech/core-cs',
      'swe': 'tech/swe',
      'data': 'tech/data',
      'ai': 'tech/ai',
      'fusion': 'tech/fusion',
      // Depth 2
      'algo-ds': 'tech/core-cs/algo-ds',
      'systems-os': 'tech/core-cs/systems-os',
      'networking': 'tech/core-cs/networking',
      'craftsmanship': 'tech/core-cs/craftsmanship',
      'swe-backend': 'tech/swe/swe-backend',
      'swe-databases': 'tech/swe/swe-databases',
      'swe-devops': 'tech/swe/swe-devops',
      'swe-sysdesign': 'tech/swe/swe-sysdesign',
      'data-analytics': 'tech/data/data-analytics',
      'data-warehousing': 'tech/data/data-warehousing',
      'data-pipelines': 'tech/data/data-pipelines',
      'data-bigdata': 'tech/data/data-bigdata',
      'ai-classical': 'tech/ai/ai-classical',
      'ai-deeplearning': 'tech/ai/ai-deeplearning',
      'ai-nlp-cv': 'tech/ai/ai-nlp-cv',
      'ai-genai': 'tech/ai/ai-genai',
      'ai-mlops': 'tech/ai/ai-mlops',
      'fusion-01': 'tech/fusion/fusion-01',
      'fusion-02': 'tech/fusion/fusion-02',
      'fusion-03': 'tech/fusion/fusion-03'
    };
    return map[nodeId] || nodeId;
  }

  function getCurrentNode() {
    const currentId = historyStack[historyStack.length - 1];
    return getNode(currentId);
  }

  // ---------------------------------------------------------------------------
  // 3. BFS (Breadth-First Search) Traversal Engine
  // ---------------------------------------------------------------------------

  function getBFSRecommendation() {
    // 1. Depth 1 Survey Queue: Parallel Tracks under Tech
    // Check Depth 1 nodes: core-cs, swe, data, ai, fusion
    const depth1Nodes = PARALLEL_TRACKS.map(id => getNode(id)).filter(Boolean);

    // Prioritize an 'in-progress' Depth 1 track
    for (const track of depth1Nodes) {
      const st = getNodeStatus(track.id);
      if (st === 'in-progress') {
        return {
          node: track,
          parent: getNode('tech'),
          depth: 1,
          tag: 'CYCLE 1: DEPTH 1 IN PROGRESS',
          title: track.title,
          subtitle: track.description || 'Continue macro survey across parallel tracks.'
        };
      }
    }

    // Next, find first 'todo' Depth 1 track
    for (const track of depth1Nodes) {
      const st = getNodeStatus(track.id);
      if (st === 'todo') {
        return {
          node: track,
          parent: getNode('tech'),
          depth: 1,
          tag: 'CYCLE 1: DEPTH 1 SURVEY',
          title: track.title,
          subtitle: track.description || 'Survey macro track orientation and review summary notes.'
        };
      }
    }

    // 2. Depth 2 Applied Queue: Interleave child modules across parallel tracks
    // Collect child modules per track
    const trackChildrenMap = {};
    let maxChildren = 0;
    PARALLEL_TRACKS.forEach(trackId => {
      const track = getNode(trackId);
      const childIds = track && track.children ? track.children : [];
      trackChildrenMap[trackId] = childIds.map(cid => getNode(cid)).filter(Boolean);
      maxChildren = Math.max(maxChildren, trackChildrenMap[trackId].length);
    });

    // First check for any 'in-progress' Depth 2 node
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
            tag: 'CYCLE 2: DEPTH 2 IN PROGRESS',
            title: `${parentTrack.title} → ${childNode.title}`,
            subtitle: childNode.description || 'Applied engineering station currently in progress.'
          };
        }
      }
    }

    // Interleave Depth 2 nodes round-robin across tracks (Track 0 M1, Track 1 M1, ...)
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
            tag: 'CYCLE 2: DEPTH 2 APPLIED',
            title: `${parentTrack.title} → ${childNode.title}`,
            subtitle: childNode.description || 'Complete applied track module and save revision notes.'
          };
        }
      }
    }

    // 3. Depth 3 Granular Queue (Check if deeper child nodes exist)
    for (const trackId of PARALLEL_TRACKS) {
      const modules = trackChildrenMap[trackId];
      for (const mod of modules) {
        if (mod.children && mod.children.length > 0) {
          for (const subId of mod.children) {
            const subNode = getNode(subId);
            if (subNode && getNodeStatus(subNode.id) !== 'completed') {
              return {
                node: subNode,
                parent: mod,
                depth: 3,
                tag: 'CYCLE 3: DEPTH 3 DEEP DIVE',
                title: `${mod.title} → ${subNode.title}`,
                subtitle: subNode.description || 'Specialized granular deep dive node.'
              };
            }
          }
        }
      }
    }

    // All currently known nodes completed!
    return null;
  }

  function updateNextUpBanner() {
    const tagEl = document.getElementById('next-up-tag');
    const titleEl = document.getElementById('next-up-title');
    const subtitleEl = document.getElementById('next-up-subtitle');
    const btnJump = document.getElementById('btn-jump-next');

    const next = getBFSRecommendation();

    if (!next) {
      tagEl.textContent = 'MASTERED';
      tagEl.style.background = 'var(--accent-green-text)';
      titleEl.textContent = 'All Parallel Tracks & Applied Modules Completed!';
      subtitleEl.textContent = 'Ready for production fusion capstones or Depth 3 specialization expansion.';
      btnJump.style.display = 'none';
      return;
    }

    btnJump.style.display = 'inline-flex';
    tagEl.textContent = next.tag;
    tagEl.style.background = next.depth === 1 ? 'var(--accent-blue)' : 'var(--accent-purple)';
    titleEl.textContent = next.title;
    subtitleEl.textContent = next.subtitle;

    btnJump.onclick = () => {
      // Build appropriate breadcrumbs stack
      if (next.depth === 1) {
        historyStack = ['root', 'tech', next.node.id];
      } else if (next.depth === 2) {
        historyStack = ['root', 'tech', next.parent.id, next.node.id];
      } else if (next.depth === 3) {
        historyStack = ['root', 'tech', 'core-cs', next.parent.id, next.node.id];
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

    // Track progress across all known nodes in graph
    Object.keys(graphManifest).forEach(id => {
      if (id === 'root') return;
      total++;
      if (getNodeStatus(id) === 'completed') {
        completed++;
      }
    });

    if (total === 0) {
      // Fallback count if graphManifest is empty
      PARALLEL_TRACKS.forEach(tid => {
        total++;
        if (getNodeStatus(tid) === 'completed') completed++;
        const tnode = getNode(tid);
        if (tnode && tnode.children) {
          tnode.children.forEach(cid => {
            total++;
            if (getNodeStatus(cid) === 'completed') completed++;
          });
        }
      });
    }

    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    progressFill.style.width = percent + '%';
    progressText.textContent = `${percent}% (${completed}/${total} Nodes Completed)`;
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

    // Depth Badge
    const depthBadge = document.createElement('span');
    depthBadge.className = 'badge-pill depth';
    depthBadge.textContent = `Depth d=${currentNode.depth !== undefined ? currentNode.depth : (historyStack.length - 1)}`;
    badgesGroupEl.appendChild(depthBadge);

    // Track or Domain Badge
    if (currentNode.badge) {
      const badgePill = document.createElement('span');
      badgePill.className = 'badge-pill';
      badgePill.textContent = currentNode.badge;
      badgesGroupEl.appendChild(badgePill);
    }

    // Status Badge
    const statusBadge = document.createElement('span');
    statusBadge.className = `badge-pill status-${status}`;
    const statusLabels = { 'todo': 'To Do', 'in-progress': 'In Progress', 'completed': 'Completed ✓' };
    statusBadge.textContent = statusLabels[status] || status;
    badgesGroupEl.appendChild(statusBadge);

    // Quick Status Select
    if (selectQuickStatus) {
      selectQuickStatus.value = status;
      selectQuickStatus.onchange = (e) => {
        setNodeStatus(currentId, e.target.value);
      };
    }

    // View mode toggle visible only on 'tech' domain
    if (currentId === 'tech') {
      viewToggleEl.style.display = 'flex';
      document.getElementById('btn-view-swimlanes').className = `btn-toggle ${viewMode === 'swimlanes' ? 'active' : ''}`;
      document.getElementById('btn-view-road').className = `btn-toggle ${viewMode === 'road' ? 'active' : ''}`;
    } else {
      viewToggleEl.style.display = 'none';
    }

    container.innerHTML = '';

    // If at Tech Domain and Swimlanes mode: Render Parallel Macro Swimlanes
    if (currentId === 'tech' && viewMode === 'swimlanes') {
      roadsHeaderTitle.textContent = 'Parallel Track Swimlanes';
      roadsHeaderCount.textContent = '4 Tracks + Fusion';
      renderMacroSwimlanes(container);
      return;
    }

    // Standard Recursive Child Road View
    renderChildRoads(currentNode, container);
  }

  // ---------------------------------------------------------------------------
  // 6A. Macro Swimlanes (Parallel Tracks side-by-side)
  // ---------------------------------------------------------------------------

  function renderMacroSwimlanes(container) {
    const swimlanesDiv = document.createElement('div');
    swimlanesDiv.className = 'macro-swimlanes-container';

    // 4 Parallel Track Columns Grid
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
      const statusText = trackStatus === 'completed' ? 'Track Survey Done ✓' : (trackStatus === 'in-progress' ? 'In Progress ⏳' : 'To Do');
      statusEl.textContent = statusText;

      headerDiv.appendChild(titleEl);
      headerDiv.appendChild(statusEl);
      laneDiv.appendChild(headerDiv);

      const modulesDiv = document.createElement('div');
      modulesDiv.className = 'track-lane-modules';

      const childIds = trackNode.children || [];
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

      laneDiv.appendChild(modulesDiv);
      gridDiv.appendChild(laneDiv);
    });

    swimlanesDiv.appendChild(gridDiv);

    // Milestone Fusion Banner spanning full width below
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

      const fGrid = document.createElement('div');
      fGrid.className = 'fusion-modules-grid';

      (fusionNode.children || []).forEach(fid => {
        const fMod = getNode(fid);
        if (!fMod) return;
        const fStatus = getNodeStatus(fid);

        const card = document.createElement('div');
        card.className = `module-pill status-${fStatus}`;
        card.onclick = () => {
          historyStack.push('fusion');
          historyStack.push(fid);
          renderCurrentView();
        };

        const t = document.createElement('span');
        t.className = 'module-pill-title';
        t.textContent = fMod.title;

        const b = document.createElement('span');
        b.className = 'module-pill-badge';
        b.textContent = `${fMod.badge || ''} • ${fStatus.toUpperCase()}`;

        card.appendChild(t);
        card.appendChild(b);
        fGrid.appendChild(card);
      });

      fusionDiv.appendChild(fGrid);
      swimlanesDiv.appendChild(fusionDiv);
    }

    container.appendChild(swimlanesDiv);
  }

  // ---------------------------------------------------------------------------
  // 6B. Recursive Child Road View
  // ---------------------------------------------------------------------------

  function renderChildRoads(currentNode, container) {
    const roadsHeaderTitle = document.getElementById('child-roads-title');
    const roadsHeaderCount = document.getElementById('child-roads-count');

    const children = currentNode.children || [];
    roadsHeaderTitle.textContent = 'Child Roads & Stations';
    roadsHeaderCount.textContent = `${children.length} Stations`;

    if (children.length === 0) {
      // Leaf Node Presentation
      const leafDiv = document.createElement('div');
      leafDiv.style.background = 'var(--bg-secondary)';
      leafDiv.style.border = '1px dashed var(--border)';
      leafDiv.style.borderRadius = '8px';
      leafDiv.style.padding = '28px';
      leafDiv.style.textAlign = 'center';

      leafDiv.innerHTML = `
        <div style="font-size: 2rem; margin-bottom: 10px;">🌟</div>
        <h3 style="margin-bottom: 6px;">Station Endpoint (Leaf Node)</h3>
        <p style="color: var(--text-secondary); max-width: 540px; margin: 0 auto 16px auto; font-size: 0.9rem;">
          You have reached an applied module. Dive into the rich notes via 
          <strong style="color: var(--text-primary);">[ 📝 Node Summary & Notes ]</strong> 
          above, or expand deeper Depth 3 sub-stations just-in-time as you master concepts.
        </p>
        <button class="btn-node-action btn-action-summary" id="btn-leaf-open-summary">
          📝 Open summary.md Notes
        </button>
      `;

      container.appendChild(leafDiv);

      const leafBtn = document.getElementById('btn-leaf-open-summary');
      if (leafBtn) leafBtn.onclick = () => openSummaryModal(currentNode.id);
      return;
    }

    // Road Track Container
    const roadLine = document.createElement('div');
    roadLine.className = 'road-line';

    const trackLine = document.createElement('div');
    trackLine.className = 'road-track';
    roadLine.appendChild(trackLine);

    children.forEach((childId, index) => {
      const childNode = getNode(childId);
      if (!childNode) return;

      const childStatus = getNodeStatus(childId);
      const stationEl = document.createElement('div');
      stationEl.className = `station status-${childStatus}`;

      // Node circle
      const nodeEl = document.createElement('div');
      nodeEl.className = 'station-node';
      nodeEl.title = `Station ${index + 1}: ${childStatus.toUpperCase()}`;

      // Card
      const cardEl = document.createElement('div');
      cardEl.className = 'station-card';

      // Header
      const headerEl = document.createElement('div');
      headerEl.className = 'station-card-header';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'station-title';
      titleSpan.textContent = `${String(index + 1).padStart(2, '0')}. ${childNode.title}`;

      const badgesGroup = document.createElement('div');
      badgesGroup.className = 'station-badges-group';

      if (childNode.badge) {
        const badgeSpan = document.createElement('span');
        badgeSpan.className = 'station-badge priority';
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

      // Description
      if (childNode.description) {
        const descP = document.createElement('p');
        descP.className = 'station-desc';
        descP.textContent = childNode.description;
        cardEl.appendChild(descP);
      }

      // Footer
      const footerEl = document.createElement('div');
      footerEl.className = 'station-footer';

      const childCountSpan = document.createElement('span');
      const subCount = childNode.children ? childNode.children.length : 0;
      childCountSpan.textContent = subCount > 0 ? `${subCount} Sub-stations` : 'Station Module';

      const actionSpan = document.createElement('span');
      actionSpan.className = 'station-action-hint';
      actionSpan.textContent = 'Explore station ➔';

      footerEl.appendChild(childCountSpan);
      footerEl.appendChild(actionSpan);
      cardEl.appendChild(footerEl);

      // Click: Drill down into child view (Rule 5)
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

    // RelPath in graph
    const relPath = getNodeRelPath(nodeId);
    html += `
      <div>
        <div class="drawer-section-title">Graph File Location</div>
        <div style="font-family: var(--font-mono); font-size: 0.8rem; background: var(--bg-card); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border); color: var(--text-secondary);">
          graph/${relPath || '(root)'}
        </div>
      </div>
    `;

    // Concept Section
    if (node.concept) {
      html += `
        <div>
          <div class="drawer-section-title">Core Mental Model</div>
          <div class="concept-box">${node.concept}</div>
        </div>
      `;
    }

    // Active Recall
    if (node.activeRecall) {
      html += `
        <div>
          <div class="drawer-section-title">Active Recall Check</div>
          <div class="recall-box">💡 ${node.activeRecall}</div>
        </div>
      `;
    }

    // Curated Resources
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

    // Fetch summary content from server or local cache
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

    // Render markdown view
    renderMarkdownContent(content, previewEl);

    // Switch to Preview tab initially
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

      // Update preview if textarea changed
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
      // Basic fallback
      html = `<pre style="white-space: pre-wrap;">${markdownText}</pre>`;
    }

    targetEl.innerHTML = html;

    // Trigger KaTeX math rendering if available
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

    // 1. Update local cache
    const cache = getSavedNotesCache();
    cache[currentId] = content;
    localStorage.setItem(STORAGE_NOTES_CACHE, JSON.stringify(cache));

    // 2. Save directly to disk via server.py if connected
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

    // Refresh rendered preview
    renderMarkdownContent(content, previewEl);
  }

  // Quick markdown insertion helpers
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
        pill.textContent = '🟢 Local Server Active (Live Disk Saves)';
        pill.className = 'server-badge connected';
        pill.title = `Serving ${data.count} nodes from D:\\Career Roadmap\\graph`;

        // Populate graphManifest with nodes discovered on disk
        if (data.nodes) {
          graphManifest = data.nodes;
        }
        return true;
      }
    } catch (e) {
      // Offline mode
    }

    isServerConnected = false;
    pill.textContent = '🟡 Offline Mode (localStorage)';
    pill.className = 'server-badge offline';
    pill.title = 'Run "run.bat" or "python server.py" for live disk synchronization.';
    return false;
  }

  // ---------------------------------------------------------------------------
  // 10. Event Listeners & Bootstrapping
  // ---------------------------------------------------------------------------

  function setupEventListeners() {
    // Logo Click -> return to Tech domain
    document.getElementById('logo').onclick = () => {
      historyStack = ['root', 'tech'];
      renderCurrentView();
    };

    // Header Actions: Open Info & Open Summary
    document.getElementById('btn-open-info').onclick = () => {
      const currentId = historyStack[historyStack.length - 1];
      openInfoDrawer(currentId);
    };

    document.getElementById('btn-open-summary').onclick = () => {
      const currentId = historyStack[historyStack.length - 1];
      openSummaryModal(currentId);
    };

    // Drawer close buttons
    document.getElementById('drawer-close').onclick = closeInfoDrawer;
    document.getElementById('drawer-overlay').onclick = closeInfoDrawer;

    // Drawer Status toggle buttons
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

    // Summary Modal controls
    document.getElementById('btn-tab-preview').onclick = () => switchSummaryTab('preview');
    document.getElementById('btn-tab-edit').onclick = () => switchSummaryTab('edit');
    document.getElementById('btn-save-summary').onclick = saveSummaryToDisk;
    document.getElementById('btn-close-summary').onclick = closeSummaryModal;
    document.getElementById('btn-summary-done').onclick = closeSummaryModal;
    document.getElementById('summary-modal-overlay').onclick = (e) => {
      if (e.target.id === 'summary-modal-overlay') closeSummaryModal();
    };

    // Editor toolbar
    document.querySelectorAll('.btn-tool').forEach(btn => {
      btn.onclick = () => insertEditorFormatting(btn.getAttribute('data-tool'));
    });

    // Ctrl+S inside summary textarea or modal
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        const overlay = document.getElementById('summary-modal-overlay');
        if (overlay.classList.contains('open')) {
          e.preventDefault();
          saveSummaryToDisk();
        }
      }
    });

    // View toggle buttons on Tech domain
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

    // Check server status & sync graph
    await checkServerConnection();

    // Render initial view
    renderCurrentView();
    updateOverallProgress();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
