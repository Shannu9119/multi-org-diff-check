import { runSfdx } from './sfdx';

export interface RecentMetadataOptions {
  recentOnly: boolean;
  daysSince?: number;
}

export interface MetadataComponent {
  type: string;
  name: string;
  lastModifiedDate: string;
}

/**
 * Get recently modified metadata components using Tooling API queries
 */
export async function getRecentlyModifiedMetadata(
  orgAlias: string, 
  metadataTypes: string[], 
  daysSince: number = 7
): Promise<MetadataComponent[]> {
  const components: MetadataComponent[] = [];
  
  // Validate org is accessible first
  try {
    console.log(`Validating org access for: ${orgAlias}`);
    const result = await runSfdx(`sf org display --target-org ${orgAlias} --json`);
    console.log(`Org ${orgAlias} is accessible`);
  } catch (error) {
    console.error(`Org ${orgAlias} is not accessible:`, error);
    console.log(`Will return empty components list for ${orgAlias}`);
    return components; // Return empty array instead of throwing
  }
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysSince);
  // Format date for SOQL - use proper format like '2023-10-01T00:00:00.000Z'
  const soqlDate = cutoffDate.toISOString();

  // Map metadata types to their corresponding Tooling API objects
  const toolingApiMapping: { [key: string]: string } = {
    'ApexClass': 'ApexClass',
    'ApexTrigger': 'ApexTrigger', 
    'Flow': 'Flow',
    'ValidationRule': 'ValidationRule',
    'CustomObject': 'CustomObject',
    'Layout': 'Layout',
    'PermissionSet': 'PermissionSet',
    'Profile': 'Profile',
    'LightningComponentBundle': 'LightningComponentResource',
    'AuraDefinitionBundle': 'AuraDefinition',
    'ApexPage': 'ApexPage',
    'ApexComponent': 'ApexComponent',
    'StaticResource': 'StaticResource'
  };

  for (const metadataType of metadataTypes) {
    const toolingObject = toolingApiMapping[metadataType];
    if (!toolingObject) {
      console.log(`Tooling API mapping not found for ${metadataType}, will retrieve all`);
      continue;
    }

    try {
      // Query for recently modified components
      const soql = `SELECT Name, LastModifiedDate FROM ${toolingObject} WHERE LastModifiedDate >= ${soqlDate} ORDER BY LastModifiedDate DESC LIMIT 1000`;
      console.log(`Querying ${toolingObject} with SOQL: ${soql}`);
      
      const result = await runSfdx(`sf data query --query "${soql}" --target-org ${orgAlias} --json`);
      
      if (result?.result?.records && Array.isArray(result.result.records)) {
        console.log(`Found ${result.result.records.length} recent ${toolingObject} components`);
        for (const record of result.result.records) {
          components.push({
            type: metadataType,
            name: record.Name,
            lastModifiedDate: record.LastModifiedDate
          });
        }
      } else {
        console.log(`No recent ${toolingObject} components found or query failed`);
      }
    } catch (error) {
      console.error(`Failed to query ${toolingObject}:`, error);
      console.log(`Skipping ${metadataType} and will fall back to retrieve all`);
      // Continue with other types - if all fail, we'll fall back to 'all' strategy
    }
  }

  return components;
}

/**
 * Generate package.xml with specific component names (for recent metadata)
 */
export function generatePackageXmlForComponents(components: MetadataComponent[]): string {
  // Group components by type
  const typeMap = new Map<string, string[]>();
  
  for (const component of components) {
    if (!typeMap.has(component.type)) {
      typeMap.set(component.type, []);
    }
    typeMap.get(component.type)!.push(component.name);
  }

  // Generate XML
  const typeElements = Array.from(typeMap.entries()).map(([type, members]) => {
    const memberElements = members.map(member => `    <members>${member}</members>`).join('\n');
    return `  <types>\n${memberElements}\n    <name>${type}</name>\n  </types>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n${typeElements}\n  <version>59.0</version>\n</Package>`;
}

/**
 * Generate package.xml for all metadata (existing behavior)
 */
export function generatePackageXmlForAllMetadata(types: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n${types.map(t => `  <types>\n    <members>*</members>\n    <name>${t}</name>\n  </types>`).join('\n')}\n  <version>59.0</version>\n</Package>`;
}