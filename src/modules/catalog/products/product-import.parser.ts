export type ClippInventoryItem = {
  sku: string;
  name: string;
  stock: number;
  price: number;
  cost?: number;
  quantityPrice: number;
  quantityCost: number;
};

export type ClippInventoryParseError = {
  sku: string | null;
  record: string;
  reason: string;
};

const BRAZILIAN_DECIMAL = /\d{1,3}(?:\.\d{3})*,\d{2}/g;

function parseBrazilianDecimal(value: string) {
  return Number(value.replace(/\./g, '').replace(',', '.'));
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isNoiseLine(line: string) {
  const normalized = line.trim();
  return (
    !normalized ||
    /^<\/?(?:PARSED TEXT|IMAGE)\b/i.test(normalized) ||
    /^A ALVES OLIVEIRA LTDA$/i.test(normalized) ||
    /^(?:CNPJ:|RUA |Fone:|Página \d+\/\d+)/i.test(normalized) ||
    /^\d{5}-\d{3}\s+-/.test(normalized) ||
    /^Totalização do Estoque$/i.test(normalized) ||
    /^Código\s+Descrição\s+Quantidade/i.test(normalized) ||
    /^Relatório gerado em/i.test(normalized) ||
    /^Totais:/i.test(normalized)
  );
}

function parseRecord(record: string): ClippInventoryItem {
  const codeMatch = record.match(/^\s*(\d+)\s+/);
  if (!codeMatch) throw new Error('Código do produto não encontrado.');

  const matches = [...record.matchAll(BRAZILIAN_DECIMAL)];
  if (matches.length < 5) throw new Error('As cinco colunas numéricas não foram encontradas.');
  // The PDF extractor may append the report totals to the final product row.
  // The product columns are always the first five monetary values in a record.
  const fields = matches.slice(0, 5);
  const values = fields.map((match) => parseBrazilianDecimal(match[0]));
  const [stock, price, quantityPrice, quantityCost] = values;
  if ([stock, price, quantityPrice, quantityCost].some((value) => !Number.isFinite(value))) {
    throw new Error('O registro contém um número inválido.');
  }
  if (!Number.isInteger(stock) || stock < 0) {
    throw new Error('A quantidade precisa ser um número inteiro não negativo.');
  }
  if (price <= 0 || quantityPrice < 0 || quantityCost < 0) {
    throw new Error('Preço ou custo inválido.');
  }

  const expectedTotal = roundCurrency(stock * price);
  if (Math.abs(expectedTotal - quantityPrice) > 0.02) {
    throw new Error(
      `Qtd x Preço inconsistente: esperado ${expectedTotal.toFixed(2)}, recebido ${quantityPrice.toFixed(2)}.`,
    );
  }

  const lastField = fields.at(-1)!;
  let nameText = record.slice(0, lastField.index! + lastField[0].length);
  for (const field of [...fields].reverse()) {
    const index = field.index!;
    nameText = `${nameText.slice(0, index)} ${nameText.slice(index + field[0].length)}`;
  }
  const name = nameText
    .replace(/^\s*\d+\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) throw new Error('Descrição do produto não encontrada.');

  return {
    sku: codeMatch[1]!,
    name,
    stock,
    price,
    ...(stock > 0 ? { cost: roundCurrency(quantityCost / stock) } : {}),
    quantityPrice,
    quantityCost,
  };
}

export function parseClippInventoryText(text: string) {
  const items: ClippInventoryItem[] = [];
  const errors: ClippInventoryParseError[] = [];
  let current: string[] = [];
  let insideTable = false;
  const hasTableHeaders = /^Código\s+Descrição\s+Quantidade/im.test(text);

  const flush = () => {
    if (current.length === 0) return;
    const record = current.join(' ').replace(/\s+/g, ' ').trim();
    const sku = record.match(/^\s*(\d+)\s+/)?.[1] ?? null;
    try {
      items.push(parseRecord(record));
    } catch (error) {
      errors.push({
        sku,
        record,
        reason: error instanceof Error ? error.message : 'Registro inválido.',
      });
    }
    current = [];
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (/^Código\s+Descrição\s+Quantidade/i.test(trimmed)) {
      insideTable = true;
      continue;
    }
    if (/^(?:Relatório gerado em|Totais:)/i.test(trimmed)) {
      flush();
      insideTable = false;
      continue;
    }
    if (hasTableHeaders && !insideTable) continue;
    if (isNoiseLine(rawLine)) continue;
    const line = trimmed;
    if (/^\d+\s+/.test(line)) flush();
    if (current.length > 0 || /^\d+\s+/.test(line)) current.push(line);
  }
  flush();

  return { items, errors };
}
