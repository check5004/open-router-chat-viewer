# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenRouter Chat Viewer is a static web application that allows users to view and share OpenRouter chat exports. The app takes JSON exports from OpenRouter and renders them as an interactive chat interface with model switching, markdown rendering, and attachment support.

## Development Commands

This is a static web application with no build process or package.json. To develop:

```bash
# Serve the files locally using any static web server
python -m http.server 8000  # Python
# or
npx serve .  # Node.js
# or open index.html directly in browser
```

## Architecture

### Core Files
- `index.html` - Main application entry point with header, sidebar, and chat content areas
- `assets/app.js` - Main application logic (single-page app with vanilla JavaScript)
- `assets/style.css` - Complete styling with dark theme and responsive design
- `docs/design.md` - Detailed design specification in Japanese

### Key Components

**State Management (`assets/app.js:4-12`)**
- Global `state` object holds parsed JSON, indexed characters/messages, and UI state
- No frameworks - pure DOM manipulation

**Data Processing Flow**
1. JSON upload → `loadJson()` → `indexData()` 
2. Creates lookup maps for characters and assistant responses by user message + model
3. Builds model list with cost/token summaries

**UI Architecture**
- Left sidebar: Model selection with summary statistics
- Main content: Timeline of user messages + selected model responses
- Message rendering supports markdown (via marked.js), attachments, and collapsible "thinking" sections

**Export Feature (`buildStandaloneHtml()`)**
- Generates self-contained HTML files with inlined CSS/JS
- Preserves full functionality for sharing
- Uses CDN dependencies (marked.js, DOMPurify)

### Security
- All markdown content is sanitized with DOMPurify
- Only data: URLs allowed for attachments
- XSS protection throughout

### Key Functions
- `indexData()` - Parses and indexes OpenRouter JSON structure
- `deriveModelKey()` - Extracts model identifier from message metadata
- `renderChat()` - Builds timeline based on selected model
- `renderMarkdown()` - Safely converts markdown to HTML
- `buildStandaloneHtml()` - Creates exportable single-file version

The application expects OpenRouter JSON exports with specific structure documented in `docs/design.md`.