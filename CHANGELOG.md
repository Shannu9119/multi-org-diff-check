# Change Log

All notable changes to the "multi-org-diff-check" extension will be documented in this file.

## [0.0.8] - 2025-10-10

### Added
- **Retrieval Strategy Selection**: Users can now choose between "All Metadata" and "Recently Updated Metadata" at the start of comparison
- **Dynamic Org Alias Display**: Shows actual org names (e.g., "Dev", "Production") instead of generic "Org A" and "Org B" throughout the UI
- **Enhanced Assistant Intelligence**: AI assistant now detects retrieval strategy from natural language (e.g., "recent", "all", "complete")
- **Improved Diff View Titles**: Diff tabs now show org names like "MyClass.cls (Dev ↔ Production)"

### Enhanced
- **Progress Notifications**: More descriptive progress messages showing actual org names
- **Tree View Labels**: File labels now show specific org names (e.g., "[Added in Production] MyClass.cls")
- **Error Messages**: More helpful error messages with specific org names
- **Recent Metadata Querying**: Uses Salesforce Tooling API to find recently modified components
- **Graceful Fallbacks**: Automatically falls back to "All Metadata" if recent queries fail

### Fixed
- **Package.xml Generation**: Improved reliability of metadata package file creation
- **Error Handling**: Better handling of org authentication and connectivity issues
- **File Path Resolution**: More robust directory and file path handling
- **SOQL Date Format**: Fixed date formatting for Salesforce API queries

### Improved
- **User Experience**: Streamlined workflow with strategy selection upfront
- **Debugging**: Enhanced logging and error reporting for troubleshooting
- **Assistant Responses**: More contextual and helpful AI assistant interactions

## [0.0.7] - Previous Release

- Initial release with basic org comparison functionality