import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

function getDxRoot(): string | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return undefined;
  for (const folder of workspaceFolders) {
    const rootPath = folder.uri.fsPath;
    const rootSfdx = path.join(rootPath, 'sfdx-project.json');
    if (fs.existsSync(rootSfdx)) return rootPath;
    try {
      const subdirs = fs.readdirSync(rootPath, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const d of subdirs) {
        const p = path.join(rootPath, d.name, 'sfdx-project.json');
        if (fs.existsSync(p)) return path.join(rootPath, d.name);
      }
    } catch {}
  }
  return undefined;
}

async function cleanRetrievalFolders(): Promise<{ ok: boolean; message: string }>{
  const dxRoot = getDxRoot();
  if (!dxRoot) return { ok: false, message: 'Salesforce DX project not found in workspace.' };
  const a = path.join(dxRoot, 'retrieve-orgA');
  const b = path.join(dxRoot, 'retrieve-orgB');
  try { if (fs.existsSync(a)) fs.rmSync(a, { recursive: true, force: true }); } catch {}
  try { if (fs.existsSync(b)) fs.rmSync(b, { recursive: true, force: true }); } catch {}
  return { ok: true, message: 'Retrieval folders cleaned.' };
}

export class AssistantViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'multiOrgComparator.assistant';
  private view?: vscode.WebviewView;

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = { 
      enableScripts: true,
      localResourceRoots: []
    };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      try {
        console.log('Assistant received message:', msg);
        
        if (msg?.type === 'action') {
          await this.handleAction(msg.action);
        } else if (msg?.type === 'chat') {
          await this.handleChatMessage(msg.message);
        }
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        console.error('Assistant error:', err);
        vscode.window.showErrorMessage('Assistant error: ' + err.message);
        this.sendAssistantReply('Sorry, I encountered an error: ' + err.message);
      }
    });
  }

  private async handleAction(action: string) {
    try {
      console.log('Processing action:', action);
      
      switch (action) {
        case 'start':
          vscode.window.showInformationMessage('Starting comparison from Assistant...');
          await vscode.commands.executeCommand('multiOrgComparator.start');
          break;
        case 'results':
          await vscode.commands.executeCommand('multiOrgComparator.showResults');
          vscode.window.showInformationMessage('Opened results view');
          break;
        case 'clean': {
          const res = await cleanRetrievalFolders();
          vscode.window.showInformationMessage(res.message);
          break;
        }
        default:
          vscode.window.showInformationMessage('Unknown action: ' + action);
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      vscode.window.showErrorMessage('Action failed: ' + err.message);
    }
  }

  private async handleChatMessage(message: string) {
    const lowerMsg = message.toLowerCase();
    
    try {
      if (lowerMsg.includes('start') || lowerMsg.includes('comparison') || lowerMsg.includes('compare')) {
        // Parse the message for specific orgs and metadata types
        const parsedRequest = this.parseComparisonRequest(message);
        
        if (parsedRequest.orgs.length > 0 || parsedRequest.metadataTypes.length > 0) {
          // Show what we parsed but don't claim they exist yet
          this.sendAssistantReply(`I understand you want to compare:
${parsedRequest.orgs.length > 0 ? `• Orgs: ${parsedRequest.orgs.join(', ')}` : ''}
${parsedRequest.metadataTypes.length > 0 ? `• Metadata: ${parsedRequest.metadataTypes.join(', ')}` : ''}

Let me check if these orgs are authenticated and start the comparison...`);
        } else {
          this.sendAssistantReply('Starting a new comparison for you! Please select your orgs and metadata types in the prompts that will appear.');
        }
        
        await vscode.commands.executeCommand('multiOrgComparator.startWithContext', {
          suggestedOrgs: parsedRequest.orgs,
          suggestedMetadata: parsedRequest.metadataTypes,
          originalMessage: message,
          assistantCallback: (result: any) => this.handleComparisonResult(result)
        });
        
      } else if (lowerMsg.includes('result') || lowerMsg.includes('show') || lowerMsg.includes('view')) {
        this.sendAssistantReply('Opening the comparison results view for you.');
        await vscode.commands.executeCommand('multiOrgComparator.showResults');
        
      } else if (lowerMsg.includes('clean') || lowerMsg.includes('clear') || lowerMsg.includes('delete')) {
        this.sendAssistantReply('Cleaning up the retrieval folders...');
        const res = await cleanRetrievalFolders();
        this.sendAssistantReply(res.message);
        
      } else if (lowerMsg.includes('help') || lowerMsg.includes('how') || lowerMsg.includes('what')) {
        this.sendAssistantReply(`🤖 Multi-Org Comparison Assistant

I help you compare Salesforce metadata between different orgs intelligently!

🚀 Smart Comparisons:
Just tell me what you want to compare naturally:
• "Compare apex classes between Dev and Prod"
• "Check flows in staging vs production"  
• "Compare validation rules between SIT and UAT"

🎯 What I Do:
✅ Auto-detect orgs from your message
✅ Auto-select metadata types you mention  
✅ Skip manual prompts when possible
✅ Guide you through authentication if needed
✅ Show organized diff results with line-by-line changes

🔐 Authentication Help:
If orgs aren't found, I'll guide you through:
• 'sf org login web --alias Dev' (for your orgs)
• 'sf org list' (to verify authentication)

📊 Other Commands:
• "Show results" - View last comparison
• "Clean folders" - Remove temporary data  
• "How to authenticate" - Authentication help

💡 Pro Tip: Use descriptive org aliases like "Dev", "Prod", "Staging" for better auto-detection!

Ready to compare? Just ask me naturally! 🚀`);
        
      } else if (lowerMsg.includes('auth') || lowerMsg.includes('login') || lowerMsg.includes('connect')) {
        this.sendAssistantReply(`🔐 Salesforce Authentication Help

To authenticate your Salesforce orgs:

STEP 1: For Production/Developer Orgs
→ sf org login web --alias MyProd

STEP 2: For Sandboxes  
→ sf org login web --alias MySandbox --instance-url https://test.salesforce.com

STEP 3: Check authenticated orgs
→ sf org list

💡 Pro Tips:
• Use descriptive aliases like "Dev", "Prod", "Staging" for better auto-detection
• You can authenticate multiple orgs with different aliases  
• The web login will open your browser for secure authentication

Once authenticated, ask me to "compare apex classes between Dev and Prod" and I'll auto-select them! 🚀`);

      } else if (lowerMsg.includes('apex') || lowerMsg.includes('flow') || lowerMsg.includes('metadata')) {
        this.sendAssistantReply(`I can help you compare ${lowerMsg.includes('apex') ? 'Apex Classes/Triggers' : lowerMsg.includes('flow') ? 'Flows' : 'various metadata types'} between your orgs. 

Example requests:
• "Compare apex classes between Dev and Prod"
• "Check flows in staging vs production"  
• "Compare validation rules between SIT and UAT"

If your orgs aren't authenticated yet, just ask me "how to authenticate" and I'll guide you through it! 💡`);
        
      } else if (lowerMsg.includes('error') || lowerMsg.includes('not found') || lowerMsg.includes('fail')) {
        this.sendAssistantReply(`🔍 Troubleshooting Help

Common issues and solutions:

ISSUE: "No authenticated orgs found"
→ SOLUTION: Run 'sf org login web --alias MyOrg'

ISSUE: "Org not found" (e.g., "DEV" not found)  
→ SOLUTION 1: Check authenticated orgs with 'sf org list'
→ SOLUTION 2: Use exact aliases or authenticate missing orgs

ISSUE: "Salesforce DX project not found"
→ SOLUTION 1: Open a folder containing 'sfdx-project.json'
→ SOLUTION 2: I'll help you select the correct project folder

ISSUE: "Retrieve failed"
→ SOLUTION 1: Check org permissions and network connectivity
→ SOLUTION 2: Verify the org is active and accessible

Need help with authentication? Just ask "how to authenticate"! 🛠️`);
        
      } else {
        this.sendAssistantReply(`I understand you want to: "${message}"

I can help with:
• 🚀 Comparisons: "Compare apex classes between Dev and Prod"
• 📋 Results: "Show me the results" 
• 🧹 Cleanup: "Clean retrieval folders"
• 🔐 Authentication: "How to authenticate orgs"
• ❓ Help: "How does this tool work"

Quick Examples:
• "Compare flows between staging and prod"
• "Check validation rules in dev vs uat"
• "Help with authentication"

What would you like to do? 🤔`);
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.sendAssistantReply('Sorry, I encountered an error: ' + err.message);
    }
  }

  private sendAssistantReply(content: string) {
    this.view?.webview.postMessage({ type: 'assistantReply', content: content });
  }

  private handleComparisonResult(result: { success: boolean, error?: string, missingOrgs?: string[], availableOrgs?: string[] }) {
    if (!result.success && result.error) {
      if (result.error.includes('No authenticated Salesforce orgs found')) {
        this.sendAssistantReply(`❌ No Salesforce orgs found!

It looks like you don't have any authenticated Salesforce orgs in VS Code yet.

To get started, follow these steps:

STEP 1: Open the integrated terminal
→ Go to Terminal → New Terminal

STEP 2: Authenticate your orgs
→ For Production/Developer orgs:
   sf org login web --alias MyProd

→ For Sandboxes:
   sf org login web --alias MySandbox --instance-url https://test.salesforce.com

STEP 3: Verify authentication
→ sf org list

Once you've authenticated your orgs, come back and ask me to compare them again! 🚀`);
      } else if (result.missingOrgs && result.missingOrgs.length > 0) {
        const missing = result.missingOrgs.join(', ');
        const available = result.availableOrgs?.length ? result.availableOrgs.join(', ') : 'none';
        
        this.sendAssistantReply(`❌ Requested orgs not found!

I couldn't find these orgs: ${missing}

Available authenticated orgs: ${available}

To add the missing orgs:

STEP 1: Open terminal and authenticate them
→ sf org login web --alias ${result.missingOrgs[0]}

STEP 2: Or try again with available orgs
→ Say something like: "Compare apex classes between ${available.split(', ').slice(0, 2).join(' and ')}"

💡 Pro tip: Use org aliases that match common names like "Dev", "Prod", "Staging" for better auto-detection!`);
      } else {
        this.sendAssistantReply(`❌ Comparison failed

${result.error}

Please check your org authentication and try again. You can run 'sf org list' in the terminal to see your authenticated orgs.`);
      }
    }
  }

  private parseComparisonRequest(message: string): { orgs: string[], metadataTypes: string[] } {
    const lowerMsg = message.toLowerCase();
    const orgs: string[] = [];
    const metadataTypes: string[] = [];

    // First, try to extract specific org names from patterns like "between X and Y"
    const betweenMatch = message.match(/between\s+([a-zA-Z0-9_.-]+)\s+and\s+([a-zA-Z0-9_.-]+)/i);
    if (betweenMatch) {
      orgs.push(betweenMatch[1], betweenMatch[2]);
    }

    // Also try "X and Y" pattern without "between"
    const andMatch = message.match(/\b([a-zA-Z0-9_.-]+)\s+and\s+([a-zA-Z0-9_.-]+)\s+for/i);
    if (andMatch) {
      orgs.push(andMatch[1], andMatch[2]);
    }

    // Common org keyword patterns (fallback)
    const orgPatterns = [
      { pattern: /\b(dev|development)\b/g, name: 'Dev' },
      { pattern: /\b(sit|staging|stage)\b/g, name: 'SIT' },
      { pattern: /\b(prod|production)\b/g, name: 'Production' },
      { pattern: /\b(uat|user acceptance)\b/g, name: 'UAT' },
      { pattern: /\b(test|testing)\b/g, name: 'Test' },
      { pattern: /\b(sandbox|sb)\b/g, name: 'Sandbox' },
      { pattern: /\b(hotfix)\b/g, name: 'Hotfix' }
    ];

    // If no specific org names found, try keyword patterns
    if (orgs.length === 0) {
      for (const { pattern, name } of orgPatterns) {
        if (pattern.test(lowerMsg)) {
          orgs.push(name);
          pattern.lastIndex = 0; // Reset regex
        }
      }
    }

    // Metadata type patterns
    const metadataPatterns = [
      { pattern: /\b(apex class|apexclass|apex classes)\b/g, name: 'ApexClass' },
      { pattern: /\b(apex trigger|apextrigger|triggers?)\b/g, name: 'ApexTrigger' },
      { pattern: /\b(flows?\b|flow definition)\b/g, name: 'Flow' },
      { pattern: /\b(lightning component|lwc|aura)\b/g, name: 'LightningComponentBundle' },
      { pattern: /\b(validation rule|validation rules)\b/g, name: 'ValidationRule' },
      { pattern: /\b(custom object|custom objects|objects?)\b/g, name: 'CustomObject' },
      { pattern: /\b(permission set|permission sets|permset)\b/g, name: 'PermissionSet' },
      { pattern: /\b(profiles?\b)\b/g, name: 'Profile' },
      { pattern: /\b(layouts?\b|page layout)\b/g, name: 'Layout' },
      { pattern: /\b(email template|email templates)\b/g, name: 'EmailTemplate' },
      { pattern: /\b(static resource|static resources)\b/g, name: 'StaticResource' },
      { pattern: /\b(workflow|workflows)\b/g, name: 'Workflow' }
    ];

    // Extract metadata types
    for (const { pattern, name } of metadataPatterns) {
      if (pattern.test(lowerMsg)) {
        metadataTypes.push(name);
        pattern.lastIndex = 0; // Reset regex
      }
    }

    // Remove duplicates
    return {
      orgs: [...new Set(orgs)],
      metadataTypes: [...new Set(metadataTypes)]
    };
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Multi-Org Assistant</title>
  <style>
    body { 
      font-family: var(--vscode-font-family); 
      font-size: 13px; 
      padding: 10px; 
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
    }
    .chat-container {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
      margin-bottom: 10px;
      min-height: 200px;
      max-height: 300px;
    }
    .message {
      margin-bottom: 10px;
      padding: 8px;
      border-radius: 4px;
    }
    .message.user {
      background: var(--vscode-inputValidation-infoBorder);
      color: var(--vscode-foreground);
      margin-left: 20px;
    }
    .message.assistant {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      margin-right: 20px;
    }
    .chat-input-container {
      display: flex;
      gap: 8px;
      margin-bottom: 15px;
    }
    .chat-input {
      flex: 1;
      padding: 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      outline: none;
    }
    .send-btn {
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      cursor: pointer;
    }
    .send-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .quick-actions {
      border-top: 1px solid var(--vscode-panel-border);
      padding-top: 15px;
    }
    .quick-actions h4 {
      margin: 0 0 10px 0;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .action-btn { 
      display: inline-block;
      width: calc(50% - 4px);
      padding: 8px 12px; 
      margin: 2px; 
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-button-border, transparent);
      cursor: pointer;
      font-size: 12px;
      text-align: center;
    }
    .action-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .welcome {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      margin-bottom: 15px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="chat-container">
    <div class="welcome">💬 Multi-Org Comparison Assistant</div>
    
    <div class="chat-messages" id="chatMessages">
      <div class="message assistant">
        <strong>Assistant:</strong> Hi! I can help you compare Salesforce metadata between two orgs. 
        <br><br>
        You can ask me things like:
        <br>• "Start a new comparison"
        <br>• "Show me the results"  
        <br>• "Clean up retrieval folders"
        <br>• "Help me compare ApexClasses between Dev and Prod"
        <br><br>
        What would you like to do?
      </div>
    </div>
    
    <div class="chat-input-container">
      <input type="text" class="chat-input" id="chatInput" placeholder="Ask me to start a comparison, show results, or anything else..." />
      <button class="send-btn" onclick="sendMessage()">Send</button>
    </div>
    
    <div class="quick-actions">
      <h4>Quick Actions:</h4>
      <button class="action-btn" onclick="quickAction('start')">🚀 Start</button>
      <button class="action-btn" onclick="quickAction('results')">📋 Results</button>
      <button class="action-btn" onclick="quickAction('clean')">🧹 Clean</button>
      <button class="action-btn" onclick="quickAction('help')">❓ Help</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const chatMessages = document.getElementById('chatMessages');
    const chatInput = document.getElementById('chatInput');
    
    // Handle incoming messages from extension
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'assistantReply') {
        addMessage('assistant', message.content);
      }
    });
    
    function addMessage(sender, content) {
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message ' + sender;
      messageDiv.innerHTML = '<strong>' + (sender === 'user' ? 'You' : 'Assistant') + ':</strong> ' + content;
      chatMessages.appendChild(messageDiv);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    function sendMessage() {
      const message = chatInput.value.trim();
      if (!message) return;
      
      addMessage('user', message);
      chatInput.value = '';
      
      // Send to extension for processing
      vscode.postMessage({ type: 'chat', message: message });
    }
    
    function quickAction(action) {
      let message = '';
      switch(action) {
        case 'start': message = 'Start a new comparison'; break;
        case 'results': message = 'Show me the results'; break;
        case 'clean': message = 'Clean retrieval folders'; break;
        case 'help': message = 'Help me understand how to use this tool'; break;
      }
      
      addMessage('user', message);
      vscode.postMessage({ type: 'chat', message: message });
    }
    
    // Enter key support
    chatInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        sendMessage();
      }
    });
    
    console.log('Interactive Assistant loaded');
  </script>
</body>
</html>`;
  }

  private helpText(): string {
    return [
      'Multi-Org Assistant',
      'Available actions:',
      '• Start Comparison - Select orgs and metadata types to compare',
      '• Open Results - View the comparison results',
      '• Clean Retrieval Folders - Delete temporary retrieval data',
    ].join('\n');
  }
}

export function registerAssistantView(context: vscode.ExtensionContext) {
  const provider = new AssistantViewProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AssistantViewProvider.viewId, provider)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('multiOrgComparator.assistant.focus', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.multiOrgComparator');
      await vscode.commands.executeCommand('workbench.views.focusView', AssistantViewProvider.viewId);
    }),
    vscode.commands.registerCommand('multiOrgComparator.cleanRetrieval', async () => {
      const res = await cleanRetrievalFolders();
      vscode.window.showInformationMessage(res.message);
    })
  );
}