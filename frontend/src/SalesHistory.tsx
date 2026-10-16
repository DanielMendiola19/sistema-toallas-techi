
import { useCallback, useEffect, useMemo, useState } from 'react';
import './SalesPanel.css';

const API = 'http://localhost:3000/api';

type Sale = {
  id: string;
  total_bob: string;
  status: 'completed' | 'voided';
  created_at: string;
  cash_session_status: 'open' | 'closed';
  seller_name: string;
  items: {
    name: string;
    quantity: number;
  }[];
  payments: {
    method: string;
    amount_bob: string;
  }[];
};

type Page = {
  items: Sale[];
  page: number;
  total: number;
  pages: number;
  pageSize: number;
  summary: {
    completedCount: number;
    completedRevenue: string;
  };
};

type Period = 'today' | 'week' | 'month' | 'all' | 'custom';

const money = (v: string | number) =>
  Number(v).toLocaleString('es-BO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const paymentNames: Record<string, string> = {
  cash: 'Efectivo',
  qr: 'QR',
  transfer: 'Transferencia',
  other: 'Otros'
};

function dateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    `${date.getFullYear()}-` +
    `${pad(date.getMonth() + 1)}-` +
    `${pad(date.getDate())}`
  );
}

function localDate(input: string): Date {
  const [y, m, d] = input.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function dayTitle(date: Date): string {
  const today = new Date();
  const yesterday = new Date();

  yesterday.setDate(yesterday.getDate() - 1);

  const formatted = date.toLocaleDateString('es-BO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  if (dateKey(date) === dateKey(today)) {
    return `Hoy · ${formatted}`;
  }

  if (dateKey(date) === dateKey(yesterday)) {
    return `Ayer · ${formatted}`;
  }

  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function saleTime(input: string): string {
  return new Date(input).toLocaleTimeString('es-BO', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  });
}

function getRange(
  period: Period,
  from: string,
  to: string
): { start: string; end: string } | null {
  if (period === 'all') {
    return { start: '', end: '' };
  }

  const now = new Date();
  let start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  let end = new Date(start);

  if (period === 'week') {
    start.setDate(
      start.getDate() - (start.getDay() + 6) % 7
    );
  }

  if (period === 'month') {
    start.setDate(1);
  }

  if (period === 'custom') {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to)
    ) {
      return null;
    }

    start = localDate(from);
    end = localDate(to);

    if (
      dateKey(start) !== from ||
      dateKey(end) !== to
    ) {
      return null;
    }
  }

  end.setDate(end.getDate() + 1);

  const duration = end.getTime() - start.getTime();

  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 367 * 86400000
  ) {
    return null;
  }

  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

type DayGroup = {
  key: string;
  date: Date;
  sales: Sale[];
};

export default function SalesHistory({
  token,
  admin,
  onInventoryChanged
}: {
  token: string;
  admin: boolean;
  onInventoryChanged: () => Promise<void>;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);

  const [period, setPeriod] = useState<Period>('today');
  const [from, setFrom] = useState(dateKey(new Date()));
  const [to, setTo] = useState(dateKey(new Date()));

  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [voidTarget, setVoidTarget] = useState<Sale | null>(null);
  const [reason, setReason] = useState('');

  const range = getRange(period, from, to);
  const validRange = range !== null;

  // Conserva la consulta original, añadiendo únicamente
  // los parámetros de fecha cuando exista un filtro.
  const load = useCallback(async (signal?: AbortSignal) => {
    const bounds = getRange(period, from, to);

    if (!bounds) return;

    const params = new URLSearchParams({
      page: String(page)
    });

    if (period !== 'all') {
      params.set('start', bounds.start);
      params.set('end', bounds.end);
    }

    setFetching(true);

    try {
      const res = await fetch(
        `${API}/sales?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          },
          signal
        }
      );

      const json = await res.json();

      if (!res.ok) {
        throw Error(
          json.error || 'No se pudo cargar el historial'
        );
      }

      if (signal?.aborted) return;

      setData(json as Page);
      setError('');
    } catch (e) {
      if (signal?.aborted) return;

      setError(
        e instanceof Error
          ? e.message
          : 'Error de conexión'
      );
    } finally {
      if (!signal?.aborted) {
        setFetching(false);
      }
    }
  }, [token, page, period, from, to]);

  // Mantiene la actualización automática cada 15 segundos.
  useEffect(() => {
    if (!validRange) {
      setData(null);
      return;
    }

    const controller = new AbortController();
    let running = false;

    const update = async () => {
      if (running) return;

      running = true;

      try {
        await load(controller.signal);
      } finally {
        running = false;
      }
    };

    void update();

    const interval = window.setInterval(() => {
      void update();
    }, 15000);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [load, validRange]);

  // Agrupa únicamente las ventas ya recibidas en la página.
  // Los filtros se aplican en el servidor antes de paginar.
  const groups = useMemo<DayGroup[]>(() => {
    const result: DayGroup[] = [];

    for (const sale of data?.items ?? []) {
      const date = new Date(sale.created_at);
      const key = dateKey(date);

      let group = result.find(g => g.key === key);

      if (!group) {
        group = {
          key,
          date,
          sales: []
        };

        result.push(group);
      }

      group.sales.push(sale);
    }

    return result;
  }, [data]);

  function changePeriod(value: Period) {
    setPeriod(value);
    setPage(1);
    setData(null);
    setError('');
  }

  // La anulación conserva el endpoint y los permisos originales.
  async function voidSale() {
    if (!voidTarget) return;

    setSaving(true);
    setError('');

    try {
      const res = await fetch(
        `${API}/sales/${voidTarget.id}/void`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ reason })
        }
      );

      const json = await res.json();

      if (!res.ok) {
        throw Error(json.error || 'No se pudo anular');
      }

      setVoidTarget(null);
      setReason('');
      setNotice(`Venta anulada. ${json.note || ''}`);

      await load();
      await onInventoryChanged();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Error inesperado'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sales-module sales-history">
      <section className="panel">
        <div className="sales-heading">
          <div>
            <h2>
              {admin ? 'Historial de ventas' : 'Mis ventas'}
            </h2>

            <p className="muted">
              Consulta las ventas organizadas por día.
            </p>
          </div>

          <button
            type="button"
            className="sh-refresh"
            disabled={fetching || saving}
            onClick={() => void load()}
          >
            {fetching ? 'Actualizando…' : '↻ Actualizar'}
          </button>
        </div>

        {/* FILTROS */}
        <div className="sh-filters">
          {([
            ['today', 'Hoy'],
            ['week', 'Esta semana'],
            ['month', 'Este mes'],
            ['all', 'Todas'],
            ['custom', 'Personalizado']
          ] as [Period, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`sh-filter ${
                period === value ? 'active' : ''
              }`}
              aria-pressed={period === value}
              onClick={() => changePeriod(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {period === 'custom' && (
          <div className="sh-custom">
            <label>
              Desde
              <input
                type="date"
                value={from}
                onChange={e => {
                  setFrom(e.target.value);
                  setPage(1);
                  setData(null);
                }}
              />
            </label>

            <label>
              Hasta (incluido)
              <input
                type="date"
                value={to}
                onChange={e => {
                  setTo(e.target.value);
                  setPage(1);
                  setData(null);
                }}
              />
            </label>
          </div>
        )}

        {!validRange && (
          <p className="error" role="alert">
            Selecciona un rango válido de máximo 367 días.
          </p>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}

        {/* RESUMEN DEL PERÍODO COMPLETO */}
        {data && (
          <div className="sh-summary">
            <div className="sh-summary-card">
              <span>Ventas registradas</span>
              <strong>{data.total}</strong>
              <small>Incluye las anuladas</small>
            </div>

            <div className="sh-summary-card">
              <span>Ventas completadas</span>
              <strong>
                {data.summary?.completedCount ?? '—'}
              </strong>
              <small>Sin contar anulaciones</small>
            </div>

            <div className="sh-summary-card">
              <span>Ingresos del período</span>
              <strong>
                {data.summary
                  ? `Bs ${money(data.summary.completedRevenue)}`
                  : '—'}
              </strong>
              <small>Solo ventas completadas</small>
            </div>
          </div>
        )}

        {fetching && !data && validRange && (
          <p className="sh-empty">
            Cargando historial de ventas…
          </p>
        )}

        {/* VENTAS SEPARADAS POR DÍA */}
        {groups.map(group => {
          const subtotal = group.sales.reduce(
            (sum, sale) =>
              sum + (
                sale.status === 'completed'
                  ? Math.round(Number(sale.total_bob) * 100)
                  : 0
              ),
            0
          ) / 100;

          return (
            <section className="sh-day-group" key={group.key}>
              <div className="sh-day-header">
                <div className="sh-day-heading">
                  <div className="sh-day-icon">
                    📅
                  </div>

                  <div>
                    <h3>{dayTitle(group.date)}</h3>
                    <p>
                      {group.sales.length}{' '}
                      {group.sales.length === 1
                        ? 'venta'
                        : 'ventas'}{' '}
                      en esta página
                    </p>
                  </div>
                </div>

                <div className="sh-day-total">
                  <span>Subtotal de esta página</span>
                  <strong>Bs {money(subtotal)}</strong>
                </div>
              </div>

              <div className="tablewrap sh-tablewrap">
                <table className="sh-table">
                  <thead>
                    <tr>
                      <th>Venta</th>
                      <th>Hora</th>
                      <th>Vendedor</th>
                      <th>Productos</th>
                      <th>Pago</th>
                      <th>Total</th>
                      <th>Estado</th>
                      {admin && <th>Acciones</th>}
                    </tr>
                  </thead>

                  <tbody>
                    {group.sales.map(s => (
                      <tr key={s.id}>
                        <td>
                          <strong>#{s.id}</strong>
                        </td>

                        <td className="sh-time">
                          {saleTime(s.created_at)}
                        </td>

                        <td>{s.seller_name}</td>

                        <td>
                          {s.items.map((item, index) => (
                            <div
                              className="sh-product"
                              key={`${s.id}-${index}`}
                            >
                              {item.name} ×{item.quantity}
                            </div>
                          ))}
                        </td>

                        <td>
                          {s.payments.map((payment, index) => (
                            <div
                              className="sh-payment"
                              key={`${s.id}-${index}`}
                            >
                              {paymentNames[payment.method] ||
                                payment.method}
                              : Bs {money(payment.amount_bob)}
                            </div>
                          ))}
                        </td>

                        <td>
                          <strong className="sh-amount">
                            Bs {money(s.total_bob)}
                          </strong>
                        </td>

                        <td>
                          <span
                            className={`tag ${
                              s.status === 'completed'
                                ? 'success'
                                : 'neutral'
                            }`}
                          >
                            {s.status === 'completed'
                              ? 'Completada'
                              : 'Anulada'}
                          </span>
                        </td>

                        {admin && (
                          <td>
                            {s.status === 'completed' &&
                            s.cash_session_status === 'open' ? (
                              <button
                                type="button"
                                className="sale-void"
                                disabled={saving}
                                onClick={() => {
                                  setReason('');
                                  setVoidTarget(s);
                                }}
                              >
                                Anular
                              </button>
                            ) : (
                              <span className="muted">
                                {s.cash_session_status === 'closed'
                                  ? 'Caja cerrada'
                                  : '—'}
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}

        {data?.items.length === 0 && (
          <div className="sh-empty">
            <strong>No hay ventas en este período.</strong>
            <p>
              Prueba con otro filtro para consultar
              fechas anteriores.
            </p>
          </div>
        )}

        {/* PAGINACIÓN ORIGINAL */}
        {data && (
          <div className="history-pagination">
            <span>
              {data.total} ventas · Página {page} de {data.pages}
            </span>

            <div>
              <button
                type="button"
                disabled={page <= 1 || fetching}
                onClick={() => setPage(v => v - 1)}
              >
                Anterior
              </button>

              <button
                type="button"
                disabled={fetching || page >= data.pages}
                onClick={() => setPage(v => v + 1)}
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </section>

      {/* CONFIRMACIÓN ORIGINAL DE ANULACIÓN */}
      {voidTarget && (
        <div
          className="modal-shade"
          onMouseDown={e => {
            if (e.target === e.currentTarget && !saving) {
              setVoidTarget(null);
            }
          }}
        >
          <div
            className="modal-box"
            role="dialog"
            aria-modal="true"
            aria-label="Anular venta"
          >
            <div className="modal-top">
              <h2>Anular venta #{voidTarget.id}</h2>

              <button
                className="modal-x"
                type="button"
                disabled={saving}
                onClick={() => setVoidTarget(null)}
              >
                ×
              </button>
            </div>

            <p>
              Esta acción devuelve unidades al inventario.
              La devolución de dinero se gestiona por separado.
            </p>

            <label>
              Motivo de anulación
              <textarea
                className="sale-textarea"
                maxLength={500}
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
            </label>

            <div className="confirm-actions">
              <button
                type="button"
                disabled={saving}
                onClick={() => setVoidTarget(null)}
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={saving || reason.trim().length < 5}
                className="sale-danger"
                onClick={() => void voidSale()}
              >
                Confirmar anulación
              </button>
            </div>

            {error && <p className="error">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
