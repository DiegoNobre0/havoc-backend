const FLAVOR_WORDS = new Set([
  'abacaxi',
  'alpine',
  'avela',
  'banana',
  'baunilha',
  'beijinho',
  'chocolate',
  'chocobear',
  'chocotine',
  'chocotino',
  'coco',
  'cookies',
  'cream',
  'caramelo',
  'doce',
  'frutas',
  'laranja',
  'leite',
  'limao',
  'limonada',
  'maca',
  'manga',
  'maracuja',
  'melancia',
  'milk',
  'morango',
  'neutro',
  'pessego',
  'pistache',
  'uva',
  'vermelhas',
  'vitamiina',
]);

export function normalizeImportText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function productImportFamilyKey(name: string) {
  const tokens = normalizeImportText(name)
    .split(' ')
    .filter(
      (token) =>
        !FLAVOR_WORDS.has(token) &&
        !/^(?:and|com|da|de|do|e)$/.test(token) &&
        !/^(?:sabor|pote|pouch|refil)$/.test(token) &&
        !/^\d+(?:g|gr|kg|ml|caps|capsulas|tabletes|unid)?$/.test(token),
    );
  return tokens.join(' ') || normalizeImportText(name);
}
