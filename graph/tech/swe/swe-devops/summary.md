# Containerization & Environments

> **Structural Depth:** Depth $d=2$ | **Parent:** Track 1 Software Engineering

### Core Mental Models
1. **Linux Primitives:** Namespaces provide isolation (PID, NET, MNT, IPC); cgroups enforce resource limits (CPU, RAM).
2. **Multi-Stage Builds:** Compile and package in builder stage; copy only binaries/wheels to a minimal Alpine/Distroless runtime stage.
3. **Environment Security:** Non-root execution (`USER appuser`), `.dockerignore`, secrets mounted via buildkit.
