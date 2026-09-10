import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../public/cards/four-color/', import.meta.url));
const ranks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const suits = [
  ['S', '♠', '#303339'], ['H', '♥', '#BB242D'],
  ['D', '♦', '#2452BE'], ['C', '♣', '#177341'],
];
mkdirSync(output, { recursive: true });
for (const [suit, symbol, color] of suits) {
  for (const rank of ranks) {
    const label = rank === 'T' ? '10' : rank;
    writeFileSync(`${output}/${rank}${suit}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140" role="img" aria-labelledby="title"><title id="title">${label}${symbol}</title><defs><linearGradient id="light" x2="1" y2="1"><stop stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient></defs><rect x="1" y="1" width="98" height="138" rx="9" fill="${color}"/><rect x="1" y="1" width="98" height="138" rx="9" fill="url(#light)" stroke="#fff" stroke-opacity=".3" stroke-width="2"/><g fill="#fff" font-family="Arial, sans-serif" font-weight="700"><text x="69" y="119" text-anchor="middle" font-size="106" opacity=".09">${symbol}</text><text x="8" y="37" font-size="36">${label}</text><text x="8" y="77" font-size="38">${symbol}</text><text x="94" y="${rank === 'Q' ? 125 : 133}" text-anchor="end" font-size="${rank === 'T' ? 78 : 86}" letter-spacing="-3">${label}</text></g></svg>\n`);
  }
}
writeFileSync(`${output}/index.html`, `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VinPoker · Bộ bài 4 màu</title><style>body{margin:0;padding:clamp(16px,4vw,48px);background:#0c1412;color:#edf4ef;font:16px system-ui}h1{font-size:24px}p{color:#a8bbb1}.deck{display:grid;grid-template-columns:repeat(13,minmax(0,1fr));gap:8px;margin:24px 0}img{width:100%;aspect-ratio:5/7}figure{margin:0}figcaption{text-align:center;font-size:12px;margin-top:6px}@media(max-width:700px){.deck{grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}}</style><h1>VinPoker · Bộ bài 4 màu</h1><p>52 lá · SVG 100 × 140 · ♠ xám đen · ♥ đỏ · ♦ xanh dương · ♣ xanh lá</p>${suits.map(([suit]) => `<div class="deck">${ranks.map(rank => `<figure><img src="${rank}${suit}.svg" alt="${rank}${suit}"><figcaption>${rank}${suit}</figcaption></figure>`).join('')}</div>`).join('')}</html>\n`);
console.log('Generated 52 four-color SVG cards and gallery.');
