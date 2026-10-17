import { API } from './apiConfig';

import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import logoUrl from './assets/logo-toallas.jpg';


const MAX_PAGES = 500;
const PRODUCT_LIMIT = 500;

type Sale = {
  id: string;
  status: 'completed' | 'voided';
  created_at: string;
  total_bob: string;
  payments: {
    method: string;
    amount_bob: string;
  }[];
};

type SalesPage = {
  items: Sale[];
  pages: number;
  total: number;
};

type Product = {
  id: string;
  code: string;
  name: string;
  stock: number;
  min_stock: number;
  price_bob: string;
};

type Totals = {
  count: number;
  cash: number;
  qr: number;
  transfer: number;
  other: number;
  total: number;
};

type DailyTotals = {
  date: Date;
  totals: Totals;
};

type PdfRow = {
  kind: 'month' | 'week' | 'day' |
        'weekTotal' | 'monthTotal' | 'grand' | 'empty';
  cells: string[];
};

const colors = {
  purple: [120, 82, 106] as [number, number, number],
  dark: [62, 48, 58] as [number, number, number],
  muted: [119, 109, 117] as [number, number, number],
  pale: [248, 243, 246] as [number, number, number],
  border: [224, 215, 221] as [number, number, number]
};

const format = (n: number) =>
  n.toLocaleString('es-BO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const amount = (cents: number) => format(cents / 100);

const toCents = (value: string | number) =>
  Math.round(Number(value) * 100);

const pad = (value: number) =>
  String(value).padStart(2, '0');

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shortDate(date: Date) {
  return date.toLocaleDateString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function localDay(date: Date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
}

function weekStart(date: Date) {
  const monday = localDay(date);
  monday.setDate(
    monday.getDate() - (monday.getDay() + 6) % 7
  );
  return monday;
}

function zero(): Totals {
  return {
    count: 0,
    cash: 0,
    qr: 0,
    transfer: 0,
    other: 0,
    total: 0
  };
}

function add(target: Totals, source: Totals) {
  target.count += source.count;
  target.cash += source.cash;
  target.qr += source.qr;
  target.transfer += source.transfer;
  target.other += source.other;
  target.total += source.total;
}

function cells(label: string, t: Totals): string[] {
  return [
    label,
    String(t.count),
    amount(t.cash),
    amount(t.qr),
    amount(t.transfer),
    amount(t.other),
    amount(t.total)
  ];
}

async function fetchJSON<T>(
  path: string,
  token: string
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await res.json();

  if (!res.ok) {
    throw Error(data.error || 'No se pudieron cargar los datos');
  }

  return data as T;
}

// =================================================
// CONSULTAR TODAS LAS PÁGINAS DEL PERÍODO
// =================================================

async function fetchSales(
  token: string,
  start: Date,
  end: Date
): Promise<Sale[]> {
  async function getPage(page: number) {
    const params = new URLSearchParams({
      page: String(page),
      start: start.toISOString(),
      end: end.toISOString()
    });

    const data = await fetchJSON<SalesPage>(
      `/sales?${params.toString()}`,
      token
    );

    if (!Array.isArray(data.items)) {
      throw Error('El historial devolvió datos inválidos');
    }

    return data;
  }

  const first = await getPage(1);

  const pages = Number(first.pages);

  if (
    !Number.isSafeInteger(pages) ||
    pages < 1 ||
    pages > MAX_PAGES
  ) {
    throw Error(
      'El historial es demasiado grande o su paginación ' +
      'no es válida. No se generó un reporte incompleto.'
    );
  }

  const sales = [...first.items];

  // Consultamos todas las páginas, no solo las primeras 20.
  // Se utilizan grupos pequeños de peticiones.
  for (let page = 2; page <= pages; page += 5) {
    const pending = [];

    for (
      let current = page;
      current < page + 5 && current <= pages;
      current++
    ) {
      pending.push(getPage(current));
    }

    const results = await Promise.all(pending);

    for (const result of results) {
      sales.push(...result.items);
    }
  }

  // Evitar duplicados si cambia la paginación
  // durante las consultas.
  const unique = new Map<string, Sale>();

  for (const sale of sales) {
    unique.set(String(sale.id), sale);
  }

  const startTime = start.getTime();
  const endTime = end.getTime();

  return [...unique.values()].filter(sale => {
    const timestamp = new Date(sale.created_at).getTime();

    return (
      sale.status === 'completed' &&
      Number.isFinite(timestamp) &&
      timestamp >= startTime &&
      timestamp < endTime
    );
  });
}

// =================================================
// AGRUPAR VENTAS POR DÍA Y MÉTODO DE PAGO
// =================================================

function groupByDay(sales: Sale[]): DailyTotals[] {
  const days = new Map<string, DailyTotals>();

  for (const sale of sales) {
    const date = new Date(sale.created_at);
    const key = dateKey(date);

    if (!days.has(key)) {
      days.set(key, {
        date: localDay(date),
        totals: zero()
      });
    }

    const totals = days.get(key)!.totals;

    totals.count++;
    totals.total += toCents(sale.total_bob);

    for (const payment of sale.payments ?? []) {
      const value = toCents(payment.amount_bob);

      switch (payment.method) {
        case 'cash':
          totals.cash += value;
          break;
        case 'qr':
          totals.qr += value;
          break;
        case 'transfer':
          totals.transfer += value;
          break;
        default:
          totals.other += value;
      }
    }
  }

  return [...days.values()].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );
}

// =================================================
// CONSTRUIR INFORME MES > SEMANA > DÍA
// =================================================

function makeSalesRows(days: DailyTotals[]): PdfRow[] {
  const rows: PdfRow[] = [];
  const months = new Map<
    string,
    Map<string, DailyTotals[]>
  >();

  for (const day of days) {
    const month = dateKey(day.date).slice(0, 7);
    const week = dateKey(weekStart(day.date));

    if (!months.has(month)) {
      months.set(month, new Map());
    }

    const weeks = months.get(month)!;

    if (!weeks.has(week)) {
      weeks.set(week, []);
    }

    weeks.get(week)!.push(day);
  }

  const grand = zero();

  for (const [monthKey, weeks] of months) {
    const monthDate = new Date(`${monthKey}-01T12:00:00`);

    const monthName = monthDate.toLocaleDateString(
      'es-BO',
      { month: 'long', year: 'numeric' }
    ).toUpperCase();

    rows.push({
      kind: 'month',
      cells: [monthName, '', '', '', '', '', '']
    });

    const monthTotal = zero();

    for (const [weekKey, weekDays] of weeks) {
      const monday = new Date(`${weekKey}T12:00:00`);
      const sunday = new Date(monday);

      sunday.setDate(sunday.getDate() + 6);

      const weekName =
        `Semana ${monday.toLocaleDateString('es-BO', {
          day: 'numeric',
          month: 'short'
        })} - ${sunday.toLocaleDateString('es-BO', {
          day: 'numeric',
          month: 'short'
        })}`;

      rows.push({
        kind: 'week',
        cells: [weekName, '', '', '', '', '', '']
      });

      const weekTotal = zero();

      for (const day of weekDays) {
        const label = day.date.toLocaleDateString(
          'es-BO',
          {
            weekday: 'short',
            day: 'numeric',
            month: 'short'
          }
        );

        rows.push({
          kind: 'day',
          cells: cells(label, day.totals)
        });

        add(weekTotal, day.totals);
      }

      rows.push({
        kind: 'weekTotal',
        cells: cells('Subtotal semana', weekTotal)
      });

      add(monthTotal, weekTotal);
    }

    rows.push({
      kind: 'monthTotal',
      cells: cells(`TOTAL ${monthName}`, monthTotal)
    });

    add(grand, monthTotal);
  }

  if (days.length === 0) {
    rows.push({
      kind: 'empty',
      cells: [
        'Sin ventas completadas en este período',
        '', '', '', '', '', ''
      ]
    });
  }

  rows.push({
    kind: 'grand',
    cells: cells('TOTAL GENERAL', grand)
  });

  return rows;
}

// =================================================
// LOGOTIPO Y ESTILO INSTITUCIONAL
// =================================================

async function loadLogo(): Promise<string | null> {
  try {
    const response = await fetch(logoUrl);
    if (!response.ok) return null;

    const blob = await response.blob();

    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Logo inválido'));
        }
      };

      reader.onerror = () =>
        reject(new Error('No se pudo leer el logo'));

      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function makeDocument() {
  return new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true
  });
}

function decoratePages(
  doc: jsPDF,
  title: string,
  period: string,
  logo: string | null
) {
  const pageCount = doc.getNumberOfPages();

  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);

    // Franja superior discreta.
    doc.setFillColor(...colors.purple);
    doc.rect(0, 0, 210, 2.5, 'F');

    // Logotipo de Toallas Techi.
    if (logo) {
      try {
        doc.addImage(
          logo,
          'JPEG',
          14, 7, 19, 19
        );
      } catch {
        // Si falla la imagen, conservar el PDF.
      }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...colors.dark);
    doc.text('TOALLAS TECHI', 38, 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...colors.muted);
    doc.text('Gestión comercial', 38, 20);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...colors.dark);
    doc.text(title, 196, 13, {
      align: 'right'
    });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(...colors.muted);
    doc.text(period, 196, 20, {
      align: 'right'
    });

    doc.text(
      `Emitido: ${new Date().toLocaleDateString('es-BO')}`,
      196, 25,
      { align: 'right' }
    );

    doc.setDrawColor(...colors.border);
    doc.line(14, 32, 196, 32);

    // Pie de página.
    doc.line(14, 281, 196, 281);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...colors.muted);

    doc.text(
      'Toallas Techi | Documento administrativo',
      14, 287
    );

    doc.text(
      `Página ${page} de ${pageCount}`,
      196, 287,
      { align: 'right' }
    );
  }
}

function addFinalNote(
  doc: jsPDF,
  message: string
) {
  const tableDoc = doc as jsPDF & {
    lastAutoTable?: { finalY: number };
  };

  let y = (tableDoc.lastAutoTable?.finalY ?? 42) + 9;

  if (y > 271) {
    doc.addPage();
    y = 43;
  }

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(...colors.muted);

  doc.text(
    doc.splitTextToSize(message, 180),
    14,
    y
  );
}

// =================================================
// GENERAR PDF PROFESIONAL DE VENTAS
// =================================================

export async function exportSalesPdf(
  token: string,
  start: Date,
  end: Date
): Promise<void> {
  const sales = await fetchSales(token, start, end);
  const days = groupByDay(sales);
  const rows = makeSalesRows(days);

  const doc = makeDocument();
  const logo = await loadLogo();

  autoTable(doc, {
    startY: 44,
    head: [[
      'Fecha / período',
      'Ventas',
      'Efectivo',
      'QR',
      'Transfer.',
      'Otros',
      'Total'
    ]],
    body: rows.map(row => row.cells),
    theme: 'grid',
    margin: {
      left: 14,
      right: 14,
      top: 42,
      bottom: 22
    },
    styles: {
      font: 'helvetica',
      fontSize: 7.7,
      textColor: colors.dark,
      lineColor: colors.border,
      lineWidth: 0.08,
      cellPadding: 2.8,
      overflow: 'linebreak',
      valign: 'middle'
    },
    headStyles: {
      fillColor: colors.purple,
      textColor: [255, 255, 255],
      fontStyle: 'bold'
    },
    columnStyles: {
      0: { cellWidth: 50 },
      1: { cellWidth: 16, halign: 'right' },
      2: { cellWidth: 25, halign: 'right' },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 24, halign: 'right' },
      5: { cellWidth: 21, halign: 'right' },
      6: { cellWidth: 24, halign: 'right' }
    },
    didParseCell(data) {
      if (data.section !== 'body') return;

      const row = rows[data.row.index];
      if (!row) return;

      if (row.kind === 'month') {
        data.cell.styles.fillColor = [225, 210, 220];
        data.cell.styles.textColor = colors.dark;
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fontSize = 9;
      }

      if (row.kind === 'week') {
        data.cell.styles.fillColor = [244, 237, 242];
        data.cell.styles.fontStyle = 'bold';
      }

      if (row.kind === 'weekTotal') {
        data.cell.styles.fillColor = [245, 242, 244];
        data.cell.styles.fontStyle = 'bold';
      }

      if (row.kind === 'monthTotal') {
        data.cell.styles.fillColor = [231, 219, 227];
        data.cell.styles.fontStyle = 'bold';
      }

      if (row.kind === 'grand') {
        data.cell.styles.fillColor = colors.purple;
        data.cell.styles.textColor = [255, 255, 255];
        data.cell.styles.fontStyle = 'bold';
      }
    }
  });

  addFinalNote(
    doc,
    'Importes en bolivianos (Bs). Solo ventas completadas; ' +
    'las anuladas no se incluyen. Las semanas que abarcan ' +
    'dos meses se subtotalizan por separado dentro de cada mes.'
  );

  const finalDay = new Date(end.getTime() - 1);

  decoratePages(
    doc,
    'INFORME DE VENTAS',
    `${shortDate(start)} al ${shortDate(finalDay)}`,
    logo
  );

  doc.save(`toallas-techi-ventas-${dateKey(new Date())}.pdf`);
}

// =================================================
// GENERAR PDF PROFESIONAL DE INVENTARIO
// =================================================

export async function exportInventoryPdf(
  token: string
): Promise<void> {
  const data = await fetchJSON<Product[]>(
    '/products',
    token
  );

  if (!Array.isArray(data)) {
    throw Error('El inventario devolvió datos inválidos');
  }

  if (data.length >= PRODUCT_LIMIT) {
    throw Error(
      'Se alcanzó el límite de consulta de 500 productos. ' +
      'No se exportará un inventario potencialmente incompleto.'
    );
  }

  function status(product: Product) {
    const stock = Number(product.stock);
    const min = Number(product.min_stock);

    if (stock <= 0) return 'AGOTADO';
    if (stock <= min) return 'STOCK BAJO';
    return 'Disponible';
  }

  // Primero los agotados, después los de stock bajo
  // y finalmente los productos disponibles.
  const priority = (product: Product) => {
    const state = status(product);
    if (state === 'AGOTADO') return 0;
    if (state === 'STOCK BAJO') return 1;
    return 2;
  };

  const products = [...data].sort(
    (a, b) =>
      priority(a) - priority(b) ||
      a.name.localeCompare(b.name, 'es')
  );

  const out = products.filter(
    p => status(p) === 'AGOTADO'
  ).length;

  const low = products.filter(
    p => status(p) === 'STOCK BAJO'
  ).length;

  const doc = makeDocument();
  const logo = await loadLogo();

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...colors.dark);

  doc.text(
    `Productos activos: ${products.length}   |   Agotados: ${out}   |   Stock bajo: ${low}`,
    14,
    40
  );

  autoTable(doc, {
    startY: 47,
    head: [[
      'Código',
      'Producto',
      'Stock',
      'Mínimo',
      'Precio Bs',
      'Estado'
    ]],
    body: products.map(p => [
      p.code,
      p.name,
      String(p.stock),
      String(p.min_stock),
      format(Number(p.price_bob)),
      status(p)
    ]),
    theme: 'grid',
    margin: {
      left: 14,
      right: 14,
      top: 42,
      bottom: 22
    },
    styles: {
      font: 'helvetica',
      fontSize: 8,
      textColor: colors.dark,
      lineColor: colors.border,
      lineWidth: 0.08,
      cellPadding: 3,
      overflow: 'linebreak',
      valign: 'middle'
    },
    headStyles: {
      fillColor: colors.purple,
      textColor: [255, 255, 255],
      fontStyle: 'bold'
    },
    alternateRowStyles: {
      fillColor: [252, 250, 251]
    },
    columnStyles: {
      0: { cellWidth: 23 },
      1: { cellWidth: 70 },
      2: { cellWidth: 19, halign: 'right' },
      3: { cellWidth: 19, halign: 'right' },
      4: { cellWidth: 25, halign: 'right' },
      5: { cellWidth: 26 }
    },
    didParseCell(cell) {
      if (cell.section !== 'body') return;

      const product = products[cell.row.index];
      if (!product) return;

      const state = status(product);

      if (state === 'AGOTADO') {
        cell.cell.styles.fillColor = [255, 225, 229];

        if (cell.column.index === 5) {
          cell.cell.styles.textColor = [170, 41, 55];
          cell.cell.styles.fontStyle = 'bold';
        }
      }

      if (state === 'STOCK BAJO') {
        cell.cell.styles.fillColor = [255, 240, 241];

        if (cell.column.index === 5) {
          cell.cell.styles.textColor = [165, 65, 72];
          cell.cell.styles.fontStyle = 'bold';
        }
      }
    }
  });

  addFinalNote(
    doc,
    'El inventario corresponde a los productos activos ' +
    'al momento de la consulta. El stock bajo se determina ' +
    'comparando existencias actuales y mínimo configurado. ' +
    'Los precios son precios unitarios de venta.'
  );

  decoratePages(
    doc,
    'INFORME DE INVENTARIO',
    `Actualizado: ${shortDate(new Date())}`,
    logo
  );

  doc.save(
    `toallas-techi-inventario-${dateKey(new Date())}.pdf`
  );
}
