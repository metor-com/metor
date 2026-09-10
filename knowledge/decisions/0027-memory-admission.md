# ADR-0027: Admit runtime starts against Space RAM

Status: accepted, 2026-09-10

## Decision

Before starting a runtime worker, the lightweight host joins a Space-wide FIFO
queue. A start requires 512 MiB of estimated headroom plus a reserve of 10% of
Space RAM (at least 256 MiB, at most 1 GiB). Only one runtime starts at a time.
Its startup lease ends once it leaves starting state and five seconds have elapsed,
or once its worker process group exits. Memory is sampled again for every admission;
capacity cannot be promised independently to several simultaneous routines.

Linux measurements combine MemAvailable with the tightest headroom among the current
cgroup and visible ancestors (v1 and v2). Subtract inactive file cache from cgroup
usage because it can be reclaimed; otherwise idle file cache could indefinitely
block the allocation that would trigger reclamation. Physical MemAvailable remains
an independent bound. Unknown readings or unreadable admission state defer starts.
These are estimates, not per-process memory limits or an OOM guarantee.

Persist the queue and startup lease in `bots/.memory/admission.json`, using atomic
rename and a short filesystem lock for cross-process coordination. Owner identities
include PID, process start time and boot ID on Linux so dead/reused owners do not
block later starts. A crashed lock holder is reclaimed; an interrupted lock creation
without an owner record expires after ten seconds.

A waiting bot keeps its lightweight host and durable inbox. Its cursor does not
advance until the worker actually consumes a turn. Retrying admission does not
inject duplicate turns. Pause removes the queue entry; a later explicit start still
finds the undelivered inbox. Started work is never killed by the guard. The existing
idle timeout releases unused runtimes normally; this change does not force an early
sleep, close browser tabs or resize a container.

## Product and diagnostics

Settings → Space shows RAM headroom, the reserve, a current startup and waiting bots
via an authenticated read-only endpoint. The sidebar and chat explain waiting.
Read-only polling never wakes a runtime. Event log records reason transitions into
waiting and eventual admission, with duration, available/required RAM and the pending
routine/message IDs. Repeated retries with the same reason do not spam the log.

Browser/desktop starts and memory growth of running work remain outside admission;
those are separate backlog items. Runtime startup estimates can differ from actual
usage, especially when users configure extra connectors. The later persistent RAM
setting will change allocation; this change only manages the current allocation.

## Verification

Tests cover v1/v2 and ancestor limits, reclaimable cache, unknown readings, FIFO,
concurrent process admission, dead owners, delayed exactly-once routine delivery and
Pause while waiting. A 512 MiB test Space verifies that real pressure keeps the API
responsive without starting a runtime. Browser tests cover RAM settings and unknown,
low and recovered readings; existing native sleep and smoke tests cover compatibility.
