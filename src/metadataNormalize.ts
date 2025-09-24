// @ts-ignore
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

export function canonicalizeXml(xml: string, type: string): string {
  const parser = new XMLParser({ ignoreAttributes: false });
  const builder = new XMLBuilder({ ignoreAttributes: false, format: true });
  let obj = parser.parse(xml);
  // TODO: Remove timestamps, ids, sort child nodes deterministically by type
  // Example: if (type === 'CustomObject') obj.CustomObject.fields.sort(...)
  return builder.build(obj);
}

export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
}
