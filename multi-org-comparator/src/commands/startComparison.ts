import * as vscode from 'vscode';
import { runSfdx, getOrgAliases } from '../sfdx';
import * as path from 'path';
import * as fs from 'fs';
import { generatePackageXml } from '../packageXml';
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
  originalMessage?: string,
  assistantCallback?: (result: { success: boolean, error?: string, missingOrgs?: string[], availableOrgs?: string[] }) => void
}) {
      try {
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
        orgA = await vscode.window.showQuickPick(orgAliases, { placeHolder: 'Select Org A', ignoreFocusOut: true });
        if (!orgA) return;
      }
      
      if (!orgB) {
        const remainingOrgs = orgAliases.filter(o => o !== orgA);
        orgB = await vscode.window.showQuickPick(remainingOrgs, { placeHolder: 'Select Org B', ignoreFocusOut: true });
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
      // Clean them before reuse to avoid stale overlap
      try { if (fs.existsSync(orgAFolder)) fs.rmSync(orgAFolder, { recursive: true, force: true }); } catch {}
      try { if (fs.existsSync(orgBFolder)) fs.rmSync(orgBFolder, { recursive: true, force: true }); } catch {}
      fs.mkdirSync(orgAFolder, { recursive: true });
      fs.mkdirSync(orgBFolder, { recursive: true });
      const pkgXml = generatePackageXml(selectedTypes);
      await TempUtil.writeFile(path.join(orgAFolder, 'package.xml'), pkgXml);
      await TempUtil.writeFile(path.join(orgBFolder, 'package.xml'), pkgXml);
      try {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Retrieving metadata from Org A...', cancellable: false }, async () => {
          await runSfdx(`sf project retrieve start --target-org ${orgA} --manifest ${path.join(orgAFolder, 'package.xml')} --output-dir ${orgAFolder} --json`, { cwd: dxRoot });
        });
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Retrieving metadata from Org B...', cancellable: false }, async () => {
          await runSfdx(`sf project retrieve start --target-org ${orgB} --manifest ${path.join(orgBFolder, 'package.xml')} --output-dir ${orgBFolder} --json`, { cwd: dxRoot });
        });
      } catch (e) {
        vscode.window.showErrorMessage('Metadata retrieve failed: ' + (e as Error).message);
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
                  status: 'modified'
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
                label: `[Deleted in B] ${rel}`,
                resourceLeft: vscode.Uri.file(aPath),
                resourceRight: emptyTemp,
                firstChangeLine: 1,
                added: 0,
                removed: lineCount,
                status: 'deleted'
              } as any);
            } else if (!aPath && bPath) {
              const bText = fs.readFileSync(bPath, 'utf8');
              const normB = normalizeText(bText);
              const lineCount = (normB.match(/\n/g) || []).length + (normB.length > 0 ? 1 : 0);
              const emptyTemp = vscode.Uri.file(bPath + '.empty.left');
              if (!fs.existsSync(emptyTemp.fsPath)) fs.writeFileSync(emptyTemp.fsPath, '', 'utf8');
              items.push({
                type: 'file',
                label: `[Added in B] ${rel}`,
                resourceLeft: emptyTemp,
                resourceRight: vscode.Uri.file(bPath),
                firstChangeLine: 1,
                added: lineCount,
                removed: 0,
                status: 'added'
              } as any);
            }
          } catch {}
        }
      });
  // Step 5: Show results in tree view
  upsertResultsProvider(context, items);
  registerTreeViewCommands(context);
      if (items.length === 0) {
        vscode.window.showInformationMessage('Comparison complete. No differences found.');
      } else {
  const action = await vscode.window.showInformationMessage(`Comparison complete. ${items.length} file(s) differ.`, 'Open Results');
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
