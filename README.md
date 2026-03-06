# VibeTerm 2

`@swarmclawai/vibeterm@0.2.1` is a desktop-first terminal workspace built with Tauri, React, and xterm.js.

It supports:

- desktop mode by default
- optional web/remote mode
- launcher-aware terminal creation
- pinned and recent project directories
- companion browser panel
- theme previews, extra bundled themes, and local custom themes

## Install

```bash
npm install -g @swarmclawai/vibeterm
```

Desktop mode builds and runs through Tauri on the local machine, so Rust/Cargo and standard Tauri desktop prerequisites still need to be installed.

## Start

Desktop mode is the default:

```bash
vibeterm
```

You can also start it explicitly:

```bash
vibeterm desktop
```

## Web Mode

Passwordless web mode:

```bash
vibeterm web
```

Password-protected web mode:

```bash
vibeterm web --password
```

When password mode is enabled, the generated token is printed in the terminal output.

## Local Development

Desktop app:

```bash
npm run desktop:dev
```

Web mode without a password:

```bash
npm run web:dev
```

Web mode with a generated password:

```bash
npm run web:dev:password
```

Production build:

```bash
npm run build
```

## Runtime Modes

Desktop mode:

- native Tauri shell
- local launcher detection
- companion browser available

Web mode:

- browser client with remote PTY backend
- starts a default shell automatically
- companion browser is disabled by design

## Launcher

The launcher supports:

- pinned directories
- recent directories
- typed path selection
- provider-aware session launch and resume
- shell selection when multiple local shells are detected

In smaller panes, the launcher automatically switches to a compact quick-launch layout.

## Companion Browser

The companion is browser-first:

- native child webview in the desktop app
- search-or-URL address field
- dock left, dock right, or float
- collapsible header

It never relies on iframes.

## Themes

VibeTerm 2 includes a broader bundled theme set and supports local custom themes.

- hover a theme in the top bar to preview it
- click to apply it
- create a custom copy from Settings
- edit accent/background/foreground/glow colors
- delete custom themes from Settings

Custom themes are stored locally on the machine.
