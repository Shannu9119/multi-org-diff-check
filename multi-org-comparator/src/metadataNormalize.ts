// @ts-ignore
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

function sortDeep(value: any): any {
  if (Array.isArray(value)) {
    const mapped = value.map(sortDeep);
    // Stable sort arrays by JSON string value to achieve deterministic order
    return mapped.sort((a, b) => {
      const sa = typeof a === 'string' ? a : JSON.stringify(a);
      const sb = typeof b === 'string' ? b : JSON.stringify(b);
      return sa.localeCompare(sb);
    });
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    const out: any = {};
    for (const k of keys) out[k] = sortDeep(value[k]);
    return out;
  }
  return value;
}

export function canonicalizeXml(xml: string, type: string): string {
  const parser = new XMLParser({ ignoreAttributes: false });
  const builder = new XMLBuilder({ ignoreAttributes: false, format: true });
  let obj = parser.parse(xml);
  obj = sortDeep(obj);
  return builder.build(obj);
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n+$/g, '');
}
