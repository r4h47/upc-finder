// Same test vectors as the Android unit tests (ScreenTextParserTest, MatchingTest, OwnBarcodeTest).
// Run: node --test web/tests
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Gtin from '../js/gtin.js';
import * as Text from '../js/text.js';
import { rank, score, makeQuery, sameSize } from '../js/scorer.js';
import { parse, isNoise, cleanOcrLine } from '../js/parser.js';
import { encode } from '../js/barcode.js';

const l = (text, left, top, right, bottom) => ({ text, left, top, right, bottom });
const hit = (code, title, brand = '', size = '', source = 'UPCITEMDB') => ({ code, title, brand, size, imageUrl: null, source });

test('GTIN check digits and keys', () => {
  assert.ok(Gtin.isValid('012345678905'));
  assert.ok(!Gtin.isValid('012345678904'));
  assert.ok(Gtin.isValid('4006381333931'));
  assert.ok(Gtin.isValid('96385074'));
  assert.equal(Gtin.key('012345678905'), Gtin.key('0012345678905'));
  assert.equal(Gtin.displayCode('0012345678905'), '012345678905');
  assert.deepEqual(Gtin.findInText('UPC 012345678905, ref 123456789013, phone 5551234567'), ['012345678905']);
});

test('UPC-E expands; EAN-8 stays EAN-8', () => {
  assert.equal(Gtin.expandUpcE('04252614'), '042100005264');
  assert.equal(Gtin.normalizeInput('04252614'), '042100005264');
  assert.equal(Gtin.expandUpcE('04252615'), null);
  assert.equal(Gtin.normalizeInput('96385074'), '96385074');
  assert.equal(Gtin.normalizeInput(' 0123-4567 8905 '), '012345678905');
});

test('sizes and tokens', () => {
  assert.deepEqual(Text.parseSizes('7-Select Water 20oz'), [{ amount: 20, unit: 'oz' }]);
  assert.deepEqual(Text.parseSizes('Trident Spearmint Value Pack Gum 14 Count'), [{ amount: 14, unit: 'ct' }]);
  assert.deepEqual(Text.parseSizes('7-Select Ultra White Toothbrush 2 Pack'), [{ amount: 2, unit: 'pk' }]);
  assert.deepEqual(Text.parseSizes("Ben & Jerry's Cherry Garcia Pint"), [{ amount: 1, unit: 'pint' }]);
  assert.deepEqual(Text.parseSizes('Water 20 FL. OZ'), [{ amount: 20, unit: 'oz' }]);
  assert.deepEqual(Text.parseSizes('Water 1.5 Liter'), [{ amount: 1.5, unit: 'l' }]);
  assert.deepEqual(Text.parseSizes('7-Select Lauren 1 Lane'), []);
  assert.deepEqual(Text.tokens("Ben & Jerry's Cherry Garcia Pint"), ['ben', 'jerry', 'cherry', 'garcia']);
  assert.deepEqual(Text.tokens('7-Select Water 20oz'), ['7select', 'water']);
  assert.equal(Text.queryKey('7-Select Water 20oz'), Text.queryKey('water 7-select 20 OZ'));
});

// Regression: the live site found nothing because the search service only matches products containing every word.
test('search variants loosen the query', () => {
  assert.deepEqual(Text.searchVariants('7-Select Water 20oz'), ['7-Select Water 20oz', '7-Select Water', '7-Select OR Water']);
  const gum = Text.searchVariants('Trident Spearmint Value Pack Gum 14 Count');
  assert.ok(gum.includes('Trident Spearmint Gum'), gum.join(' | '));
  assert.ok(gum.includes('Trident Spearmint'));
  const bj = Text.searchVariants("Ben & Jerry's Cherry Garcia Pint");
  assert.ok(bj.includes('Ben Jerry Cherry Garcia'), bj.join(' | '));
  assert.ok(bj.includes('Ben Jerry Cherry'));
  assert.ok(Text.searchVariants('7-Select Ultra White Toothbrush 2 Pack').includes('7-Select Ultra White Toothbrush'));
});

// Real OCR names from the live site that showed "No UPC found online".
test('OCR junk words are stripped', () => {
  assert.equal(Text.stripJunk("QA Ben & Jerry's Cherry Garcia"), "Ben & Jerry's Cherry Garcia");
  assert.equal(Text.stripJunk('Trident Spearmint Value BR Pack Gum 14 Count 8'), 'Trident Spearmint Value Pack Gum 14 Count');
  assert.equal(Text.stripJunk('7-Select Ultra White IR Toothbrush 2 Pack'), '7-Select Ultra White Toothbrush 2 Pack');
  assert.equal(Text.stripJunk("4 Ben & Jerry's Cherry Garcia"), "Ben & Jerry's Cherry Garcia");
  assert.equal(Text.stripJunk('7 Select Water 20oz'), '7 Select Water 20oz');
  assert.equal(Text.stripJunk('Monster Energy XL 24 OZ'), 'Monster Energy XL 24 OZ');
  assert.equal(makeQuery("QA Ben & Jerry's Cherry Garcia").brandTokens.join(' '), 'ben jerry');
  assert.ok(Text.searchVariants('Trident Spearmint Value BR Pack Gum 14 Count 8').includes('Trident Spearmint Gum'));
});

test('scorer: right product beats other flavor; pint matches 473 ml', () => {
  const r = rank('Trident Spearmint Value Pack Gum 14 Count', [
    hit('012345678905', 'Trident Original Flavor Sugar Free Gum', 'Trident', '14 ct'),
    hit('4006381333931', 'Trident Spearmint Sugar Free Gum, 14 Pieces', 'Trident'),
  ]);
  assert.equal(r[0].upc, '4006381333931');
  assert.ok(r[0].confidence >= 80, `got ${r[0].confidence}`);
  const p = rank("Ben & Jerry's Cherry Garcia Pint", [hit('012345678905', 'Cherry Garcia', "Ben & Jerry's", '473 ml', 'OPEN_FOOD_FACTS')]);
  assert.ok(p[0].confidence >= 80, `got ${p[0].confidence}`);
  assert.ok(sameSize({ amount: 20, unit: 'oz' }, { amount: 591, unit: 'ml' }));
});

test('scorer: regressions from live tests', () => {
  const q = "Ben & Jerry's Cherry Garcia Pint";
  const r = rank(q, [
    hit('012345678905', 'Pint slices ice cream bars, cherry garcia', "Ben & Jerry's", '266 ml.', 'OPEN_FOOD_FACTS'),
    hit('012345678905', "Ben & Jerry's Cherry Garcia Ice Cream Pint", "Ben & Jerry's", '', 'UPCITEMDB'),
    hit('4006381333931', 'Cherry Garcia Ice Cream', "Ben & Jerry's", '1 pint', 'OPEN_FOOD_FACTS'),
  ]);
  assert.equal(r[0].upc, '4006381333931');
  assert.ok(r.find((c) => c.upc === '012345678905').confidence < 50);
  const s = score(makeQuery('7-Select Ultra White Toothbrush 2 Pack'), hit('052548000011', '7 Select Purified Water', '', '', 'WEB'));
  assert.ok(s <= 25, `got ${s}`);
  const w = score(makeQuery('7-Select Water 20oz'), hit('012345678905', '7-Select Water 20oz', '7-Select', '', 'WEB'));
  assert.ok(w <= 85);
  const right = score(makeQuery('7-Select Water 20oz'), hit('012345678905', '7-Select Purified Water 20 fl oz', '7-Select'));
  const wrong = score(makeQuery('7-Select Water 20oz'), hit('012345678905', '7-Select Purified Water 1 L', '7-Select'));
  assert.ok(right - wrong >= 20);
});

test('scorer: duplicates merge across sources', () => {
  const r = rank('7-Select Water 20oz', [
    hit('012345678905', '7-Select Water 20oz', '7-Select'),
    hit('0012345678905', '7 Select Purified Water', '7-Eleven', '20 fl oz', 'OPEN_FOOD_FACTS'),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].sources.length, 2);
  assert.equal(r[0].upc, '012345678905');
});

test('parser: gum pick screen', () => {
  const lines = [
    l('21:54', 58, 260, 130, 290), l('Lauren_5... • D-5996', 200, 335, 565, 375), l('2 of 3 Items Remain', 205, 400, 605, 440),
    l('Trident', 280, 575, 390, 600), l('QTY 1', 125, 740, 225, 780), l('Report', 750, 725, 850, 760),
    l('Trident', 360, 905, 640, 975), l('REFRESHINGLY LONG LASTING', 400, 983, 548, 993), l('SPEARMINT', 598, 1033, 695, 1048),
    l('14 STICKS SUGAR FREE GUM', 330, 1045, 465, 1065), l('Tap Image to Zoom', 655, 1152, 885, 1182),
    l('Trident Spearmint Value', 135, 1225, 785, 1290), l('Pack Gum 14 Count', 138, 1295, 670, 1360),
    l('Gum / Sugarless', 143, 1405, 420, 1445), l('Balance On Hand: 5', 147, 1510, 430, 1550),
    l('UPC Entry', 260, 1730, 415, 1770), l('Remove', 705, 1720, 828, 1755),
  ];
  const p = parse(lines, 1126, 2000);
  assert.equal(p.name, 'Trident Spearmint Value Pack Gum 14 Count');
  assert.equal(p.size, '14 Count');
  assert.equal(p.category, 'Gum / Sugarless');
  assert.ok(p.isPickScreen);
  assert.ok(p.productRect.top * 2000 > 780 && p.productRect.bottom * 2000 <= 1152);
});

test('parser: ice cream (no QTY row) and toothbrush', () => {
  const ice = parse([
    l('1 of 3 Item Remain', 120, 148, 276, 166), l('Tap Image to Zoom', 297, 420, 402, 432),
    l("Ben & Jerry's Cherry Garcia", 72, 442, 388, 468), l('Pint', 72, 472, 122, 494),
    l('Take Home Frozen Treat / Super Premium', 80, 510, 358, 524), l('Sec 801 Shelf 1 Seq 10', 80, 528, 240, 542),
  ], 461, 1000);
  assert.equal(ice.name, "Ben & Jerry's Cherry Garcia Pint");
  assert.equal(ice.size, 'Pint');
  assert.ok(ice.productRect.top * 1000 > 200);
  const tb = parse([
    l('2 of 3 Items Remain', 318, 150, 635, 190), l('QTY 1', 128, 520, 235, 560), l('Tap Image to Zoom', 712, 955, 962, 985),
    l('7-Select Ultra White', 140, 1040, 728, 1112), l('Toothbrush 2 Pack', 148, 1120, 700, 1192),
    l('Oral Care / Toothbrushes', 155, 1245, 600, 1295), l('Item Fulfilled', 262, 1600, 518, 1650),
  ], 1126, 2000);
  assert.equal(tb.name, '7-Select Ultra White Toothbrush 2 Pack');
  assert.equal(tb.size, '2 Pack');
});

// Real Tesseract output from the sample photos.
test('OCR line cleaner', () => {
  assert.equal(cleanOcrLine('Trident Spearmint Value I'), 'Trident Spearmint Value');
  assert.equal(cleanOcrLine('Gum / Sugarless §'), 'Gum / Sugarless');
  assert.equal(cleanOcrLine('| | Trident Spearmint Value | {1 |'), 'Trident Spearmint Value');
  assert.equal(cleanOcrLine('7-Select Water 200z'), '7-Select Water 20oz');
  assert.equal(cleanOcrLine('| | 7-Select Water200z ~~ | |!'), '7-Select Water 20oz');
  assert.equal(cleanOcrLine("4 Ben & Jerry's Cherry Garcia |"), "4 Ben & Jerry's Cherry Garcia");
  assert.equal(cleanOcrLine('5 Tap Image to Zoom ;'), '5 Tap Image to Zoom');
  assert.equal(cleanOcrLine('Pint'), 'Pint');
  assert.equal(cleanOcrLine('7-Select Ultra White'), '7-Select Ultra White');
});

test('parser: noise filter', () => {
  for (const t of ['21:54', 'QTY 1', 'Report', 'UPC Entry', 'Remove', 'HOME', 'BACK', 'Balance On Hand: 5', 'Possibly Out of Stock', '2 of 3 Items Remain', '4G'])
    assert.ok(isNoise(t), t);
  assert.ok(!isNoise('7-Select Water 20oz'));
});

test('barcode encoder: UPC-A has 95 modules with guard bars; EAN-8 has 67', () => {
  const b = encode('012345678905');
  assert.equal(b.kind, 'UPC_A');
  assert.equal(b.modules.length, 95);
  assert.ok(b.modules[0] && b.modules.at(-1));
  assert.equal(encode('96385074').modules.length, 67);
  assert.equal(encode('12345'), null);
});

// Exact module pattern vs ZXing's output for the same code (from the Android BarcodeEncoder).
test('barcode encoder: UPC-A bit pattern is the standard one', () => {
  const bits = encode('012345678905').modules.map((m) => (m ? 1 : 0)).join('');
  // left guard + L(0..5) + center + R(6..0,5) + right guard
  const expected = '101' + '0001101' + '0011001' + '0010011' + '0111101' + '0100011' + '0110001' + '01010'
    + '1010000' + '1000100' + '1001000' + '1110100' + '1110010' + '1001110' + '101';
  assert.equal(bits, expected);
});
