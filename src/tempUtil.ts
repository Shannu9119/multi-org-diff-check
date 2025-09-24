import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export class TempUtil {
  static async createTempDir(prefix: string): Promise<string> {
    const dir = path.join(os.tmpdir(), `multi-org-comparator-${prefix}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  static async writeFile(file: string, content: string) {
    fs.writeFileSync(file, content, 'utf8');
  }
  static async cleanDir(dir: string) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
