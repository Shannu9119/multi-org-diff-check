import * as vscode from 'vscode';
import { runSfdx, getOrgAliases } from '../sfdx';
import * as path from 'path';
import * as fs from 'fs';
import { generatePackageXml } from '../packageXml';
import { getRecentlyModifiedMetadata, generatePackageXmlForComponents, generatePackageXmlForAllMetadata } from '../recentMetadata';
import { canonicalizeXml, normalizeText } from '../metadataNormalize';
import { summarizeDiff } from '../diffEngine';
import { TempUtil } from '../tempUtil';
import { upsertResultsProvider, registerTreeViewCommands } from '../treeView';

export function registerStartComparison(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('multiOrgComparator.start', async () => {
      await runStartComparison(context);
    }),
    vscode.commands.registerCommand('multiOrgComparator.startWithContext', async (contextData?: {
      suggestedOrgs?: string[],
      suggestedMetadata?: string[],
      retrievalHint?: 'all' | 'recent',
      originalMessage?: string,
      assistantCallback?: (result: { success: boolean, error?: string, missingOrgs?: string[], availableOrgs?: string[] }) => void
    }) => {
      await runStartComparison(context, contextData);
    })
  );
}

async function runStartComparison(context: vscode.ExtensionContext, contextData?: {
  suggestedOrgs?: string[],
  suggestedMetadata?: string[],
  retrievalHint?: 'all' | 'recent',
  originalMessage?: string,
  assistantCallback?: (result: { success: boolean, error?: string, missingOrgs?: string[], availableOrgs?: string[] }) => void
}) {
      try {
      // Step 0: First, determine the retrieval strategy (All vs Recent)
      let retrievalStrategy: 'all' | 'recent' = 'all';
      
      // Check if strategy is suggested from assistant
      if (contextData?.retrievalHint) {
        retrievalStrategy = contextData.retrievalHint;
        vscode.window.showInformationMessage(`Using ${retrievalStrategy === 'all' ? 'All Metadata' : 'Recently Updated Metadata'} strategy based on your request.`);
      } else {
        // Ask user to choose strategy
        const strategyOptions = [
          {
            label: '📋 All Metadata',
            description: 'Compare all metadata of selected types (comprehensive)',
            detail: 'Retrieves and compares all components - thorough but slower'
          },
          {
            label: '🕐 Recently Updated Metadata',
            description: 'Compare only recently modified metadata (last 30 days)',
            detail: 'Faster comparison focusing on recent changes'
          }
        ];
        
        const selectedStrategy = await vscode.window.showQuickPick(strategyOptions, {
          placeHolder: 'Choose comparison strategy',
          ignoreFocusOut: true,
          title: 'Multi-Org Comparison Strategy'
        });
        
        if (!selectedStrategy) return;
        
        retrievalStrategy = selectedStrategy.label.includes('Recently') ? 'recent' : 'all';
      }

      // Step 1: Select two orgs (with smart defaults from context)
      const orgAliases = await getOrgAliases();
      if (!orgAliases.length) {
        const errorMsg = 'No authenticated Salesforce orgs found.';
        vscode.window.showErrorMessage(errorMsg);
        
        // If called from assistant with callback, send detailed feedback
        if (contextData?.assistantCallback) {
          contextData.assistantCallback({ success: false, error: errorMsg });
        }
        return;
      }

      let orgA: string | undefined;
      let orgB: string | undefined;

      // Try to auto-select orgs based on context
      if (contextData?.suggestedOrgs && contextData.suggestedOrgs.length >= 2) {
        const matchedOrgs: string[] = [];
        const missingOrgs: string[] = [];
        
        for (const suggested of contextData.suggestedOrgs) {
          const match = orgAliases.find(alias => 
            alias.toLowerCase().includes(suggested.toLowerCase()) || 
            suggested.toLowerCase().includes(alias.toLowerCase())
          );
          if (match) {
            matchedOrgs.push(match);
          } else {
            missingOrgs.push(suggested);
          }
        }
        
        // If some orgs are missing, provide helpful feedback
        if (missingOrgs.length > 0 && contextData?.assistantCallback) {
          contextData.assistantCallback({ 
            success: false, 
            error: 'Some requested orgs not found',
            missingOrgs: missingOrgs,
            availableOrgs: orgAliases
          });
          return;
        }
        
        if (matchedOrgs.length >= 2) {
          orgA = matchedOrgs[0];
          orgB = matchedOrgs[1];
          vscode.window.showInformationMessage(`Auto-selected orgs: ${orgA} and ${orgB}`);
        } else if (matchedOrgs.length === 1) {
          orgA = matchedOrgs[0];
          vscode.window.showInformationMessage(`Found org: ${orgA}, please select the second org manually.`);
        }
      }

      // If not auto-selected, prompt for selection
      if (!orgA) {
        orgA = await vscode.window.showQuickPick(orgAliases, { placeHolder: 'Select First Org (Source)', ignoreFocusOut: true });
        if (!orgA) return;
      }
      
      if (!orgB) {
        const remainingOrgs = orgAliases.filter(o => o !== orgA);
        orgB = await vscode.window.showQuickPick(remainingOrgs, { placeHolder: 'Select Second Org (Target)', ignoreFocusOut: true });
        if (!orgB) return;
      }

      if (orgA === orgB) {
        vscode.window.showErrorMessage('Please select two different orgs.');
        return;
      }
      // Step 2: Select metadata types (with smart defaults from context)
      const metadataTypes = [
        // Core code & UI
        'ApexClass','ApexTrigger','LightningComponentBundle','AuraDefinitionBundle','ApexPage','ApexComponent','StaticResource',
        // Data / model
        'CustomObject','CustomMetadata','CustomLabels','GlobalValueSet', 'Layout','FlexiPage','LightningPage','FieldSet','RecordType',
        // Security / access
        'PermissionSet','PermissionSetGroup','CustomPermission','NamedCredential','RemoteSiteSetting',
        // Automation / logic
        'Flow','FlowDefinition','ValidationRule','Workflow','AssignmentRules','EscalationRules','MatchingRules','DuplicateRule','QuickAction',
        // Experience / UI layer
        'ExperienceBundle','NavigationMenu','CustomSite','EmailTemplate','CustomApplication',
        // Misc
        'ContentAsset','Profile'
      ];

      let selectedTypes: string[] | undefined;

      // Try to auto-select metadata types based on context
      if (contextData?.suggestedMetadata && contextData.suggestedMetadata.length > 0) {
        const matchedTypes = contextData.suggestedMetadata.filter(suggested => 
          metadataTypes.includes(suggested)
        );
        
        if (matchedTypes.length > 0) {
          selectedTypes = matchedTypes;
          vscode.window.showInformationMessage(`Auto-selected metadata types: ${matchedTypes.join(', ')}`);
        }
      }

      // If not auto-selected, prompt for selection
      if (!selectedTypes) {
        selectedTypes = await vscode.window.showQuickPick(metadataTypes, { 
          canPickMany: true, 
          placeHolder: 'Select metadata types to compare', 
          ignoreFocusOut: true 
        });
      }

      if (!selectedTypes || !selectedTypes.length) {
        vscode.window.showErrorMessage('Select at least one metadata type.');
        return;
      }

      // For recent metadata strategy, ask for the number of days
      let daysSince: number = 30; // Default to 30 days for recent metadata
      if (retrievalStrategy === 'recent') {
        const daysInput = await vscode.window.showInputBox({
          prompt: 'How many days back to check for modifications?',
          value: '30',
          validateInput: (value) => {
            const num = parseInt(value);
            if (isNaN(num) || num <= 0 || num > 365) {
              return 'Please enter a valid number between 1 and 365';
            }
            return null;
          },
          ignoreFocusOut: true
        });
        if (!daysInput) return;
        daysSince = parseInt(daysInput);
      }

      // Step 3: Retrieve metadata for each org (with progress UI)
      // Find DX project root (where sfdx-project.json exists) in workspace or subfolders
      let workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        const pickWorkspace = await vscode.window.showOpenDialog({ canSelectFolders: true, openLabel: 'Select workspace folder' });
        if (!pickWorkspace || pickWorkspace.length === 0) {
          vscode.window.showErrorMessage('No workspace folder open.');
          return;
        }
        // Create a minimal workspaceFolders-like array using the picked folder
        workspaceFolders = [{ uri: pickWorkspace[0] } as any];
      }
      let dxRoot: string | undefined;
      let checkedPaths: string[] = [];
      for (const folder of workspaceFolders) {
        const rootPath = folder.uri.fsPath;
        const rootSfdx = path.join(rootPath, 'sfdx-project.json');
        checkedPaths.push(rootSfdx);
        if (fs.existsSync(rootSfdx)) {
          dxRoot = rootPath;
          break;
        }
        // Check immediate subfolders
        const subdirs = fs.readdirSync(rootPath, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => path.join(rootPath, d.name));
        for (const subdir of subdirs) {
          const subSfdx = path.join(subdir, 'sfdx-project.json');
          checkedPaths.push(subSfdx);
          if (fs.existsSync(subSfdx)) {
            dxRoot = subdir;
            break;
          }
        }
        if (dxRoot) break;
      }
      if (!dxRoot) {
        // Prompt user to pick a folder as a last resort
        const pick = await vscode.window.showOpenDialog({ canSelectFolders: true, openLabel: 'Select Salesforce DX project folder' });
        if (!pick || pick.length === 0) {
          vscode.window.showErrorMessage('Salesforce DX project not found. Checked paths:\n' + checkedPaths.join('\n'));
          return;
        }
        dxRoot = pick[0].fsPath;
        if (!fs.existsSync(path.join(dxRoot, 'sfdx-project.json'))) {
          vscode.window.showErrorMessage('Selected folder does not contain sfdx-project.json');
          return;
        }
      }
      // Revert to fixed retrieve folders (original behavior)
      const orgAFolder = path.join(dxRoot, 'retrieve-orgA');
      const orgBFolder = path.join(dxRoot, 'retrieve-orgB');
      
      console.log(`DX Root: ${dxRoot}`);
      console.log(`${orgA} Folder: ${orgAFolder}`);
      console.log(`${orgB} Folder: ${orgBFolder}`);
      
      // Clean them before reuse to avoid stale overlap
      try { 
        if (fs.existsSync(orgAFolder)) {
          console.log(`Cleaning existing ${orgA} folder: ${orgAFolder}`);
          fs.rmSync(orgAFolder, { recursive: true, force: true }); 
        }
      } catch (e) { 
        console.error(`Error cleaning ${orgA} folder:`, e);
      }
      
      try { 
        if (fs.existsSync(orgBFolder)) {
          console.log(`Cleaning existing ${orgB} folder: ${orgBFolder}`);
          fs.rmSync(orgBFolder, { recursive: true, force: true }); 
        }
      } catch (e) { 
        console.error(`Error cleaning ${orgB} folder:`, e);
      }
      
      try {
        console.log(`Creating ${orgA} folder: ${orgAFolder}`);
        fs.mkdirSync(orgAFolder, { recursive: true });
        console.log(`Creating ${orgB} folder: ${orgBFolder}`);
        fs.mkdirSync(orgBFolder, { recursive: true });
      } catch (e) {
        console.error('Error creating folders:', e);
        vscode.window.showErrorMessage(`Failed to create retrieval folders: ${e}`);
        return;
      }
      
      // Generate package.xml based on retrieval strategy
      // Start with default - all metadata for both orgs
      let pkgXmlA: string = generatePackageXmlForAllMetadata(selectedTypes);
      let pkgXmlB: string = generatePackageXmlForAllMetadata(selectedTypes);
      
      console.log(`Initial package.xml generated with ${selectedTypes.length} metadata types: ${selectedTypes.join(', ')}`);
      let recentComponentsA: any[] = [];
      let recentComponentsB: any[] = [];

      if (retrievalStrategy === 'recent') {
        // Get recently modified components for both orgs
        await vscode.window.withProgress({ 
          location: vscode.ProgressLocation.Notification, 
          title: `Querying recently modified metadata (last ${daysSince} days)...`, 
          cancellable: false 
        }, async (progress) => {
          progress.report({ message: `Checking recent metadata in ${orgA}...` });
          try {
            recentComponentsA = await getRecentlyModifiedMetadata(orgA, selectedTypes, daysSince);
            console.log(`Successfully got ${recentComponentsA.length} recent components from ${orgA}`);
          } catch (e) {
            console.warn(`Failed to get recent metadata for ${orgA}:`, e);
            recentComponentsA = [];
            vscode.window.showWarningMessage(`Could not query recent metadata from ${orgA}. Will use all metadata instead.`);
          }
          
          progress.report({ message: `Checking recent metadata in ${orgB}...` });
          try {
            recentComponentsB = await getRecentlyModifiedMetadata(orgB, selectedTypes, daysSince);
            console.log(`Successfully got ${recentComponentsB.length} recent components from ${orgB}`);
          } catch (e) {
            console.warn(`Failed to get recent metadata for ${orgB}:`, e);
            recentComponentsB = [];
            vscode.window.showWarningMessage(`Could not query recent metadata from ${orgB}. Will use all metadata instead.`);
          }
        });

        // If no recent components found, inform user and fallback to all metadata
        if (recentComponentsA.length === 0 && recentComponentsB.length === 0) {
          const fallbackChoice = await vscode.window.showWarningMessage(
            `No recently modified metadata found in either org (last ${daysSince} days). Would you like to retrieve all metadata instead?`,
            'Yes, Get All', 'Cancel'
          );
          if (fallbackChoice !== 'Yes, Get All') {
            return;
          }
          retrievalStrategy = 'all';
        } else {
          // Generate specific package.xml for each org based on their recent components
          pkgXmlA = recentComponentsA.length > 0 ? generatePackageXmlForComponents(recentComponentsA) : generatePackageXmlForAllMetadata(selectedTypes);
          pkgXmlB = recentComponentsB.length > 0 ? generatePackageXmlForComponents(recentComponentsB) : generatePackageXmlForAllMetadata(selectedTypes);
          
          vscode.window.showInformationMessage(
            `Found ${recentComponentsA.length} recent components in ${orgA} and ${recentComponentsB.length} recent components in ${orgB}`
          );
        }
      }
      
      // If using 'all' strategy or fallback from 'recent'
      if (retrievalStrategy === 'all') {
        console.log(`Using 'all' strategy - generating package.xml for all ${selectedTypes.length} metadata types`);
        pkgXmlA = pkgXmlB = generatePackageXmlForAllMetadata(selectedTypes);
      }

      // Final validation - ensure we have valid package.xml content
      if (!pkgXmlA || pkgXmlA.trim().length === 0) {
        console.warn('pkgXmlA is empty, falling back to all metadata');
        pkgXmlA = generatePackageXmlForAllMetadata(selectedTypes);
      }
      if (!pkgXmlB || pkgXmlB.trim().length === 0) {
        console.warn('pkgXmlB is empty, falling back to all metadata');
        pkgXmlB = generatePackageXmlForAllMetadata(selectedTypes);
      }

      // Write package.xml files
      try {
        const pkgXmlPathA = path.join(orgAFolder, 'package.xml');
        const pkgXmlPathB = path.join(orgBFolder, 'package.xml');
        
        console.log(`Writing package.xml for ${orgA} to: ${pkgXmlPathA}`);
        console.log(`Package XML ${orgA} content length: ${pkgXmlA.length}`);
        console.log(`Package XML ${orgA} content preview: ${pkgXmlA.substring(0, 200)}...`);
        
        // Ensure directories exist before writing
        if (!fs.existsSync(orgAFolder)) {
          console.error(`Directory ${orgAFolder} does not exist!`);
          throw new Error(`Directory ${orgAFolder} does not exist`);
        }
        if (!fs.existsSync(orgBFolder)) {
          console.error(`Directory ${orgBFolder} does not exist!`);
          throw new Error(`Directory ${orgBFolder} does not exist`);
        }
        
        await TempUtil.writeFile(pkgXmlPathA, pkgXmlA);
        
        console.log(`Writing package.xml for ${orgB} to: ${pkgXmlPathB}`);
        console.log(`Package XML ${orgB} content length: ${pkgXmlB.length}`);
        await TempUtil.writeFile(pkgXmlPathB, pkgXmlB);
        
        // Verify files were created
        if (!fs.existsSync(pkgXmlPathA)) {
          throw new Error(`Package.xml for ${orgA} was not created at: ${pkgXmlPathA}`);
        }
        if (!fs.existsSync(pkgXmlPathB)) {
          throw new Error(`Package.xml for ${orgB} was not created at: ${pkgXmlPathB}`);
        }
        
        // Verify file contents
        const createdContentA = fs.readFileSync(pkgXmlPathA, 'utf8');
        const createdContentB = fs.readFileSync(pkgXmlPathB, 'utf8');
        console.log(`Verified ${orgA} package.xml - size: ${createdContentA.length}`);
        console.log(`Verified ${orgB} package.xml - size: ${createdContentB.length}`);
        
        // Validate XML structure
        const validateXML = (content: string, orgName: string) => {
          if (!content.includes('<?xml version="1.0"')) {
            console.error(`${orgName} package.xml missing XML declaration`);
          }
          if (!content.includes('<Package xmlns="http://soap.sforce.com/2006/04/metadata">')) {
            console.error(`${orgName} package.xml missing Package element`);
          }
          if (!content.includes('<version>59.0</version>')) {
            console.error(`${orgName} package.xml missing version element`);
          }
          if (!content.includes('</Package>')) {
            console.error(`${orgName} package.xml missing closing Package tag`);
          }
        };
        
        validateXML(createdContentA, orgA);
        validateXML(createdContentB, orgB);
        
        console.log('Both package.xml files created and validated successfully');
      } catch (e) {
        console.error('Error writing package.xml files:', e);
        vscode.window.showErrorMessage(`Failed to write package.xml files: ${e}`);
        return;
      }
      
      try {
        const retrieveTitle = retrievalStrategy === 'recent' ? `Retrieving recent metadata (${daysSince} days)` : 'Retrieving all metadata';
        
        await vscode.window.withProgress({ 
          location: vscode.ProgressLocation.Notification, 
          title: `${retrieveTitle} from ${orgA}...`, 
          cancellable: false 
        }, async () => {
          const cmdA = `sf project retrieve start --target-org ${orgA} --manifest ${path.join(orgAFolder, 'package.xml')} --output-dir ${orgAFolder} --json`;
          console.log(`Executing SFDX command for ${orgA}:`);
          console.log(`Command: ${cmdA}`);
          console.log(`Working Directory: ${dxRoot}`);
          console.log(`Manifest Path: ${path.join(orgAFolder, 'package.xml')}`);
          console.log(`Output Directory: ${orgAFolder}`);
          
          // Test if org is accessible first
          try {
            console.log(`Testing org connectivity for ${orgA}...`);
            await runSfdx(`sf org display --target-org ${orgA} --json`, { cwd: dxRoot });
            console.log(`✅ ${orgA} is accessible`);
          } catch (orgErr) {
            console.error(`❌ ${orgA} is not accessible:`, orgErr);
            throw new Error(`Cannot access org ${orgA}. Please check: sf org list`);
          }
          
          await runSfdx(cmdA, { cwd: dxRoot });
        });
        
        await vscode.window.withProgress({ 
          location: vscode.ProgressLocation.Notification, 
          title: `${retrieveTitle} from ${orgB}...`, 
          cancellable: false 
        }, async () => {
          const cmdB = `sf project retrieve start --target-org ${orgB} --manifest ${path.join(orgBFolder, 'package.xml')} --output-dir ${orgBFolder} --json`;
          console.log(`Executing SFDX command for ${orgB}:`);
          console.log(`Command: ${cmdB}`);
          console.log(`Working Directory: ${dxRoot}`);
          console.log(`Manifest Path: ${path.join(orgBFolder, 'package.xml')}`);
          console.log(`Output Directory: ${orgBFolder}`);
          
          // Test if org is accessible first
          try {
            console.log(`Testing org connectivity for ${orgB}...`);
            await runSfdx(`sf org display --target-org ${orgB} --json`, { cwd: dxRoot });
            console.log(`✅ ${orgB} is accessible`);
          } catch (orgErr) {
            console.error(`❌ ${orgB} is not accessible:`, orgErr);
            throw new Error(`Cannot access org ${orgB}. Please check: sf org list`);
          }
          
          await runSfdx(cmdB, { cwd: dxRoot });
        });
      } catch (e) {
        vscode.window.showErrorMessage(`Metadata retrieval failed from ${orgA} or ${orgB}: ` + (e as Error).message);
        return;
      }
  // Step 4: Canonicalize and compare. For demo, look for files under each retrieve folder
      const collectFiles = (root: string): string[] => {
        const out: string[] = [];
        const walk = (dir: string) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(p); else out.push(p);
          }
        };
        walk(root);
        return out;
      };
  const filesA = collectFiles(orgAFolder);
  const filesB = collectFiles(orgBFolder);
      // Map by relative path under retrieve folder
      const toRel = (p: string, base: string) => p.substring(base.length + 1).replace(/\\/g, '/');
      const mapA = new Map(filesA.map(f => [toRel(f, orgAFolder), f] as const));
      const mapB = new Map(filesB.map(f => [toRel(f, orgBFolder), f] as const));
      const rels = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort();
      const items: import('../treeView').FileDiffItem[] = [];
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Comparing retrieved metadata…', cancellable: false }, async () => {
        for (const rel of rels) {
          const aPath = mapA.get(rel);
          const bPath = mapB.get(rel);
          try {
            if (aPath && bPath) {
              const aText = fs.readFileSync(aPath, 'utf8');
              const bText = fs.readFileSync(bPath, 'utf8');
              const normA = normalizeText(aText);
              const normB = normalizeText(bText);
              const summary = summarizeDiff(normA, normB);
              if (summary.isDifferent) {
                items.push({
                  type: 'file',
                  label: rel,
                  resourceLeft: vscode.Uri.file(aPath),
                  resourceRight: vscode.Uri.file(bPath),
                  firstChangeLine: summary.firstChangeLine,
                  added: summary.added,
                  removed: summary.removed,
                  status: 'modified',
                  orgAliasLeft: orgA,
                  orgAliasRight: orgB
                } as any);
              }
            } else if (aPath && !bPath) {
              const aText = fs.readFileSync(aPath, 'utf8');
              const normA = normalizeText(aText);
              const lineCount = (normA.match(/\n/g) || []).length + (normA.length > 0 ? 1 : 0);
              const emptyTemp = vscode.Uri.file(aPath + '.empty.right');
              if (!fs.existsSync(emptyTemp.fsPath)) fs.writeFileSync(emptyTemp.fsPath, '', 'utf8');
              items.push({
                type: 'file',
                label: `[Deleted in ${orgB}] ${rel}`,
                resourceLeft: vscode.Uri.file(aPath),
                resourceRight: emptyTemp,
                firstChangeLine: 1,
                added: 0,
                removed: lineCount,
                status: 'deleted',
                orgAliasLeft: orgA,
                orgAliasRight: orgB
              } as any);
            } else if (!aPath && bPath) {
              const bText = fs.readFileSync(bPath, 'utf8');
              const normB = normalizeText(bText);
              const lineCount = (normB.match(/\n/g) || []).length + (normB.length > 0 ? 1 : 0);
              const emptyTemp = vscode.Uri.file(bPath + '.empty.left');
              if (!fs.existsSync(emptyTemp.fsPath)) fs.writeFileSync(emptyTemp.fsPath, '', 'utf8');
              items.push({
                type: 'file',
                label: `[Added in ${orgB}] ${rel}`,
                resourceLeft: emptyTemp,
                resourceRight: vscode.Uri.file(bPath),
                firstChangeLine: 1,
                added: lineCount,
                removed: 0,
                status: 'added',
                orgAliasLeft: orgA,
                orgAliasRight: orgB
              } as any);
            }
          } catch {}
        }
      });
  // Step 5: Show results in tree view
  upsertResultsProvider(context, items);
  registerTreeViewCommands(context);
      if (items.length === 0) {
        vscode.window.showInformationMessage(`Comparison complete. No differences found between ${orgA} and ${orgB}.`);
      } else {
  const action = await vscode.window.showInformationMessage(`Comparison complete. ${items.length} file(s) differ between ${orgA} and ${orgB}.`, 'Open Results');
        if (action === 'Open Results') {
          await vscode.commands.executeCommand('multiOrgComparator.showResults');
        }
        // Also auto-focus the view so users can browse immediately
        await vscode.commands.executeCommand('multiOrgComparator.showResults');
      }
      } catch (err) {
        const e = err as Error;
        console.error('Error in startComparison command:', e);
        vscode.window.showErrorMessage('Error: ' + e.message + '\n' + (e.stack || 'no stack'));
        return;
      }
}
