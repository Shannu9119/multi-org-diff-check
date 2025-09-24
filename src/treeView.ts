import * as vscode from 'vscode';

export type FileDiffItem = {
  type: 'file';
  label: string;
  resourceLeft: vscode.Uri; // Org A
  resourceRight: vscode.Uri; // Org B
  firstChangeLine?: number | null; // 1-based
  added?: number;
  removed?: number;
  status?: 'modified' | 'added' | 'deleted';
};

export class MultiOrgTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;
  private items: FileDiffItem[];
  private filters = { showModified: true, showAdded: true, showDeleted: true, ext: '', text: '' };

  constructor(items: FileDiffItem[]) { this.items = items; }

  setItems(items: FileDiffItem[]) { this.items = items; this._onDidChangeTreeData.fire(); }
  refresh(items?: FileDiffItem[]) { if (items) this.items = items; this._onDidChangeTreeData.fire(); }
  toggleModified() { this.filters.showModified = !this.filters.showModified; this._onDidChangeTreeData.fire(); }
  toggleAdded() { this.filters.showAdded = !this.filters.showAdded; this._onDidChangeTreeData.fire(); }
  toggleDeleted() { this.filters.showDeleted = !this.filters.showDeleted; this._onDidChangeTreeData.fire(); }
  setExtFilter(ext: string) { this.filters.ext = ext || ''; this._onDidChangeTreeData.fire(); }
  setTextFilter(text: string) { this.filters.text = (text || '').toLowerCase(); this._onDidChangeTreeData.fire(); }
  clearFilters() { this.filters = { showModified: true, showAdded: true, showDeleted: true, ext: '', text: '' }; this._onDidChangeTreeData.fire(); }

  private visible(items: FileDiffItem[]): FileDiffItem[] {
    return items.filter(i => {
      const statusOk = (i.status === 'modified' && this.filters.showModified)
        || (i.status === 'added' && this.filters.showAdded)
        || (i.status === 'deleted' && this.filters.showDeleted)
        || (!i.status && this.filters.showModified);
      if (!statusOk) return false;
      const lower = i.label.toLowerCase();
      if (this.filters.ext) {
        const ext = this.filters.ext.startsWith('.') ? this.filters.ext.toLowerCase() : '.' + this.filters.ext.toLowerCase();
        if (!lower.endsWith(ext)) return false;
      }
      if (this.filters.text) {
        if (!lower.includes(this.filters.text)) return false;
      }
      return true;
    });
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    if (element) return [];
    const list = this.visible(this.items);
    return list.map(i => {
      const suffix = (i.added || i.removed) ? ` (+${i.added || 0}/-${i.removed || 0})` : '';
      const t = new vscode.TreeItem(`${i.label}${suffix}`, vscode.TreeItemCollapsibleState.None);
      t.command = { command: 'multiOrgComparator.openDiff', title: 'Open Diff', arguments: [i] };
      t.tooltip = 'Open diff';
      return t;
    });
  }
}
// Singleton provider management to avoid duplicate command registrations
let providerRef: MultiOrgTreeProvider | undefined;
let dataProviderDisposable: vscode.Disposable | undefined;
let commandsRegistered = false;

export function upsertResultsProvider(context: vscode.ExtensionContext, items: FileDiffItem[]) {
  if (!providerRef) {
    providerRef = new MultiOrgTreeProvider(items);
    dataProviderDisposable = vscode.window.registerTreeDataProvider('multiOrgComparator.results', providerRef);
    context.subscriptions.push(dataProviderDisposable);
  } else {
    providerRef.setItems(items);
  }
}

export function registerTreeViewCommands(context: vscode.ExtensionContext) {
  if (commandsRegistered) return;
  commandsRegistered = true;
  context.subscriptions.push(
    vscode.commands.registerCommand('multiOrgComparator.openDiff', async (item: FileDiffItem) => {
      await vscode.commands.executeCommand('vscode.diff', item.resourceLeft, item.resourceRight, item.label);
      if (item.firstChangeLine && item.firstChangeLine > 0) {
        const editors = vscode.window.visibleTextEditors;
        const right = editors.find(e => e.document.uri.toString() === item.resourceRight.toString());
        if (right) {
          const pos = new vscode.Position(Math.max(0, item.firstChangeLine - 1), 0);
          right.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }
      }
    }),
    vscode.commands.registerCommand('multiOrgComparator.refreshResults', () => providerRef?.refresh()),
    vscode.commands.registerCommand('multiOrgComparator.filterModified', () => providerRef?.toggleModified()),
    vscode.commands.registerCommand('multiOrgComparator.filterAdded', () => providerRef?.toggleAdded()),
    vscode.commands.registerCommand('multiOrgComparator.filterDeleted', () => providerRef?.toggleDeleted()),
    vscode.commands.registerCommand('multiOrgComparator.filterByExt', async () => {
      const ext = await vscode.window.showInputBox({ prompt: 'Filter by file extension (e.g. cls, xml). Leave empty to clear.' });
      providerRef?.setExtFilter(ext || '');
    }),
    vscode.commands.registerCommand('multiOrgComparator.filterByName', async () => {
      const text = await vscode.window.showInputBox({ prompt: 'Filter by filename contains (e.g. Account, MyTrigger). Leave empty to clear.' });
      providerRef?.setTextFilter(text || '');
    }),
    vscode.commands.registerCommand('multiOrgComparator.clearFilters', () => providerRef?.clearFilters())
  );
}

export async function focusResultsView() {
  await vscode.commands.executeCommand('workbench.view.extension.multiOrgComparator');
}
