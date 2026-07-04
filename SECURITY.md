# Security Policy

## Supported Versions

The current public release line is `v1.1.x`. Version `v2.0.0` is under active development and has not been released; known security-relevant issues in the development branch are tracked in `HANDOVER.md` (items B6, B7, B11).

## Sensitive Data

learn++ may store local user data through Electron `safeStorage`, including login sessions, account profiles, settings, download history, and AI provider keys. These files are stored under the current user's application data directory and must not be committed to Git.

Never publish:

- `*.enc`
- cookies or session dumps
- account names paired with private course data
- API keys or provider credentials
- real homework submissions, course materials, screenshots, or logs containing private information

## Reporting Security Issues

Please do not open a public issue containing credentials, cookies, API keys, private course content, or reproducible exploit details.

Report the issue privately to the project maintainer. If no private contact is available, open a minimal public issue that says a private security report is available, without including sensitive details.

## Scope

This is a third-party, unofficial desktop client. Security reports should focus on learn++ code, local storage, credential handling, and packaged application behavior.
