import * as vscode from 'vscode';
import { registerStartComparison } from './commands/startComparison';
import { focusResultsView } from './treeView';
import { registerAssistantView } from './assistantView';

export function activate(context: vscode.ExtensionContext) {
  try {
    registerStartComparison(context);
  registerAssistantView(context);
    context.subscriptions.push(
      vscode.commands.registerCommand('multiOrgComparator.showResults', async () => {
        await focusResultsView();
      })
    );
  } catch (e) {
    const err = e as Error;
    console.error('Error during activate:', err);
    vscode.window.showErrorMessage('Extension activation error: ' + err.message + '\n' + (err.stack || ''));
    throw e;
  }
}

export function deactivate() {}
