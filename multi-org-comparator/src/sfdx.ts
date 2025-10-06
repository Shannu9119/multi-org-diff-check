
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';


export function runSfdx(command: string, opts?: { cwd?: string }): Promise<any> {
  // Determine working directory: prefer override, else detect DX project root
  const checkedPaths: string[] = [];
  let dir: string | undefined = opts?.cwd;
  if (dir && !fs.existsSync(path.join(dir, 'sfdx-project.json'))) {
    // Provided cwd isn't a DX project; ignore override
    dir = undefined;
  }
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!dir && workspaceFolders && workspaceFolders.length > 0) {
    for (const folder of workspaceFolders) {
      const rootPath = folder.uri.fsPath;
      const rootSfdx = path.join(rootPath, 'sfdx-project.json');
      checkedPaths.push(rootSfdx);
      if (fs.existsSync(rootSfdx)) {
        dir = rootPath;
        break;
      }
      // check immediate subfolders
      try {
        const subdirs = fs.readdirSync(rootPath, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => path.join(rootPath, d.name));
        for (const subdir of subdirs) {
          const subSfdx = path.join(subdir, 'sfdx-project.json');
          checkedPaths.push(subSfdx);
          if (fs.existsSync(subSfdx)) {
            dir = subdir;
            break;
          }
        }
      } catch (e) {
        // ignore permission/read errors per folder
      }
      if (dir) break;
    }
  }

  // Fallback: search upward from process.cwd()
  if (!dir) {
    // If no workspace, try searching upward from the extension's directory (__dirname)
    try {
      let start = __dirname;
      while (start && start !== path.parse(start).root) {
        const candidate = path.join(start, 'sfdx-project.json');
        checkedPaths.push(candidate);
        if (fs.existsSync(candidate)) {
          dir = start;
          break;
        }
        start = path.dirname(start);
      }
    } catch (e) {
      // ignore
    }
  }

  if (!dir) {
    let cwd = process.cwd();
    while (cwd && cwd !== path.parse(cwd).root) {
      const candidate = path.join(cwd, 'sfdx-project.json');
      checkedPaths.push(candidate);
      if (fs.existsSync(candidate)) {
        dir = cwd;
        break;
      }
      cwd = path.dirname(cwd);
    }
  }

  if (!dir) {
    // Allow org-related commands to run without a DX project (e.g., 'sf org list')
    const orgCmd = /^\s*sf\s+org\b/i.test(command);
    if (orgCmd) {
      dir = process.cwd();
    } else {
      return Promise.reject(new Error('sfdx-project.json not found. Checked paths:\n' + checkedPaths.join('\n')));
    }
  }

  return new Promise((resolve, reject) => {
    // detect bundled run.js
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const runCandidates = [
      path.join(pf, 'sf', 'client', 'bin', 'run.js'),
      path.join(pf86, 'sf', 'client', 'bin', 'run.js'),
      path.join('C:\\Program Files', 'sf', 'client', 'bin', 'run.js'),
    ];
    let runJs: string | undefined;
    for (const c of runCandidates) if (fs.existsSync(c)) { runJs = c; break; }

    const execAndParse = (cmdToExec: string) => exec(cmdToExec, { cwd: dir, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      try {
        if (err) {
          const outStrErr = typeof stderr === 'string' ? stderr : String(stderr || '');
          const outStrStd = typeof stdout === 'string' ? stdout : String(stdout || '');
          const msg = `Command failed: ${cmdToExec}\nCwd: ${dir}\nError: ${err && (err as any).message}\nSTDERR:\n${outStrErr}\nSTDOUT:\n${outStrStd}`;
          return reject(new Error(msg));
        }
        let outStr = typeof stdout === 'string' ? stdout : String(stdout || '');
        if (outStr && outStr.charCodeAt(0) === 0xfeff) outStr = outStr.slice(1);
        outStr = outStr.trim();
        if (outStr.startsWith('{') || outStr.startsWith('[')) {
          try { return resolve(JSON.parse(outStr)); } catch (parseErr) { return resolve(outStr); }
        }
        return resolve(outStr);
      } catch (e) {
        return reject(e instanceof Error ? e : new Error(String(e)));
      }
    });

    // If bundled runner exists, use it directly
    if (runJs) {
      try {
        const nodeBundled = path.join(path.dirname(runJs), 'node.exe');
        const nodeCmd = fs.existsSync(nodeBundled) ? nodeBundled : process.execPath;
        const parts = command.split(' ').filter(p => p.length > 0);
        if (parts[0].toLowerCase() === 'sf') parts.shift();
        const escapeArg = (p: string) => p.includes(' ') || p.includes('"') ? '"' + p.replace(/"/g, '\\"') + '"' : p;
        const primaryCmd = `"${nodeCmd}" "${runJs}" ${parts.map(escapeArg).join(' ')}`;
        return execAndParse(primaryCmd);
      } catch (e) {
        // fall through to PATH-based sf
      }
    }

    // Default: execute original command as-is (e.g., 'sf ...')
    return execAndParse(command);
  });
}

export async function getOrgAliases(): Promise<string[]> {
  const result = await runSfdx('sf org list --json');
  if (typeof result === 'string') return [];
  const nonScratch = Array.isArray(result.result?.nonScratchOrgs) ? result.result.nonScratchOrgs : [];
  const scratch = Array.isArray(result.result?.scratchOrgs) ? result.result.scratchOrgs : [];
  const all = [...nonScratch, ...scratch];
  const names = all
    .map((o: any) => o.alias || o.username)
    .filter((v: any) => typeof v === 'string' && v.length > 0);
  // Deduplicate while preserving order
  const seen = new Set<string>();
  const dedup: string[] = [];
  for (const n of names) { if (!seen.has(n)) { seen.add(n); dedup.push(n); } }
  return dedup;
}
