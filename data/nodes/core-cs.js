window.RoadmapRegistry = window.RoadmapRegistry || {};

window.RoadmapRegistry['core-cs'] = {
  id: 'core-cs',
  title: 'Track 0: Core CS Foundations',
  parentRoadmapId: 'tech',
  description: 'Algorithms, operating systems, networking protocols, and professional software craftsmanship.',
  stations: [
    {
      id: 'algo-ds',
      title: 'Algorithms & Data Structures',
      badge: 'Module 1',
      description: 'Asymptotic complexity, core data structures, and algorithmic patterns.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'Big-O notation, arrays, hash maps, trees, and graphs mental models.' },
        { level: 2, title: 'Applied', goal: 'Implement standard traversals (BFS/DFS) and solve core NeetCode 75 patterns.' },
        { level: 3, title: 'Deep Dive', goal: 'Memory layout of structures, cache locality, and custom allocators.' }
      ],
      resources: [
        { label: 'NeetCode 150 Roadmap', url: 'https://neetcode.io/roadmap' },
        { label: 'Big-O Cheat Sheet', url: 'https://www.bigocheatsheet.com/' }
      ],
      concept: 'Mastering algorithmic time/space trade-offs allows designing systems that scale gracefully under load.',
      activeRecall: 'Compare Array vs Linked List vs Hash Table for read, insertion, and deletion complexity.'
    },
    {
      id: 'systems-os',
      title: 'Operating Systems & Systems',
      badge: 'Module 2',
      description: 'Processes, threads, concurrency, virtual memory, and Linux systems programming.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'Process vs thread models, context switching, and virtual memory layout.' },
        { level: 2, title: 'Applied', goal: 'Multi-threaded scripting, mutex locks, Linux CLI pipe composition.' },
        { level: 3, title: 'Deep Dive', goal: 'Kernel system calls, page faults, CPU scheduling, and deadlocks.' }
      ],
      resources: [
        { label: 'Operating Systems: Three Easy Pieces (Free Book)', url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/' }
      ],
      concept: 'Understanding how the OS manages CPU and RAM prevents memory leaks, race conditions, and blocking bottlenecks.',
      activeRecall: 'What happens during a context switch at the CPU register and memory cache level?'
    },
    {
      id: 'networking',
      title: 'Computer Networking & Protocols',
      badge: 'Module 3',
      description: 'TCP/IP stack, DNS, HTTP/1.1 vs HTTP/2 vs HTTP/3, TLS/SSL, and WebSockets.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'OSI 7-layer model, packet routing, DNS, and HTTP lifecycle.' },
        { level: 2, title: 'Applied', goal: 'Inspect network traffic with curl/Wireshark, configure TLS certificates, raw sockets.' },
        { level: 3, title: 'Deep Dive', goal: 'TCP congestion control (CUBIC/BBR), HTTP/3 QUIC UDP multiplexing.' }
      ],
      resources: [
        { label: 'High Performance Browser Networking (Ilya Grigorik)', url: 'https://hpbn.co/' }
      ],
      concept: 'Every web, data, and AI service communicates over networks; protocol knowledge dictates latency and reliability.',
      activeRecall: 'Walk through the 3-way TCP handshake and how TLS 1.3 optimizes the crypto handshake.'
    },
    {
      id: 'craftsmanship',
      title: 'Software Craftsmanship & Tooling',
      badge: 'Module 4',
      description: 'Advanced Git workflows, Clean Code, SOLID principles, testing, and debugging.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'Git DAG structure, Clean Code rules, and unit vs integration testing.' },
        { level: 2, title: 'Applied', goal: 'Interactive rebasing, bisecting bugs, writing test suites with pytest.' },
        { level: 3, title: 'Deep Dive', goal: 'Design patterns in distributed code, profiling memory and CPU execution.' }
      ],
      resources: [
        { label: 'Pro Git Book (Official)', url: 'https://git-scm.com/book/en/v2' }
      ],
      concept: 'High craftsmanship turns raw code into readable, maintainable, team-ready engineering assets.',
      activeRecall: 'When is git rebase preferred over git merge, and why should you never rebase public shared branches?'
    }
  ]
};
