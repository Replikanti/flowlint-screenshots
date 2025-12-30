# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **screenshot storage repository** for the FlowLint marketing automation system. It stores PNG screenshots of n8n workflows that are automatically generated and committed by n8n workflows themselves.

**Purpose**: Provide publicly accessible URLs for workflow screenshots used in social media posts and landing pages.

**Key Point**: This is a **data repository**, not a code repository. There are no build commands, tests, or development workflows.

## Repository Structure

```
screenshots/
├── AI_Research_RAG_and_Data_Analysis/
├── Airtable/
├── Database_and_Storage/
├── Discord/
├── Forms_and_Surveys/
├── Gmail_and_Email_Automation/
├── Google_Drive_and_Google_Sheets/
├── HR_and_Recruitment/
├── Instagram_Twitter_Social_Media/
├── Notion/
├── OpenAI_and_LLMs/
├── Other_Integrations_and_Use_Cases/
├── PDF_and_Document_Processing/
├── Slack/
├── Telegram/
├── WhatsApp/
├── WordPress/
└── devops/
```

Each category directory contains PNG screenshots (1920x1080, ~200-400 KB each).

## Public URL Format

Screenshots are accessed via GitHub raw content URLs:

```
https://raw.githubusercontent.com/nitramyloh/flowlint-screenshots/main/screenshots/{category}/{filename}.png
```

Example:
```
https://raw.githubusercontent.com/nitramyloh/flowlint-screenshots/main/screenshots/Gmail_and_Email_Automation/auto-label-gmail.png
```

## Screenshot Naming Convention

Workflow filenames are converted to screenshot filenames using these rules:
- Lowercase all characters
- Convert spaces to hyphens (`-`)
- Remove special characters
- Max 50 characters
- Remove redundant suffixes like "with AI", "using OpenAI", "nodes"

Examples:
- `Auto-label incoming Gmail messages with AI nodes.json` → `auto-label-incoming-gmail-messages.png`
- `Send Slack notification on form submission.json` → `send-slack-notification-form-submission.png`

## Setup

To initialize the repository structure, run:

```bash
./setup-screenshots-repo.sh
```

This creates all category directories and necessary files (README.md, .gitignore, INFO.txt).

## Automation Architecture

This repository is **automatically managed** by n8n workflows:

1. **Screenshot Generator Workflow** - Uses Puppeteer to generate PNG from n8n workflow JSON
2. **GitHub Commit Node** - Uploads screenshot to this repo via GitHub API
3. **Marketing Workflows** - Use the public raw.githubusercontent.com URLs in posts

**Manual edits should be minimal** - the automation handles screenshot generation and organization.

## Repository Visibility

**IMPORTANT**: This repository must be set to **PUBLIC** in GitHub settings for the raw content URLs to work without authentication.

To verify: Settings → Danger Zone → Change repository visibility → Make public

## Git Workflow

This repository follows the parent FlowLint project's conventions:
- **NEVER commit to `main`** - all changes via PR
- Use Conventional Commits: `<type>(<scope>): <description>`
- Branch naming: `feat/`, `fix/`, `docs/`, `chore/`

Example commits:
- `feat(screenshots): add OpenAI category screenshots`
- `chore(structure): reorganize category directories`
- `docs(readme): update naming convention rules`

## Related Repositories

This repository is part of the FlowLint ecosystem:
- **flowlint-web** - Uses these screenshot URLs in marketing pages
- **awesome-n8n-templates** - Source workflows for screenshot generation
- **flowlint-core** - Static analysis tool for the workflows being screenshotted
