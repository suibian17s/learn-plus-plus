# Third-Party Notices

learn++ uses open-source libraries and resources. This file summarizes notable third-party components for release and compliance review.

## Runtime and UI

- Electron
- React
- TypeScript
- Ant Design
- TanStack Query
- Zustand
- DOMPurify
- dayjs
- electron-log
- electron-builder

See `package.json` and `package-lock.json` for the complete dependency graph and exact versions.

## Tsinghua Learn Access

- `thu-learn-lib` is used to access and parse Tsinghua Learn data.

learn++ is a third-party, unofficial client and is not affiliated with Tsinghua University or the official Tsinghua Learn platform.

## Document Processing

- `pdf-parse`
- `mammoth`
- `officeparser`
- `docx`
- `pdfkit`

These packages are used for attachment parsing and AI-assisted draft export.

## Font

The bundled Chinese font is:

```text
resources/fonts/SourceHanSansSC-Regular.ttf
```

Source Han Sans / Noto Sans CJK is distributed by Adobe and Google under the SIL Open Font License 1.1. If redistributing this repository or packaged application, keep the font notice and license information available to users.

Official project:

```text
https://github.com/adobe-fonts/source-han-sans
```

License:

```text
SIL Open Font License 1.1
```

## Application Icon

Application icon files are stored under `resources/` and `src/renderer/src/assets/`. They are part of this project's application assets.
