// #23: Local lightweight Agent - keyword extraction + text similarity matching

function extractKeywords(text) {
  if (!text) return [];
  const cleaned = text.replace(/[，。！？、；：""''（）\[\]{}【】\s,.!?;:'"()\-\n\r\t]/g, ' ');
  const segments = cleaned.split(/\s+/).filter(s => s.length > 0);
  const keywords = new Set();
  for (const seg of segments) {
    if (seg.length <= 4) {
      if (seg.length >= 2) keywords.add(seg);
    } else {
      for (let i = 0; i <= seg.length - 2; i++) {
        keywords.add(seg.substring(i, i + 2));
      }
    }
  }
  return [...keywords];
}

function calculateSimilarity(kw1, kw2) {
  if (kw1.length === 0 || kw2.length === 0) return 0;
  let match = 0;
  for (const k of kw1) {
    if (kw2.includes(k)) match++;
  }
  return match / Math.max(kw1.length, kw2.length);
}

function findRecommendations(card, allCards, maxResults) {
  const count = maxResults || 3;
  const text = (card.title || '') + ' ' + (card.content || '');
  const cardKw = extractKeywords(text);
  if (cardKw.length === 0) return [];

  const excludeIds = new Set([card.id, ...(card.relatedIds || [])]);
  const scored = [];
  for (const other of allCards) {
    if (excludeIds.has(other.id)) continue;
    const otherText = (other.title || '') + ' ' + (other.content || '');
    const otherKw = extractKeywords(otherText);
    const score = calculateSimilarity(cardKw, otherKw);
    if (score > 0.03) {
      scored.push({ id: other.id, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map(s => ({ id: s.id, score: s.score }));
}

module.exports = { extractKeywords, calculateSimilarity, findRecommendations };
