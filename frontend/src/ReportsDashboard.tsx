
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

import {
  exportSalesPdf,
  exportInventoryPdf
} from './ReportsPdf';

import './ReportsDashboard.css';

type RowAmount = {
  amount: string;
};

type Report = {
  period: {
    start: string;
    end: string;
    timezone: string;
  };
  summary: {
    transactions: number;
    revenue: string;
    units: number;
    closed_sessions: number;
  };
  stock: {
    total: number;
    out_of_stock: number;
    low_stock: number;
  };
  payments: (RowAmount & {
    method: string;
  })[];
  daily: (RowAmount & {
    day: string;
    transactions: number;
  })[];
  top_products: (RowAmount & {
    product_id: string;
    code: string;
    name: string;
    quantity: number;
  })[];
  sellers: (RowAmount & {
    id: string;
    name: string;
    transactions: number;
  })[];
};

type Period = 'today' | 'week' | 'month' | 'custom';
type PdfKind = 'sales' | 'inventory';

const API = 'http://localhost:3000/api';

const fmt = (value: string | number) =>
  Number(value).toLocaleString('es-BO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const money = (value: string | number) =>
  `Bs ${fmt(value)}`;

const dayString = (date: Date) =>
  `${date.getFullYear()}-${String(
    date.getMonth() + 1
  ).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;

const localDate = (value: string) =>
  new Date(`${value}T00:00:00`);

const paymentNames: Record<string, string> = {
  cash: 'Efectivo',
  qr: 'QR',
  transfer: 'Transferencia',
  other: 'Otros'
};

function bounds(
  period: Period,
  from: string,
  to: string
) {
  const now = new Date();

  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  const end = new Date(start);

  if (period === 'week') {
    start.setDate(
      start.getDate() - (start.getDay() + 6) % 7
    );
  }

  if (period === 'month') {
    start.setDate(1);
  }

  if (period === 'custom') {
    const first = localDate(from);
    const last = localDate(to);

    last.setDate(last.getDate() + 1);

    return {
      start: first,
      end: last
    };
  }

  end.setDate(end.getDate() + 1);

  return { start, end };
}

export default function ReportsDashboard({
  token,
  compact = false
}: {
  token: string;
  compact?: boolean;
}) {
  const [period, setPeriod] = useState<Period>('week');

  const [from, setFrom] = useState(
    dayString(new Date())
  );

  const [to, setTo] = useState(
    dayString(new Date())
  );

  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [pdfMenuOpen, setPdfMenuOpen] = useState(false);
  const [exporting, setExporting] = useState<PdfKind | null>(null);

  const pdfMenuRef = useRef<HTMLDivElement>(null);

  const dateRange = useMemo(
    () => bounds(period, from, to),
    [period, from, to]
  );

  const startMs = dateRange.start.getTime();
  const endMs = dateRange.end.getTime();

  const valid =
    Number.isFinite(startMs) &&
    Number.isFinite(endMs) &&
    startMs < endMs &&
    endMs - startMs <= 367 * 86400000;

  // CONSULTA ORIGINAL DE REPORTES.
  const fetchReport = useCallback(async () => {
    if (!valid) {
      setError(
        'Selecciona un rango válido de máximo 367 días.'
      );
      setReport(null);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const args = new URLSearchParams({
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
        timezone:
          Intl.DateTimeFormat().resolvedOptions().timeZone ||
          'America/La_Paz'
      });

      const res = await fetch(
        `${API}/reports/overview?${args.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw Error(
          data.error ||
          'No fue posible cargar los reportes'
        );
      }

      setReport(data as Report);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Error al consultar los reportes'
      );

      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [startMs, endMs, token, valid]);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  // CERRAR MENÚ AL HACER CLIC FUERA O PULSAR ESCAPE.
  useEffect(() => {
    if (!pdfMenuOpen) return;

    function closeOutside(event: PointerEvent) {
      if (
        pdfMenuRef.current &&
        !pdfMenuRef.current.contains(event.target as Node)
      ) {
        setPdfMenuOpen(false);
      }
    }

    function closeEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setPdfMenuOpen(false);
      }
    }

    document.addEventListener(
      'pointerdown',
      closeOutside
    );

    document.addEventListener(
      'keydown',
      closeEscape
    );

    return () => {
      document.removeEventListener(
        'pointerdown',
        closeOutside
      );

      document.removeEventListener(
        'keydown',
        closeEscape
      );
    };
  }, [pdfMenuOpen]);

  // NUEVA EXPORTACIÓN DE DOCUMENTOS.
  async function exportPDF(kind: PdfKind) {
    if (exporting) return;

    setPdfMenuOpen(false);
    setError('');
    setExporting(kind);

    try {
      if (kind === 'sales') {
        if (!report || !valid || loading) {
          throw Error(
            'Primero carga un período de ventas válido.'
          );
        }

        await exportSalesPdf(
          token,
          dateRange.start,
          dateRange.end
        );
      } else {
        await exportInventoryPdf(token);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'No fue posible exportar el PDF'
      );
    } finally {
      setExporting(null);
    }
  }

  const maxDay = Math.max(
    1,
    ...(report?.daily ?? []).map(
      x => Number(x.amount)
    )
  );

  return (
    <div className="reports-page">
      {/* CONTROLES */}
      <section className="panel reports-controls">
        <div className="reports-heading">
          <div>
            <h2>
              {compact
                ? 'Actividad de la tienda'
                : 'Reportes de ventas'}
            </h2>

            <p className="muted">
              Datos reales de ventas completadas.
              Las anuladas no se suman.
            </p>
          </div>

          <div className="reports-buttons">
            <button
              type="button"
              onClick={() => void fetchReport()}
              disabled={loading || exporting !== null}
              className="reports-secondary"
            >
              {loading
                ? 'Cargando…'
                : 'Actualizar datos'}
            </button>

            {!compact && (
              <div
                className="reports-pdf-dropdown"
                ref={pdfMenuRef}
              >
                <button
                  type="button"
                  className="primary reports-pdf-trigger"
                  aria-expanded={pdfMenuOpen}
                  aria-controls="reports-pdf-options"
                  disabled={exporting !== null}
                  onClick={() =>
                    setPdfMenuOpen(v => !v)
                  }
                >
                  {exporting
                    ? 'Generando PDF…'
                    : 'Exportar PDF'}

                  <span aria-hidden="true">
                    ▾
                  </span>
                </button>

                {pdfMenuOpen && (
                  <div
                    id="reports-pdf-options"
                    className="reports-pdf-options"
                  >
                    <button
                      type="button"
                      disabled={!report || loading}
                      onClick={() =>
                        void exportPDF('sales')
                      }
                    >
                      <span className="reports-pdf-option-icon">
                        📊
                      </span>

                      <span>
                        <strong>
                          Reporte de ventas
                        </strong>

                        <small>
                          Totales por día,
                          semana y mes
                        </small>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        void exportPDF('inventory')
                      }
                    >
                      <span className="reports-pdf-option-icon">
                        📦
                      </span>

                      <span>
                        <strong>
                          Reporte de inventario
                        </strong>

                        <small>
                          Existencias, precios
                          y alertas de stock
                        </small>
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* FILTROS ORIGINALES */}
        <div
          className="reports-periods"
          role="group"
          aria-label="Seleccionar período"
        >
          {([
            ['today', 'Hoy'],
            ['week', 'Semana'],
            ['month', 'Mes'],
            ['custom', 'Personalizado']
          ] as [Period, string][]).map(
            ([value, label]) => (
              <button
                key={value}
                type="button"
                className={
                  period === value
                    ? 'is-selected'
                    : ''
                }
                aria-pressed={period === value}
                onClick={() => setPeriod(value)}
              >
                {label}
              </button>
            )
          )}
        </div>

        {period === 'custom' && (
          <div className="reports-dates">
            <label>
              Desde
              <input
                type="date"
                value={from}
                onChange={e =>
                  setFrom(e.target.value)
                }
              />
            </label>

            <label>
              Hasta (incluido)
              <input
                type="date"
                value={to}
                onChange={e =>
                  setTo(e.target.value)
                }
              />
            </label>
          </div>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      {/* ESTADÍSTICAS EN PANTALLA - SIN CAMBIOS */}
      {report && (
        <>
          <div className="reports-kpis">
            {([
              [
                'Ventas totales',
                money(report.summary.revenue)
              ],
              [
                'Transacciones',
                report.summary.transactions
              ],
              [
                'Unidades vendidas',
                report.summary.units
              ],
              [
                'Stock bajo / agotado',
                report.stock.low_stock +
                report.stock.out_of_stock
              ]
            ] as [string, string | number][]).map(
              ([label, value]) => (
                <article
                  className="reports-kpi"
                  key={label}
                >
                  <span>{label}</span>
                  <strong>{value}</strong>
                </article>
              )
            )}
          </div>

          <div className="reports-columns">
            {/* GRÁFICO DE VENTAS */}
            <section className="panel">
              <h2>Ventas por día</h2>

              <p className="muted">
                Ingresos en bolivianos
              </p>

              {report.daily.length === 0 ? (
                <p className="reports-empty">
                  No hay ventas en este período.
                </p>
              ) : (
                <div
                  className="reports-chart"
                  role="img"
                  aria-label="Gráfico de ingresos diarios"
                >
                  {report.daily.map(d => (
                    <div
                      className="reports-bar-row"
                      key={d.day}
                    >
                      <span>
                        {d.day.slice(5)}
                      </span>

                      <div className="reports-bar-track">
                        <div
                          className="reports-bar"
                          style={{
                            width: `${
                              Number(d.amount) /
                              maxDay * 100
                            }%`
                          }}
                        />
                      </div>

                      <b>{money(d.amount)}</b>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* MÉTODOS DE PAGO */}
            <section className="panel">
              <h2>Métodos de pago</h2>

              <p className="muted">
                Ingresos por forma de cobro
              </p>

              {report.payments.length === 0 ? (
                <p className="reports-empty">
                  Sin pagos en este período.
                </p>
              ) : (
                <div className="reports-payments">
                  {report.payments.map(p => (
                    <div
                      className="reports-payment"
                      key={p.method}
                    >
                      <span>
                        {paymentNames[p.method] ||
                          p.method}
                      </span>

                      <strong>
                        {money(p.amount)}
                      </strong>
                    </div>
                  ))}
                </div>
              )}

              <div className="reports-smallstat">
                Cierres realizados en el período:{' '}
                <strong>
                  {report.summary.closed_sessions}
                </strong>
              </div>
            </section>
          </div>

          <div className="reports-columns">
            {/* PRODUCTOS MÁS VENDIDOS */}
            <section className="panel">
              <h2>Productos más vendidos</h2>

              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Unidades</th>
                      <th>Total</th>
                    </tr>
                  </thead>

                  <tbody>
                    {report.top_products.map(p => (
                      <tr key={p.product_id}>
                        <td>
                          {p.name}

                          <small className="reports-code">
                            {p.code}
                          </small>
                        </td>

                        <td>
                          {p.quantity}
                        </td>

                        <td>
                          {money(p.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {!report.top_products.length && (
                  <p className="reports-empty">
                    Sin resultados.
                  </p>
                )}
              </div>
            </section>

            {/* VENTAS POR VENDEDOR */}
            <section className="panel">
              <h2>Ventas por vendedor</h2>

              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Vendedor</th>
                      <th>Ventas</th>
                      <th>Total</th>
                    </tr>
                  </thead>

                  <tbody>
                    {report.sellers.map(s => (
                      <tr key={s.id}>
                        <td>
                          {s.name}
                        </td>

                        <td>
                          {s.transactions}
                        </td>

                        <td>
                          {money(s.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {!report.sellers.length && (
                  <p className="reports-empty">
                    Sin resultados.
                  </p>
                )}
              </div>
            </section>
          </div>

          <p className="reports-footnote">
            Importante: ventas e ingresos no equivalen
            a utilidad. El stock bajo representa el
            estado actual del inventario, no el estado
            histórico del período.
          </p>
        </>
      )}

      {loading && !report && (
        <section className="panel">
          Cargando datos del reporte…
        </section>
      )}
    </div>
  );
}
