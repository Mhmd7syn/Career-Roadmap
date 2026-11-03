window.RoadmapRegistry = window.RoadmapRegistry || {};

window.RoadmapRegistry['tech'] = {
  id: 'tech',
  title: 'Tech Domain: The Tri-T Engineer',
  parentRoadmapId: 'root',
  description: '4 Parallel Tracks running concurrently via the Spiral Model (Survey -> Applied -> Deep Dive).',
  stations: [
    {
      id: 'core-cs',
      title: 'Track 0: Core CS Foundations',
      badge: 'Foundation',
      description: 'Algorithms, operating systems, networking, and software craftsmanship.',
      targetRoadmapId: 'core-cs',
      type: 'hub'
    },
    {
      id: 'swe',
      title: 'Track 1: Software Engineering',
      badge: 'Core Track',
      description: 'Backend architectures, Web APIs, databases, containers, CI/CD, and system design.',
      targetRoadmapId: 'swe',
      type: 'hub'
    },
    {
      id: 'data',
      title: 'Track 2: Data Ecosystem',
      badge: 'Core Track',
      description: 'Analytics, advanced SQL, data pipelines, warehousing, and big data systems.',
      targetRoadmapId: 'data',
      type: 'hub'
    },
    {
      id: 'ai',
      title: 'Track 3: AI Landscape',
      badge: 'Core Track',
      description: 'Classical ML, deep learning, computer vision, NLP, GenAI/LLMs, and MLOps.',
      targetRoadmapId: 'ai',
      type: 'hub'
    },
    {
      id: 'fusion',
      title: 'Milestone Fusion Projects',
      badge: 'Integration',
      description: 'Continuous cross-domain projects combining SWE + Data + AI at key milestones.',
      targetRoadmapId: 'fusion',
      type: 'hub'
    }
  ]
};
