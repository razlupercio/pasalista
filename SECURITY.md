# Security policy

PasaLista validates event attendance with signed QR codes and stores attendee data, so we take
security reports seriously.

## Supported versions

The project is pre-release (`0.x`). Only the latest commit on `main` receives security fixes.

## Reporting a vulnerability

**Please do not open a public issue.** Report privately through
[GitHub private vulnerability reporting](https://github.com/razlupercio/pasalista/security/advisories/new).

Include:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- Affected version or commit.

What to expect:

- Acknowledgement within 5 business days.
- An assessment and, if confirmed, a fix plan within 30 days.
- Credit in the release notes, unless you prefer to stay anonymous.

## Scope

In scope: the code in this repository (API, web app, shared packages, Docker setup).
Out of scope: deployments run by third parties, social engineering, and denial of service through
volumetric traffic.

## Security design

The threat model and controls are documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
(section "Security baseline") and the ADRs in [`docs/adr/`](docs/adr/). The project targets
OWASP ASVS level 1.
