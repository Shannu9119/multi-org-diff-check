// Legacy function - kept for backward compatibility
export function generatePackageXml(types: string[]): string {
  return generatePackageXmlForAllMetadata(types);
}

/**
 * Generate package.xml for all metadata (existing behavior)
 */
export function generatePackageXmlForAllMetadata(types: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n${types.map(t => `  <types>\n    <members>*</members>\n    <name>${t}</name>\n  </types>`).join('\n')}\n  <version>59.0</version>\n</Package>`;
}
