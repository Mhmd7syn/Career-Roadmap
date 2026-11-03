window.RoadmapRegistry = window.RoadmapRegistry || {};

window.RoadmapRegistry['swe'] = {
  id: 'swe',
  title: 'Track 1: Software Engineering (SWE)',
  parentRoadmapId: 'tech',
  description: 'Production backend architecture, APIs, databases, containerization, and system design.',
  stations: [
    {
      id: 'swe-backend',
      title: 'Backend Frameworks & API Design',
      badge: 'SWE-01',
      description: 'RESTful API standards, FastAPI / Go / TypeScript, async programming, and auth.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'REST principles, status codes, async/await I/O, JWT/OAuth2 flows.' },
        { level: 2, title: 'Applied', goal: 'Build a production CRUD API with Pydantic validation and middleware.' },
        { level: 3, title: 'Deep Dive', goal: 'High-throughput gRPC services, WebSocket streaming, connection pooling.' }
      ],
      resources: [
        { label: 'FastAPI Official Documentation', url: 'https://fastapi.tiangolo.com/' }
      ],
      concept: 'APIs are the contract between clients and services; robust design requires strict input validation and clean error handling.',
      activeRecall: 'What is the performance difference between CPU-bound tasks and I/O-bound tasks in async web frameworks?'
    },
    {
      id: 'swe-databases',
      title: 'Databases & Persistent Storage',
      badge: 'SWE-02',
      description: 'PostgreSQL schema modeling, indexing (B-Tree/GIN), ACID transactions, and Redis caching.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'Relational vs NoSQL trade-offs, ACID properties, basic normalization.' },
        { level: 2, title: 'Applied', goal: 'Write complex joins, run migrations (Alembic), implement Redis caching.' },
        { level: 3, title: 'Deep Dive', goal: 'Query EXPLAIN ANALYZE execution plans, index tuning, transaction isolation levels.' }
      ],
      resources: [
        { label: 'Use The Index, Luke (SQL Indexing Guide)', url: 'https://use-the-index-luke.com/' }
      ],
      concept: 'The database is almost always the scalability bottleneck in production; proper schema design and indexing are mandatory.',
      activeRecall: 'Explain why a B-Tree index helps range queries and what happens when an index is added to an existing table.'
    },
    {
      id: 'swe-devops',
      title: 'Containerization & Environments',
      badge: 'SWE-03',
      description: 'Docker, multi-stage builds, Docker Compose, environment management, and cloud primitives.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'Container isolation vs VMs, Dockerfile syntax, image layers.' },
        { level: 2, title: 'Applied', goal: 'Containerize backend + DB with docker-compose, multi-stage size reduction.' },
        { level: 3, title: 'Deep Dive', goal: 'Linux cgroups and namespaces, container networking, non-root security.' }
      ],
      resources: [
        { label: 'Docker Official Get Started Guide', url: 'https://docs.docker.com/get-started/' }
      ],
      concept: 'Containers guarantee reproducibility across development, staging, and cloud production environments.',
      activeRecall: 'How do Docker layers work with caching during `docker build`, and how should you order commands?'
    },
    {
      id: 'swe-sysdesign',
      title: 'System Design Fundamentals',
      badge: 'SWE-04',
      description: 'Scalability, horizontal vs vertical scaling, load balancers, caching, and stateless services.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'Load balancers, reverse proxies (Nginx), horizontal scaling, CDN caching.' },
        { level: 2, title: 'Applied', goal: 'Design a scalable URL shortener with rate limiting and database read replicas.' },
        { level: 3, title: 'Deep Dive', goal: 'CAP theorem, distributed consistency (Paxos/Raft), message queues.' }
      ],
      resources: [
        { label: 'System Design Primer (GitHub)', url: 'https://github.com/donnemartin/system-design-primer' }
      ],
      concept: 'System design transforms single-server scripts into fault-tolerant distributed applications.',
      activeRecall: 'Describe the differences between cache-aside, write-through, and write-back caching strategies.'
    }
  ]
};
