import { canonicalizeXml, normalizeText } from '../metadataNormalize';

test('canonicalizeXml normalizes element order', () => {
  const xml1 = `<root><b>2</b><a>1</a></root>`;
  const xml2 = `<root><a>1</a><b>2</b></root>`;
  expect(canonicalizeXml(xml1, 'Test')).toBe(canonicalizeXml(xml2, 'Test'));
});

test('normalizeText removes trailing whitespace and normalizes line endings', () => {
  const t1 = 'foo \r\nbar  \n';
  const t2 = 'foo\nbar';
  expect(normalizeText(t1)).toBe(normalizeText(t2));
});
