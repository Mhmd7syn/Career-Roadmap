# Backend Frameworks & API Design

> **Structural Depth:** Depth $d=2$ | **Parent:** Track 1 Software Engineering

### Core Mental Models
1. **Async Event Loop:** Co-operative multitasking; non-blocking socket I/O lets a single thread serve thousands of concurrent clients.
2. **Input Validation Contracts:** Pydantic schemas enforce type safety and sanitization before request handlers run.
3. **Stateless Authentication:** JWT with asymmetric RSA/Ed25519 signatures enables distributed verification without DB lookups.
