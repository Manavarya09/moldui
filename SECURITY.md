# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.** Instead:

1. Report via [GitHub's private vulnerability reporting](https://github.com/Manavarya09/moldui/security/advisories/new), or
2. Email **masyv@moldui.dev** with the subject `[moldui security]`

Include:

- A description of the vulnerability and its impact
- Steps to reproduce (proof-of-concept preferred)
- The version you tested on (`moldui --version`)

You'll get an acknowledgment within 48 hours. Confirmed issues are patched and released within 7 days; severe issues faster.

## Scope

moldui runs **locally only**. It opens:

- An HTTP proxy (default port `4444`) between your browser and your dev server
- A WebSocket hub (default port `4445`) between the browser overlay and the CLI

**Both bind to `localhost` only.** moldui does not make outbound network calls, does not collect telemetry, and does not phone home. If you find code that does, treat it as a vulnerability and report it.

The AI sync feature spawns the `claude` CLI as a subprocess via `child_process.spawn` with array arguments (no shell interpolation). Batch files are read from `.moldui/` inside the project directory.

## Supported versions

Only the latest minor version receives security patches. Please keep up to date:

```bash
npm i -g moldui@latest
```

## Credits

Responsible disclosures will be credited in the release notes unless the reporter requests anonymity.
