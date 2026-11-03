window.RoadmapRegistry = window.RoadmapRegistry || {};

window.RoadmapRegistry['fusion'] = {
  id: 'fusion',
  title: 'Milestone Fusion Projects',
  parentRoadmapId: 'tech',
  description: 'Continuous cross-domain projects that synthesize SWE + Data + AI at key milestones.',
  stations: [
    {
      id: 'fusion-01',
      title: 'Milestone 1: The Core Triad Microservice',
      badge: 'Milestone 1',
      description: 'FastAPI backend + PostgreSQL + structured ingestion pipeline + embedded ML inference.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'System architecture review and contract definition between SWE, Data, and AI.' },
        { level: 2, title: 'Applied', goal: 'Build, dockerize, and test the unified repository with automated pytest suites.' },
        { level: 3, title: 'Deep Dive', goal: 'Load testing with Locust, container profiling, and sub-50ms inference latency.' }
      ],
      resources: [
        { label: 'FastAPI + Docker Production Template', url: 'https://fastapi.tiangolo.com/deployment/docker/' }
      ],
      concept: 'Binds clean backend architecture with reliable data schemas and model serving in a single production repository.',
      activeRecall: 'How do you separate model loading lifecycle from HTTP request handling in an async API?'
    },
    {
      id: 'fusion-02',
      title: 'Milestone 2: Intelligent Data Application',
      badge: 'Milestone 2',
      description: 'Async task queues (Celery/Redis) + automated Airflow ETL + production RAG over warehouse data.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'Architecture of asynchronous worker queues and decoupling ingestion from querying.' },
        { level: 2, title: 'Applied', goal: 'Full-stack operational pipeline: Airflow loads data, triggers embedding, enables RAG.' },
        { level: 3, title: 'Deep Dive', goal: 'Dead-letter queues, idempotent workers, embedding pipeline cache invalidation.' }
      ],
      resources: [
        { label: 'Celery Distributed Task Queue Guide', url: 'https://docs.celeryq.dev/' }
      ],
      concept: 'Demonstrates enterprise data orchestration powering a user-facing generative AI system.',
      activeRecall: 'Why should heavy embedding and LLM calls run in background workers rather than synchronous API handlers?'
    },
    {
      id: 'fusion-03',
      title: 'Milestone 3: Real-Time AI Streaming System',
      badge: 'Milestone 3',
      description: 'gRPC/WebSocket backend + Kafka event streaming + vLLM serving + Langfuse observability.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'Stream processing topology, backpressure handling, and distributed telemetry.' },
        { level: 2, title: 'Applied', goal: 'Deploy Kafka with Spark streaming consumer feeding low-latency vLLM inference.' },
        { level: 3, title: 'Deep Dive', goal: 'End-to-end distributed tracing, P99 latency SLA guarantees, fault tolerance.' }
      ],
      resources: [
        { label: 'Kafka + Python Real-Time Streaming Reference', url: 'https://kafka.apache.org/documentation/' }
      ],
      concept: 'The capstone portfolio project qualifying you as a high-tier Tri-T Software & AI Systems Engineer.',
      activeRecall: 'How does backpressure prevent downstream model inference servers from crashing during traffic spikes?'
    }
  ]
};
