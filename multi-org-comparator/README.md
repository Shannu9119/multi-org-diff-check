# Multi-Org Compare

Compare Salesforce metadata between two orgs (e.g., SIT and UAT) using the VS Code command palette.

## Features
- Select two authenticated Salesforce org aliases
- Multi-select metadata types to compare
- Retrieve and normalize metadata from both orgs
- View added, removed, and modified components in a tree view
- Open unified and side-by-side diffs for modified components
- Export deploy package for selected diffs
- Mark as reviewed, open component in org

## Requirements
- Salesforce CLI (SFDX) installed and on PATH
- Two authenticated orgs (use `sfdx force:auth:web:login -a <alias>`)

## Usage
1. Authenticate two Salesforce orgs using SFDX (outside this extension).
2. Open the Command Palette (F1) and run `Multi-Org Comparator: Start Comparison`.
3. Select two org aliases.
4. Select one or more metadata types to compare.
5. Wait for retrieval and comparison. View results in the tree view and open diffs.

## Manual Integration Test Checklist
- Ensure two SFDX-authenticated org aliases exist (e.g., SIT_ALIAS, UAT_ALIAS).
- Run F1 → Multi-Org Comparator: Start Comparison.
- Select SIT_ALIAS and UAT_ALIAS.
- Multi-select metadata types: ApexClass, LightningComponentBundle, etc.
- Observe tree and open a diff for a modified component.

## Development
- `npm install` to install dependencies.
- `npm run compile` to build.
- `npm run test` to run Jest unit tests.
- Install `vsce` globally (`npm install -g vsce`) and run `vsce package` to create a VSIX.

## Unit Tests
- See `__tests__/` for Jest tests of XML/text normalization and diff logic.

## Edge Cases
- If SFDX is not installed, you will see an error and a link to install instructions.
- If a metadata type is not supported by MDAPI, the extension will attempt to use Tooling API or fallback methods.
- If a retrieve fails, you will see a partial result and an error message.

## Release Notes

### 1.0.0
Initial release of Multi-Org Compare for Salesforce metadata comparison.
