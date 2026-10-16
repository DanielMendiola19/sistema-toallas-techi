
import { useCallback, useEffect, useMemo, useState } from 'react';
import './SalesPanel.css';

const API = 'http://localhost:3000/api';

type Product = {
  id: string;
  code: string;
  name: string;
  price_bob: string;
  stock: number;
};

type Session = {
  id: string;
  cash_register_id: string;
  register_name: string;
  closing_limit_at: string;
  opening_cash_bob: string;
};

type Register = {
  id: string;
  name: string;
};

type Method = 'cash' | 'qr' | 'transfer' | 'other';
type OpenMode = 'late' | 'night' | 'manual' | '';
type ExtendMode = '30' | '60' | '120' | 'manual' | '';

type SaleSuccess = {
  id: string;
  total: string;
  paymentLabel: string;
  items: number;
  reference?: string;
};

const methods: { value: Method; label: string }[] = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'qr', label: 'QR' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'other', label: 'Otro' }
];

const money = (n: number | string) =>
  Number(n).toLocaleString('es-BO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

function localDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    `${date.getFullYear()}-` +
    `${pad(date.getMonth() + 1)}-` +
    `${pad(date.getDate())}T` +
    `${pad(date.getHours())}:` +
    `${pad(date.getMinutes())}`
  );
}

function friendlyDate(value: string): string {
  if (!value) return 'Sin horario seleccionado';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Fecha u hora inválida';
  }

  return date.toLocaleString('es-BO', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function nextClosingTime(hour: number, minute: number) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);

  const isToday = date.getTime() > Date.now();

  if (!isToday) {
    date.setDate(date.getDate() + 1);
  }

  return {
    date,
    dayLabel: isToday ? 'Hoy' : 'Mañana'
  };
}

function updateDateTime(
  current: string,
  part: 'date' | 'time',
  value: string
): string {
  const [date = '', time = ''] = current.split('T');

  return part === 'date'
    ? `${value}T${time}`
    : `${date}T${value}`;
}

async function req<T>(
  path: string,
  token: string,
  method = 'GET',
  body?: unknown
): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok) {
    throw Error(data.error || 'Error de conexión');
  }

  return data as T;
}

export default function SalesPanel({
  token,
  admin,
  onInventoryChanged
}: {
  token: string;
  admin: boolean;
  onInventoryChanged: () => Promise<void>;
}) {
  // Información del punto de venta.
  const [products, setProducts] = useState<Product[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [registers, setRegisters] = useState<Register[]>([]);

  // Carrito y pagos.
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<Method>('cash');
  const [split, setSplit] = useState(false);
  const [cashAmount, setCashAmount] = useState('');
  const [reference, setReference] = useState('');

  // Administración de caja.
  const [selectedSession, setSelectedSession] = useState('');
  const [registerId, setRegisterId] = useState('');
  const [closingAt, setClosingAt] = useState('');
  const [extendAt, setExtendAt] = useState('');
  const [closeConfirm, setCloseConfirm] = useState(false);

  // Interfaz de apertura y extensión.
  const [openMode, setOpenMode] = useState<OpenMode>('');
  const [extendMode, setExtendMode] = useState<ExtendMode>('');
  const [extendModal, setExtendModal] = useState(false);

  // Nueva ventana de venta exitosa.
  const [saleSuccess, setSaleSuccess] = useState<SaleSuccess | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [requestKey, setRequestKey] = useState(
    () => crypto.randomUUID()
  );

  const refresh = useCallback(async () => {
    const [p, s, r] = await Promise.all([
      req<Product[]>('/products', token),
      req<Session[]>('/sales/sessions/current', token),
      req<Register[]>('/sales/registers', token)
    ]);

    setProducts(p);
    setSessions(s);
    setRegisters(r);

    setSelectedSession(prev =>
      s.some(x => x.id === prev)
        ? prev
        : (s[0]?.id || '')
    );

    setRegisterId(prev =>
      r.some(x => x.id === prev)
        ? prev
        : (r[0]?.id || '')
    );
  }, [token]);

  useEffect(() => {
    void refresh().catch(e =>
      setError(
        e instanceof Error
          ? e.message
          : 'No se pudieron cargar las ventas'
      )
    );
  }, [refresh]);

  // Cierre de ventanas con Escape.
  useEffect(() => {
    if (!extendModal && !closeConfirm && !saleSuccess) return;

    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !loading) {
        setExtendModal(false);
        setCloseConfirm(false);
        setSaleSuccess(null);
      }
    }

    document.addEventListener('keydown', onEscape);

    return () => {
      document.removeEventListener('keydown', onEscape);
    };
  }, [extendModal, closeConfirm, saleSuccess, loading]);

  const filtered = products
    .filter(p =>
      (p.code + ' ' + p.name)
        .toLowerCase()
        .includes(search.toLowerCase())
    )
    .slice(0, 40);

  const lines = useMemo(
    () =>
      products
        .filter(p => cart[p.id] > 0)
        .map(p => ({
          ...p,
          quantity: cart[p.id]
        })),
    [products, cart]
  );

  const totalCents = lines.reduce(
    (s, p) =>
      s + Math.round(Number(p.price_bob) * 100) * p.quantity,
    0
  );

  const total = totalCents / 100;

  const session = sessions.find(s => s.id === selectedSession);

  const canSell =
    Boolean(session) &&
    new Date(session!.closing_limit_at).getTime() > Date.now();

  const safeCents = (value: string) =>
    /^\d+(\.\d{1,2})?$/.test(value)
      ? Math.round(Number(value) * 100)
      : null;

  const cashCents = split ? safeCents(cashAmount) : null;

  const lateOption = nextClosingTime(22, 59);
  const nightOption = nextClosingTime(23, 59);

  const openingTime = closingAt
    ? new Date(closingAt).getTime()
    : NaN;

  const validOpening =
    Number.isFinite(openingTime) &&
    openingTime > Date.now();

  const currentDeadline = session
    ? new Date(session.closing_limit_at).getTime()
    : NaN;

  const extensionBase = Math.max(
    Date.now(),
    Number.isFinite(currentDeadline) ? currentDeadline : 0
  );

  const extensionTime = extendAt
    ? new Date(extendAt).getTime()
    : NaN;

  const validExtension =
    Boolean(session) &&
    Number.isFinite(extensionTime) &&
    extensionTime > extensionBase;

  async function act(action: () => Promise<void>) {
    setLoading(true);
    setError('');
    setNotice('');

    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Error inesperado'
      );
    } finally {
      setLoading(false);
    }
  }

  const add = (p: Product) =>
    setCart(c => ({
      ...c,
      [p.id]: Math.min(p.stock, (c[p.id] || 0) + 1)
    }));

  function changeQty(p: Product, n: number) {
    if (!Number.isSafeInteger(n)) return;

    setCart(c => ({
      ...c,
      [p.id]: Math.max(0, Math.min(p.stock, n))
    }));
  }

  // REGISTRAR VENTA: se conserva la petición original.
  async function sell() {
    if (!session || !canSell || !lines.length) {
      return setError('Abre una caja y agrega productos');
    }

    const pay = split
      ? cashCents === null ||
        cashCents <= 0 ||
        cashCents >= totalCents
        ? null
        : [
            {
              method: 'cash',
              amount_bob: cashCents / 100
            },
            {
              method: 'qr',
              amount_bob: (totalCents - cashCents) / 100,
              reference: reference || undefined
            }
          ]
      : [
          {
            method,
            amount_bob: total,
            reference: reference || undefined
          }
        ];

    if (!pay) {
      return setError(
        'En pago combinado, el efectivo debe ser mayor a cero y menor al total'
      );
    }

    // Capturamos los datos antes de vaciar el carrito.
    const saleTotal = money(total);
    const saleUnits = lines.reduce(
      (sum, item) => sum + item.quantity,
      0
    );
    const salePayment = split
      ? 'Efectivo + QR'
      : methods.find(m => m.value === method)?.label || 'Pago registrado';
    const saleReference = reference || undefined;

    await act(async () => {
      const saved = await req<{ id: string }>(
        '/sales',
        token,
        'POST',
        {
          request_key: requestKey,
          cash_session_id: session.id,
          items: lines.map(p => ({
            product_id: p.id,
            quantity: p.quantity
          })),
          payments: pay
        }
      );

      // Mostramos el comprobante únicamente si el
      // servidor confirmó que se registró la venta.
      setSaleSuccess({
        id: saved.id,
        total: saleTotal,
        paymentLabel: salePayment,
        items: saleUnits,
        reference: saleReference
      });

      setNotice('');
      setCart({});
      setCashAmount('');
      setReference('');
      setRequestKey(crypto.randomUUID());

      await refresh();
      await onInventoryChanged();
    });
  }

  // ABRIR CAJA: lógica original.
  async function openSession() {
    await act(async () => {
      if (!registerId || !closingAt || !validOpening) {
        throw Error('Selecciona una fecha y hora de cierre futura');
      }

      await req('/sales/sessions', token, 'POST', {
        register_id: registerId,
        closing_limit_at: new Date(closingAt).toISOString()
      });

      await refresh();

      setClosingAt('');
      setOpenMode('');
      setNotice('Caja abierta correctamente');
    });
  }

  // CERRAR CAJA: lógica original.
  async function closeSession() {
    if (!session) return;

    await act(async () => {
      const result = await req<{
        expected_cash_bob: string;
        totals_by_method: {
          qr_sales: string;
          transfer_sales: string;
          other_sales: string;
        };
      }>(
        `/sales/sessions/${session.id}/close`,
        token,
        'POST'
      );

      await refresh();
      setCloseConfirm(false);

      setNotice(
        `Caja cerrada. ` +
        `Efectivo: Bs ${result.expected_cash_bob}; ` +
        `QR: Bs ${money(result.totals_by_method.qr_sales)}; ` +
        `transferencias: Bs ${money(result.totals_by_method.transfer_sales)}; ` +
        `otros: Bs ${money(result.totals_by_method.other_sales)}. ` +
        `Sin conteo físico.`
      );
    });
  }

  // EXTENDER HORARIO: misma petición al backend.
  async function extendSession() {
    if (!session) return;

    await act(async () => {
      if (!extendAt || !validExtension) {
        throw Error('Selecciona una hora posterior al cierre actual');
      }

      await req(
        `/sales/sessions/${session.id}/extend`,
        token,
        'PATCH',
        {
          closing_limit_at: new Date(extendAt).toISOString()
        }
      );

      await refresh();

      setExtendModal(false);
      setExtendAt('');
      setExtendMode('');
      setNotice('Horario de caja ampliado correctamente');
    });
  }

  function chooseOpeningPreset(choice: 'late' | 'night') {
    const result = choice === 'late'
      ? nextClosingTime(22, 59)
      : nextClosingTime(23, 59);

    setClosingAt(localDateTime(result.date));
    setOpenMode(choice);
  }

  function chooseManualOpening() {
    const proposed = new Date();

    proposed.setHours(
      proposed.getHours() + 2,
      0, 0, 0
    );

    setClosingAt(localDateTime(proposed));
    setOpenMode('manual');
  }

  function openExtensionDialog() {
    if (!session) return;

    setExtendAt('');
    setExtendMode('');
    setError('');
    setExtendModal(true);
  }

  function chooseExtension(minutes: 30 | 60 | 120) {
    if (!session) return;

    const deadline = new Date(
      session.closing_limit_at
    ).getTime();

    const base = Math.max(Date.now(), deadline);
    const proposed = new Date(base + minutes * 60 * 1000);

    setExtendAt(localDateTime(proposed));
    setExtendMode(String(minutes) as ExtendMode);
  }

  function chooseManualExtension() {
    if (!session) return;

    const deadline = new Date(
      session.closing_limit_at
    ).getTime();

    const proposed = new Date(
      Math.max(Date.now(), deadline) +
      60 * 60 * 1000
    );

    proposed.setSeconds(0, 0);

    setExtendAt(localDateTime(proposed));
    setExtendMode('manual');
  }

  return (
    <div className="sales-module">
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      {/* PUNTO DE VENTA Y CAJA */}
      <section className="panel">
        <div className="sales-heading">
          <div>
            <h2>Punto de venta</h2>
            <p className="muted">
              Precios en Bs · Venta presencial
            </p>
          </div>

          <div className="sales-session">
            {session ? (
              <>
                <span className={canSell ? 'sale-open' : 'sale-closed'}>
                  {canSell
                    ? '● Caja habilitada'
                    : '● Horario vencido'}
                </span>
                <small>
                  {session.register_name} · hasta{' '}
                  {friendlyDate(session.closing_limit_at)}
                </small>
              </>
            ) : (
              <span className="sale-closed">
                ● Sin caja abierta
              </span>
            )}
          </div>
        </div>

        {admin && (
          <div className="cash-admin">
            {!sessions.length ? (
              <div className="cash-easy cash-opening">
                <div className="cash-easy-heading">
                  <div>
                    <h3>Abrir caja</h3>
                    <p>
                      Configura el horario para comenzar a vender.
                    </p>
                  </div>
                  <span className="cash-easy-status closed">
                    Sin abrir
                  </span>
                </div>

                {registers.length === 1 ? (
                  <div className="cash-opening-register">
                    <span
                      className="cash-opening-register-icon"
                      aria-hidden="true"
                    >
                      🏪
                    </span>
                    <div>
                      <strong>{registers[0].name}</strong>
                      <small>Tu caja de ventas</small>
                    </div>
                    <span
                      className="cash-opening-check"
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                  </div>
                ) : registers.length > 1 ? (
                  <label className="cash-easy-field">
                    Selecciona la caja
                    <select
                      value={registerId}
                      disabled={loading}
                      onChange={e => setRegisterId(e.target.value)}
                    >
                      {registers.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="cash-easy-warning">
                    No hay cajas disponibles. Verifica la configuración.
                  </p>
                )}

                <div className="cash-opening-question">
                  <h4>¿Cuándo quieres cerrar la caja?</h4>
                  <p>
                    Elige una opción para programar
                    el horario de cierre.
                  </p>
                </div>

                <div className="cash-opening-options">
                  <button
                    type="button"
                    disabled={loading}
                    aria-pressed={openMode === 'night'}
                    className={`cash-opening-option ${
                      openMode === 'night' ? 'active' : ''
                    }`}
                    onClick={() => chooseOpeningPreset('night')}
                  >
                    <span
                      className="cash-opening-option-icon"
                      aria-hidden="true"
                    >
                      🌙
                    </span>
                    <span className="cash-opening-option-text">
                      <strong>
                        {nightOption.dayLabel}, a las 11:59 p. m.
                      </strong>
                      <small>Cerrar al terminar el día</small>
                    </span>
                    <span
                      className="cash-opening-radio"
                      aria-hidden="true"
                    >
                      {openMode === 'night' ? '✓' : ''}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={loading}
                    aria-pressed={openMode === 'late'}
                    className={`cash-opening-option ${
                      openMode === 'late' ? 'active' : ''
                    }`}
                    onClick={() => chooseOpeningPreset('late')}
                  >
                    <span
                      className="cash-opening-option-icon"
                      aria-hidden="true"
                    >
                      🕚
                    </span>
                    <span className="cash-opening-option-text">
                      <strong>
                        {lateOption.dayLabel}, a las 10:59 p. m.
                      </strong>
                      <small>Cerrar una hora antes</small>
                    </span>
                    <span
                      className="cash-opening-radio"
                      aria-hidden="true"
                    >
                      {openMode === 'late' ? '✓' : ''}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={loading}
                    aria-pressed={openMode === 'manual'}
                    className={`cash-opening-option ${
                      openMode === 'manual' ? 'active' : ''
                    }`}
                    onClick={chooseManualOpening}
                  >
                    <span
                      className="cash-opening-option-icon"
                      aria-hidden="true"
                    >
                      📅
                    </span>
                    <span className="cash-opening-option-text">
                      <strong>Elegir otro horario</strong>
                      <small>Personalizar fecha y hora</small>
                    </span>
                    <span
                      className="cash-opening-radio"
                      aria-hidden="true"
                    >
                      {openMode === 'manual' ? '✓' : ''}
                    </span>
                  </button>
                </div>

                {openMode === 'manual' && (
                  <div className="cash-manual-fields">
                    <label>
                      Fecha de cierre
                      <input
                        type="date"
                        value={closingAt.split('T')[0] || ''}
                        min={localDateTime(new Date()).split('T')[0]}
                        disabled={loading}
                        onChange={e =>
                          setClosingAt(prev =>
                            updateDateTime(prev, 'date', e.target.value)
                          )
                        }
                      />
                    </label>

                    <label>
                      Hora de cierre
                      <input
                        type="time"
                        value={closingAt.split('T')[1] || ''}
                        disabled={loading}
                        onChange={e =>
                          setClosingAt(prev =>
                            updateDateTime(prev, 'time', e.target.value)
                          )
                        }
                      />
                    </label>
                  </div>
                )}

                {closingAt && (
                  <div className="cash-easy-preview" role="status">
                    <span>Cierre programado</span>
                    <strong>{friendlyDate(closingAt)}</strong>
                  </div>
                )}

                {!validOpening && closingAt && (
                  <p className="cash-easy-warning">
                    El horario de cierre debe ser posterior
                    a la hora actual.
                  </p>
                )}

                <button
                  type="button"
                  className="primary cash-easy-submit"
                  disabled={loading || !registerId || !validOpening}
                  onClick={() => void openSession()}
                >
                  {loading
                    ? 'Abriendo caja…'
                    : 'Abrir caja y comenzar ventas'}
                </button>
              </div>
            ) : (
              <div className="cash-easy">
                <div className="cash-easy-heading">
                  <div>
                    <h3>Control de caja actual</h3>
                    <p>
                      {session?.register_name || 'Caja seleccionada'}
                    </p>
                  </div>
                  <span
                    className={`cash-easy-status ${
                      canSell ? 'enabled' : 'expired'
                    }`}
                  >
                    {canSell
                      ? '● Caja abierta'
                      : '● Horario vencido'}
                  </span>
                </div>

                <div className="cash-easy-summary">
                  <div>
                    <span>Cierre programado</span>
                    <strong>
                      {session
                        ? friendlyDate(session.closing_limit_at)
                        : 'No disponible'}
                    </strong>
                  </div>
                  <div>
                    <span>Estado de las ventas</span>
                    <strong>
                      {canSell
                        ? 'Ventas habilitadas'
                        : 'Ventas pausadas'}
                    </strong>
                  </div>
                </div>

                {!canSell && (
                  <p className="cash-easy-warning">
                    El horario de esta caja venció.
                    Amplíalo para continuar vendiendo
                    o cierra la caja.
                  </p>
                )}

                <div className="cash-easy-actions">
                  <div className="cash-easy-action-copy">
                    <strong>¿Seguirás vendiendo?</strong>
                    <span>
                      Amplía el horario de la caja cuando
                      lo necesites.
                    </span>
                  </div>
                  <button
                    type="button"
                    className="cash-easy-extend"
                    disabled={loading || !session}
                    onClick={openExtensionDialog}
                  >
                    🕒 Extender horario
                  </button>
                </div>

                <div className="cash-easy-actions cash-easy-close-row">
                  <div className="cash-easy-action-copy">
                    <strong>¿Terminaste la jornada?</strong>
                    <span>
                      Cierra la caja cuando ya no registrarás
                      más ventas.
                    </span>
                  </div>
                  <button
                    type="button"
                    className="sale-danger"
                    disabled={loading || !session}
                    onClick={() => setCloseConfirm(true)}
                  >
                    Cerrar caja ahora
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* PRODUCTOS */}
      <div className="pos-layout">
        <section className="panel">
          <h2>Productos</h2>
          <input
            className="sales-search"
            placeholder="Buscar por nombre o código..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          <div className="sales-products">
            {filtered.map(p => (
              <button
                type="button"
                key={p.id}
                className="sales-product"
                disabled={loading || p.stock === 0 || !canSell}
                onClick={() => add(p)}
              >
                <span>
                  <strong>{p.name}</strong>
                  <small>{p.code} · Stock: {p.stock}</small>
                </span>
                <b>Bs {money(p.price_bob)}</b>
                <span className="sale-plus">+</span>
              </button>
            ))}
            {!filtered.length && (
              <p className="muted">
                No hay productos coincidentes.
              </p>
            )}
          </div>
        </section>

        {/* CARRITO */}
        <section className="panel sales-cart">
          <h2>
            Carrito{' '}
            <span className="sales-count">
              {lines.reduce((s, p) => s + p.quantity, 0)}
            </span>
          </h2>

          {lines.length === 0 ? (
            <p className="muted">
              Selecciona un producto para comenzar la venta.
            </p>
          ) : (
            <div className="sales-lines">
              {lines.map(p => (
                <div key={p.id} className="sales-line">
                  <div>
                    <strong>{p.name}</strong>
                    <small>Bs {money(p.price_bob)} c/u</small>
                  </div>

                  <div className="sales-quantity">
                    <button
                      type="button"
                      aria-label={`Quitar una unidad de ${p.name}`}
                      onClick={() => changeQty(p, p.quantity - 1)}
                    >
                      −
                    </button>
                    <span>{p.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Agregar una unidad de ${p.name}`}
                      onClick={() => changeQty(p, p.quantity + 1)}
                      disabled={p.quantity >= p.stock}
                    >
                      +
                    </button>
                  </div>

                  <b>
                    Bs {money(
                      Math.round(Number(p.price_bob) * 100) *
                      p.quantity / 100
                    )}
                  </b>
                </div>
              ))}
            </div>
          )}

          <div className="sales-total">
            <span>Total a cobrar</span>
            <strong>Bs {money(total)}</strong>
          </div>

          <div className="sales-payment">
            <label className="sales-check">
              <input
                type="checkbox"
                checked={split}
                onChange={e => setSplit(e.target.checked)}
              />
              Combinar efectivo + QR
            </label>

            {split ? (
              <label>
                Monto en efectivo (resto por QR)
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={cashAmount}
                  onChange={e => setCashAmount(e.target.value)}
                />
              </label>
            ) : (
              <label>
                Método de pago
                <select
                  value={method}
                  onChange={e =>
                    setMethod(e.target.value as Method)
                  }
                >
                  {methods.map(m => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {(split || method !== 'cash') && (
              <label>
                Referencia (opcional)
                <input
                  maxLength={120}
                  value={reference}
                  onChange={e => setReference(e.target.value)}
                  placeholder="Número de operación"
                />
              </label>
            )}
          </div>

          <button
            type="button"
            className="primary sale-submit"
            disabled={loading || !canSell || !lines.length}
            onClick={() => void sell()}
          >
            {loading ? 'Guardando...' : 'Confirmar venta'}
          </button>

          <button
            type="button"
            className="sale-clear"
            disabled={loading || !lines.length}
            onClick={() => {
              setCart({});
              setRequestKey(crypto.randomUUID());
            }}
          >
            🗑️ Vaciar carrito
          </button>

          <p className="muted sale-note">
            Los precios y el stock se vuelven a validar
            en el servidor antes de confirmar.
          </p>
        </section>
      </div>

      {/* EXTENDER HORARIO */}
      {admin && extendModal && session && (
        <div
          className="modal-shade"
          onMouseDown={e => {
            if (e.target === e.currentTarget && !loading) {
              setExtendModal(false);
            }
          }}
        >
          <div
            className="modal-box cash-extension-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Extender horario de caja"
          >
            <div className="modal-top">
              <div>
                <h2>Extender horario</h2>
                <p className="muted">
                  Elige cuánto tiempo adicional necesitas
                  para seguir vendiendo.
                </p>
              </div>
              <button
                className="modal-x"
                type="button"
                disabled={loading}
                aria-label="Cerrar ventana"
                onClick={() => setExtendModal(false)}
              >
                ×
              </button>
            </div>

            <div className="cash-extension-current">
              <span>Horario de cierre actual</span>
              <strong>
                {friendlyDate(session.closing_limit_at)}
              </strong>
            </div>

            <div className="cash-extension-content">
              <strong>¿Necesitas más tiempo?</strong>
              <p>
                Elige una opción rápida o selecciona
                un horario personalizado.
              </p>

              <div className="cash-extension-options">
                {([
                  [30, '+30 min'],
                  [60, '+1 hora'],
                  [120, '+2 horas']
                ] as const).map(([minutes, label]) => (
                  <button
                    key={minutes}
                    type="button"
                    disabled={loading}
                    aria-pressed={extendMode === String(minutes)}
                    className={`cash-easy-option ${
                      extendMode === String(minutes)
                        ? 'active'
                        : ''
                    }`}
                    onClick={() => chooseExtension(minutes)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="cash-extension-manual"
                disabled={loading}
                onClick={chooseManualExtension}
              >
                📅 Elegir otra fecha y hora
              </button>

              {extendMode === 'manual' && (
                <div className="cash-manual-fields">
                  <label>
                    Fecha de cierre
                    <input
                      type="date"
                      disabled={loading}
                      value={extendAt.split('T')[0] || ''}
                      min={
                        localDateTime(
                          new Date(extensionBase)
                        ).split('T')[0]
                      }
                      onChange={e =>
                        setExtendAt(prev =>
                          updateDateTime(
                            prev, 'date', e.target.value
                          )
                        )
                      }
                    />
                  </label>

                  <label>
                    Hora de cierre
                    <input
                      type="time"
                      disabled={loading}
                      value={extendAt.split('T')[1] || ''}
                      onChange={e =>
                        setExtendAt(prev =>
                          updateDateTime(
                            prev, 'time', e.target.value
                          )
                        )
                      }
                    />
                  </label>
                </div>
              )}

              {extendAt && (
                <div className="cash-easy-preview" role="status">
                  <span>Nuevo horario de cierre</span>
                  <strong>{friendlyDate(extendAt)}</strong>
                  <small>
                    El horario solo cambiará al confirmar.
                  </small>
                </div>
              )}

              {!validExtension && extendAt && (
                <p className="cash-easy-warning">
                  El nuevo horario debe ser posterior
                  al cierre actual.
                </p>
              )}

              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </div>

            <div className="cash-extension-footer">
              <button
                type="button"
                className="cash-cancel"
                disabled={loading}
                onClick={() => setExtendModal(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="primary"
                disabled={loading || !validExtension}
                onClick={() => void extendSession()}
              >
                {loading
                  ? 'Guardando...'
                  : 'Confirmar nuevo horario'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NUEVO COMPROBANTE DE VENTA EXITOSA */}
      {saleSuccess && (
        <div
          className="modal-shade"
          onMouseDown={e => {
            if (e.target === e.currentTarget && !loading) {
              setSaleSuccess(null);
            }
          }}
        >
          <div
            className="modal-box sale-success-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sale-success-title"
          >
            <div
              className="sale-success-icon"
              aria-hidden="true"
            >
              ✓
            </div>

            <span className="sale-success-eyebrow">
              PAGO CONFIRMADO
            </span>

            <h2 id="sale-success-title">
              ¡Venta realizada!
            </h2>

            <p className="sale-success-text">
              La venta se registró correctamente
              en el sistema.
            </p>

            <div className="sale-success-amount">
              <small>Total cobrado</small>
              <strong>Bs {saleSuccess.total}</strong>
            </div>

            <div className="sale-success-summary">
              <div>
                <span>Número de venta</span>
                <strong>#{saleSuccess.id}</strong>
              </div>

              <div>
                <span>Método de pago</span>
                <strong>{saleSuccess.paymentLabel}</strong>
              </div>

              <div>
                <span>Unidades vendidas</span>
                <strong>{saleSuccess.items}</strong>
              </div>

              {saleSuccess.reference && (
                <div>
                  <span>Referencia</span>
                  <strong>{saleSuccess.reference}</strong>
                </div>
              )}
            </div>

            <button
              type="button"
              className="sale-success-button"
              disabled={loading}
              onClick={() => setSaleSuccess(null)}
            >
              ✓ Seguir vendiendo
            </button>

            <p className="sale-success-footer">
              Toallas Techi · Venta registrada correctamente
            </p>
          </div>
        </div>
      )}

      {/* CONFIRMACIÓN DE CIERRE DE CAJA */}
      {closeConfirm && (
        <div
          className="modal-shade"
          onMouseDown={e => {
            if (e.target === e.currentTarget && !loading) {
              setCloseConfirm(false);
            }
          }}
        >
          <div
            className="modal-box"
            role="dialog"
            aria-modal="true"
            aria-label="Confirmar cierre de caja"
          >
            <div className="modal-top">
              <h2>¿Cerrar caja?</h2>
              <button
                className="modal-x"
                type="button"
                disabled={loading}
                onClick={() => setCloseConfirm(false)}
              >
                ×
              </button>
            </div>

            <p>
              Se calculará el efectivo esperado
              automáticamente. Al cerrar la caja,
              sus ventas ya no podrán anularse.
            </p>
            <p className="muted">
              Esto no es un conteo físico del efectivo.
            </p>

            <div className="confirm-actions">
              <button
                type="button"
                disabled={loading}
                onClick={() => setCloseConfirm(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={loading}
                className="sale-danger"
                onClick={() => void closeSession()}
              >
                Sí, cerrar caja
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
