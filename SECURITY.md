# Security policy

## Reporting a vulnerability

Please report security issues privately by email to **devops@sync8.io**.
Do not open a public issue for a suspected vulnerability.

Include what you can of:

- the affected package (`@sync8/email-rte`, `@sync8/email-rte-react`,
  `@sync8/email-rte-angular`, the `Sync8.EmailRte` NuGet package, or the sample
  host) and version or commit;
- a description of the issue and its impact;
- steps to reproduce or a proof of concept.

We aim to acknowledge reports within 3 business days and to agree on a
disclosure timeline with you once the issue is confirmed.

## Supported versions

Until 1.0, only the latest released minor version receives security fixes.

## Scope notes

- `samples/host` is a **reference application**, not a hardened product. It has
  no authentication: anyone who can reach it can send email through the
  configured SMTP server. Put it behind your own authentication before
  exposing it beyond localhost.
- The renderer (`@sync8/email-rte/render`) treats its input Delta as untrusted:
  it escapes text and drops any link, image source, colour, size or font it
  cannot validate. Re-render stored Deltas on the server rather than accepting
  HTML from the browser. Reports of markup or script getting through the
  renderer are in scope.
