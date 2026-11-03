window.RoadmapRegistry = window.RoadmapRegistry || {};

window.RoadmapRegistry['root'] = {
  id: 'root',
  title: 'Career & Life Master Graph',
  description: 'Lifelong growth network spanning engineering, career development, and business.',
  stations: [
    {
      id: 'tech',
      title: 'Tech & Systems Engineering',
      badge: 'Active Domain',
      description: 'The Tri-T Engineering engine: Core CS, SWE, Data, and AI running in parallel.',
      targetRoadmapId: 'tech',
      type: 'hub'
    },
    {
      id: 'freelancing',
      title: 'Freelancing & Consulting',
      badge: 'Future Domain',
      description: 'Client acquisition, project scoping, contract negotiation, and high-value delivery.',
      type: 'topic',
      concept: 'Building an independent consulting practice and direct client monetization pipeline.',
      activeRecall: 'How do you structure value-based pricing versus hourly billing?'
    },
    {
      id: 'marketing-brand',
      title: 'Marketing & Brand',
      badge: 'Future Domain',
      description: 'Technical writing, open-source presence, personal brand, and inbound opportunities.',
      type: 'topic',
      concept: 'Establishing public technical credibility and inbound opportunity pipelines.',
      activeRecall: 'What is the most effective format for showcasing production engineering work publicly?'
    }
  ]
};
