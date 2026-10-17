import { API } from './apiConfig';

import { useEffect, useState } from 'react';
import './GeneralDashboard.css';

type Period = 'today' | 'week' | 'month';

type Destination =
  | 'sales' | 'history' | 'reports' | 'inventory'
  | 'import' | 'movements' | 'cash-management'
  | 'audit' | 'prices' | 'users';

type Product = {
  id: string;
  code: string;
  name: string;
  stock: number;
  min_stock: number;
};

type PriceRequest = {
  status: 'pending' | 'approved' | 'rejected';
};

type User = {
  role: 'admin' | 'seller';
  is_active?: boolean;
};

type Overview = {
  summary: {
    revenue: string;
    transactions: number;
    units: number;
  };
  daily: {
    day: string;
    amount: string;
  }[];
  top_products: {
    product_id: string;
    name: string;
    quantity: number;
  }[];
  sellers: {
    id: string;
    name: string;
    amount: string;
    transactions: number;
  }[];
};

type AuditEvent = {
  id: string;
  created_at: string;
  action: string;
  actor_name: string;
};

type CashSession = {
  id: string;
  register_name: string;
  status: 'open' | 'closed';
  opened_at: string;
};

type Paginated<T> = {
  items: T[];
  total: number;
};

type Props = {
  token: string;
  products: Product[];
  requests: PriceRequest[];
  users: User[];
  onNavigate: (view: Destination) => void;
};



const money = (value: string | number) =>
  `Bs ${Number(value).toLocaleString('es-BO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

const dateTime = (value: string) =>
  new Date(value).toLocaleString('es-BO', {
    dateStyle: 'short',
    timeStyle: 'short'
  });

function getRange(period: Period) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  if (period === 'week') {
    start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  }

  if (period === 'month') {
    start.setDate(1);
  }

  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

async function getJSON<T>(
  path: string,
  token: string,
  signal: AbortSignal
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'No se pudieron cargar los datos');
  }

  return data as T;
}

const actionNames: Record<string, string> = {
  'sale.created': 'Venta registrada',
  'sale.voided': 'Venta anulada',
  'cash.opened': 'Caja abierta',
  'cash.closed': 'Caja cerrada',
  'inventory.entry': 'Entrada de inventario',
  'inventory.loss': 'Salida de inventario',
  'inventory.count': 'Conteo físico',
  'inventory.adjustment': 'Ajuste de inventario',
  'price.direct_change': 'Precio actualizado',
  'approved': 'Precio aprobado',
  'rejected': 'Precio rechazado'
};

const shortcuts: {
  label: string;
  icon: string;
  view: Destination;
}[] = [
  { label: 'Ventas', icon: '🛒', view: 'sales' },
  { label: 'Historial', icon: '🧾', view: 'history' },
  { label: 'Reportes', icon: '📊', view: 'reports' },
  { label: 'Inventario', icon: '📦', view: 'inventory' },
  { label: 'Movimientos', icon: '🔄', view: 'movements' },
  { label: 'Caja', icon: '💳', view: 'cash-management' },
  { label: 'Precios', icon: '🏷️', view: 'prices' },
  { label: 'Vendedores', icon: '👥', view: 'users' },
  { label: 'Auditoría', icon: '📋', view: 'audit' },
  { label: 'Importar Excel', icon: '📥', view: 'import' }
];

export default function GeneralDashboard({
  token, products, requests, users, onNavigate
}: Props) {
  const [period, setPeriod] = useState<Period>('today');
  const [refresh, setRefresh] = useState(0);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [audit, setAudit] = useState<Paginated<AuditEvent> | null>(null);
  const [cash, setCash] = useState<Paginated<CashSession> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setOverview(null);
      setAudit(null);
      setCash(null);

      const range = getRange(period);
      const params = new URLSearchParams({
        ...range,
        timezone:
          Intl.DateTimeFormat().resolvedOptions().timeZone ||
          'America/La_Paz'
      });

      const results = await Promise.allSettled([
        getJSON<Overview>(
          `/reports/overview?${params}`, token, controller.signal
        ),
        getJSON<Paginated<AuditEvent>>(
          '/management/audit?page=1', token, controller.signal
        ),
        getJSON<Paginated<CashSession>>(
          '/management/cash-sessions?page=1', token, controller.signal
        )
      ] as const);

      if (controller.signal.aborted) return;

      setOverview(
        results[0].status === 'fulfilled' ? results[0].value : null
      );
      setAudit(
        results[1].status === 'fulfilled' ? results[1].value : null
      );
      setCash(
        results[2].status === 'fulfilled' ? results[2].value : null
      );
      setLoading(false);
    }

    void load();
    return () => controller.abort();
  }, [token, period, refresh]);

  const lowStock = products
    .filter(p => p.stock <= p.min_stock)
    .sort((a, b) => a.stock - b.stock);

  const pending = requests.filter(r => r.status === 'pending').length;
  const activeSellers = users.filter(
    u => u.role === 'seller' && u.is_active
  ).length;

  const maxDay = Math.max(
    1,
    ...(overview?.daily ?? []).map(d => Number(d.amount))
  );

  const leader = [...(overview?.sellers ?? [])]
    .sort((a, b) => Number(b.amount) - Number(a.amount))[0];

  const mainProduct = overview?.top_products[0];

  const kpis = [
    {
      label: 'Ingresos del período',
      value: overview ? money(overview.summary.revenue) : '—',
      icon: '💰',
      view: 'reports' as Destination
    },
    {
      label: 'Ventas realizadas',
      value: overview ? String(overview.summary.transactions) : '—',
      icon: '🛒',
      view: 'history' as Destination
    },
    {
      label: 'Unidades vendidas',
      value: overview ? String(overview.summary.units) : '—',
      icon: '📦',
      view: 'sales' as Destination
    },
    {
      label: 'Stock bajo / agotado',
      value: String(lowStock.length),
      icon: '⚠️',
      view: 'inventory' as Destination
    }
  ];

  return (
    <div className="td-dashboard">
      <header className="td-header">
        <div>
          <h2>Estado de la tienda</h2>
          <p>Lo más importante de Toallas Techi, en un solo lugar.</p>
        </div>

        <button
          className="td-refresh"
          type="button"
          disabled={loading}
          onClick={() => setRefresh(v => v + 1)}
        >
          {loading ? 'Actualizando…' : '↻ Actualizar'}
        </button>
      </header>

      <div className="td-periods" aria-label="Período de ventas">
        {([
          ['today', 'Hoy'],
          ['week', 'Esta semana'],
          ['month', 'Este mes']
        ] as [Period, string][]).map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={period === id ? 'selected' : ''}
            aria-pressed={period === id}
            onClick={() => setPeriod(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {!loading && !overview && (
        <p className="td-warning" role="alert">
          No se pudieron cargar las estadísticas de ventas.
          Comprueba la conexión con el servidor.
        </p>
      )}

      <div className="td-kpis">
        {kpis.map(k => (
          <button
            key={k.label}
            type="button"
            className="td-card td-kpi"
            onClick={() => onNavigate(k.view)}
          >
            <span className="td-kpi-icon" aria-hidden="true">
              {k.icon}
            </span>
            <span className="td-kpi-label">{k.label}</span>
            <strong>{k.value}</strong>
            <small>Ver detalles →</small>
          </button>
        ))}
      </div>

      <div className="td-mini-stats">
        <span>👥 Vendedores activos: <b>{activeSellers}</b></span>
        <span>🏷️ Solicitudes de precio pendientes: <b>{pending}</b></span>
      </div>

      <div className="td-columns">
        <section className="td-card">
          <div className="td-section-head">
            <div>
              <h3>📈 Tendencia de ventas</h3>
              <p>Ingresos por día del período seleccionado</p>
            </div>
            <button type="button" onClick={() => onNavigate('reports')}>
              Ver reportes →
            </button>
          </div>

          {overview && overview.daily.length > 0 ? (
            <div className="td-chart">
              {overview.daily.map(d => (
                <div className="td-bar-row" key={d.day}>
                  <span>{d.day.slice(5)}</span>
                  <div className="td-bar-track">
                    <div
                      className="td-bar"
                      style={{
                        width: `${Math.max(0, Math.min(
                          100, Number(d.amount) / maxDay * 100
                        ))}%`
                      }}
                    />
                  </div>
                  <strong>{money(d.amount)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="td-empty">
              {loading ? 'Cargando ventas…' : overview
                ? 'No hay ventas en este período.'
                : 'Datos no disponibles.'}
            </p>
          )}

          <div className="td-highlights">
            <div>
              <small>Producto más vendido</small>
              <b>{mainProduct?.name ?? 'Sin datos'}</b>
              {mainProduct && <span>{mainProduct.quantity} unidades</span>}
            </div>
            <div>
              <small>Mayor facturación por usuario</small>
              <b>{leader?.name ?? 'Sin datos'}</b>
              {leader && <span>{money(leader.amount)}</span>}
            </div>
          </div>
        </section>

        <section className="td-card">
          <div className="td-section-head">
            <div>
              <h3>⚠️ Atención de inventario</h3>
              <p>Productos que requieren revisión</p>
            </div>
            <button type="button" onClick={() => onNavigate('inventory')}>
              Ver inventario →
            </button>
          </div>

          {lowStock.length === 0 ? (
            <p className="td-ok">✓ No hay productos con stock bajo.</p>
          ) : (
            <div className="td-list">
              {lowStock.slice(0, 5).map(p => (
                <div className="td-list-row" key={p.id}>
                  <div>
                    <b>{p.name}</b>
                    <small>{p.code} · Mínimo: {p.min_stock}</small>
                  </div>
                  <span className={p.stock === 0 ? 'td-danger' : 'td-alert'}>
                    {p.stock === 0 ? 'Agotado' : `${p.stock} disponibles`}
                  </span>
                </div>
              ))}
              {lowStock.length > 5 && (
                <p className="td-more">
                  Y {lowStock.length - 5} productos más por revisar.
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      <div className="td-columns">
        <section className="td-card">
          <div className="td-section-head">
            <div>
              <h3>🕘 Actividad reciente</h3>
              <p>Últimos eventos registrados</p>
            </div>
            <button type="button" onClick={() => onNavigate('audit')}>
              Ver auditoría →
            </button>
          </div>

          {audit ? (
            audit.items.length ? (
              <div className="td-list">
                {audit.items.slice(0, 5).map(e => (
                  <div className="td-list-row" key={e.id}>
                    <div>
                      <b>{actionNames[e.action] || e.action}</b>
                      <small>{e.actor_name}</small>
                    </div>
                    <time>{dateTime(e.created_at)}</time>
                  </div>
                ))}
              </div>
            ) : <p className="td-empty">Sin actividad registrada.</p>
          ) : <p className="td-empty">
            {loading ? 'Cargando actividad…' : 'Actividad no disponible.'}
          </p>}
        </section>

        <section className="td-card">
          <div className="td-section-head">
            <div>
              <h3>💳 Control de caja</h3>
              <p>Últimas sesiones registradas</p>
            </div>
            <button type="button" onClick={() => onNavigate('cash-management')}>
              Ver cajas →
            </button>
          </div>

          {cash ? (
            cash.items.length ? (
              <div className="td-list">
                {cash.items.slice(0, 3).map(s => (
                  <div className="td-list-row" key={s.id}>
                    <div>
                      <b>{s.register_name}</b>
                      <small>Apertura: {dateTime(s.opened_at)}</small>
                    </div>
                    <span className={s.status === 'open' ? 'td-open' : 'td-closed'}>
                      {s.status === 'open' ? 'Abierta' : 'Cerrada'}
                    </span>
                  </div>
                ))}
              </div>
            ) : <p className="td-empty">Sin sesiones registradas.</p>
          ) : <p className="td-empty">
            {loading ? 'Cargando cajas…' : 'Cajas no disponibles.'}
          </p>}
        </section>
      </div>

      <section className="td-card">
        <div className="td-section-head">
          <div>
            <h3>⚡ Acceso rápido</h3>
            <p>Accede directamente a cualquier módulo del sistema</p>
          </div>
        </div>
        <div className="td-shortcuts">
          {shortcuts.map(item => (
            <button
              type="button"
              key={item.view}
              onClick={() => onNavigate(item.view)}
            >
              <span aria-hidden="true">{item.icon}</span>
              <b>{item.label}</b>
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </section>

      <p className="td-note">
        Los indicadores de ventas corresponden al período seleccionado.
        Inventario, vendedores y solicitudes muestran su estado actual.
        Las sesiones de caja y la actividad reciente son consultas de
        los registros más recientes.
      </p>
    </div>
  );
}
