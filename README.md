# Multi-Org Diff Check

A VS Code extension for comparing Salesforce metadata between two orgs with an interactive assistant that understands natural language commands.

## Features

- **Interactive Assistant**: Chat with the extension using natural language like "compare apex classes between dev and prod"
- **Comprehensive Metadata Comparison**: Support for ApexClass, ApexTrigger, Flow, Lightning Components, and more
- **Smart Org Detection**: Automatically detects authenticated Salesforce orgs
- **Intuitive UI**: Tree view with filters, side-by-side diffs, and progress notifications
- **Authentication Guidance**: Step-by-step help when orgs need to be authenticated
- **Export Capabilities**: Generate deployment packages from comparison results

## Requirements

- Salesforce CLI (sf) installed and accessible
- VS Code 1.80.0 or higher
- Authenticated Salesforce orgs

## Quick Start

1. Install the extension from VSIX or marketplace
2. Open the Command Palette (F1) and run "Multi-Org Comparator: Start Comparison"
3. Or use the interactive Assistant view to chat: "compare UAT and Hotfix for apex classes"

## Latest Release - v0.0.7

- Enhanced natural language parsing for custom org names
- Improved authentication guidance flow
- Better error handling and user feedback
- Fixed org validation logic in assistant

## Development

```bash
npm install
npm run compile
npm run test
```

## Repository Structure

- `/multi-org-comparator/` - Main extension code
- Contains VSIX packages for different versions
