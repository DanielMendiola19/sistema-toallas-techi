import { API, IMAGE_BASE } from './apiConfig';

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode
} from 'react';

import './App.css';
import './InventoryEnhancements.css';
import './SidebarScroll.css';

import logoToallas from './assets/logo-toallas.jpg';

import SalesPanel from './SalesPanel';
import SalesHistory from './SalesHistory';
import ReportsDashboard from './ReportsDashboard';
import GeneralDashboard from './GeneralDashboard';
import InventoryMovements from './InventoryMovements';
import ManagementPanel from './ManagementPanel';
import ProductImport from './ProductImport';



const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

type User = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'seller';
  is_active?: boolean;
};

type Product = {
  id: string;
  code: string;
  name: string;
  price_bob: string;
  stock: number;
  min_stock: number;
  image_key?: string | null;
};

type PriceRequest = {
  id: string;
  product_id: string;
  product_name: string;
  product_code: string;
  requested_by_name: string;
  old_price_bob: string;
  new_price_bob: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
};

type Draft = {
  code: string;
  name: string;
  price_bob: string;
  stock: string;
  min_stock: string;
};

type InventoryFilter =
  | 'all'
  | 'available'
  | 'low'
  | 'out';

type View =
  | 'dashboard'
  | 'inventory'
  | 'prices'
  | 'users'
  | 'sales'
  | 'history'
  | 'reports'
  | 'movements'
  | 'audit'
  | 'cash-management'
  | 'import';

const blank: Draft = {
  code: '',
  name: '',
  price_bob: '',
  stock: '0',
  min_stock: '2'
};

const formatMoney = (v: string | number) =>
  Number(v).toLocaleString('es-BO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

async function api<T>(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? {
        Authorization: `Bearer ${token}`
      } : {}),
      ...options.headers
    }
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Error de conexión');
  }

  return data as T;
}

// =============================================
// FOTOGRAFÍAS DE PRODUCTOS
// =============================================

function productPhotoUrl(
  product: Product
): string | null {
  if (!product.image_key) {
    return null;
  }

  return `${IMAGE_BASE}/${encodeURIComponent(
    product.image_key
  )}`;
}

async function uploadProductPhoto(
  token: string,
  productId: string,
  file: File
): Promise<void> {
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch(
    `${API}/products/${productId}/image`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: formData
    }
  );

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      result?.error ||
      'No se pudo subir la fotografía'
    );
  }
}

async function deleteProductPhoto(
  token: string,
  productId: string
): Promise<void> {
  await api(
    `/products/${productId}/image`,
    token,
    { method: 'DELETE' }
  );
}

// Miniatura o icono cuando no hay fotografía.
function ProductThumbnail({
  product,
  onOpen
}: {
  product: Product;
  onOpen: () => void;
}) {
  const url = productPhotoUrl(product);

  if (!url) {
    return (
      <span
        className="inventory-photo-placeholder"
        title="Sin fotografía"
        aria-label="Sin fotografía"
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect
            x="3"
            y="4"
            width="18"
            height="16"
            rx="2"
          />
          <circle cx="8.5" cy="9" r="1.5" />
          <path d="m3 17 6-5 4 3 3-3 5 5" />
        </svg>
      </span>
    );
  }

  return (
    <button
      type="button"
      className="inventory-photo-button"
      onClick={onOpen}
      aria-label={`Ver fotografía de ${product.name}`}
    >
      <img
        className="inventory-product-photo"
        src={url}
        alt=""
        loading="lazy"
      />
    </button>
  );
}

// =============================================
// COMPONENTES ORIGINALES
// =============================================

function Eye({ off }: { off: boolean }) {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {off ? (
        <>
          <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A11 11 0 0 1 12 5c5.5 0 9.2 4.6 10 7a12 12 0 0 1-4.2 5.3M6.3 6.3A12 12 0 0 0 2 12c.8 2.4 4.5 7 10 7 1.5 0 3-.4 4.2-1.1" />
        </>
      ) : (
        <>
          <path d="M2 12s3.7-7 10-7 10 7 10 7-3.7 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

function Modal({
  title,
  subtitle,
  close,
  children,
  busy = false
}: {
  title: string;
  subtitle?: string;
  close: () => void;
  children: ReactNode;
  busy?: boolean;
}) {
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        close();
      }
    }

    document.addEventListener('keydown', key);

    return () => {
      document.removeEventListener('keydown', key);
    };
  }, [close, busy]);

  return (
    <div
      className="modal-shade"
      onMouseDown={e => {
        if (
          e.currentTarget === e.target &&
          !busy
        ) {
          close();
        }
      }}
    >
      <div
        className="modal-box"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-top">
          <div>
            <h2>{title}</h2>
            {subtitle && (
              <p className="muted">{subtitle}</p>
            )}
          </div>

          <button
            type="button"
            className="modal-x"
            onClick={close}
            disabled={busy}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}

// =============================================
// APLICACIÓN PRINCIPAL
// =============================================

export default function App() {
  const [token, setToken] = useState(
    () => sessionStorage.getItem('toallas_token') || ''
  );

  const [user, setUser] = useState<User | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [
    showLoginPassword,
    setShowLoginPassword
  ] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [requests, setRequests] =
    useState<PriceRequest[]>([]);

  const [view, setView] = useState<View>('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);

  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState<string | null>(null);

  // Filtros de inventario.
  const [inventoryFilter, setInventoryFilter] =
    useState<InventoryFilter>('all');
  const [inventoryPage, setInventoryPage] = useState(1);
  const [priceQuery, setPriceQuery] = useState('');
  const [pricePickerOpen, setPricePickerOpen] = useState(false);
  const [profileModal, setProfileModal] = useState(false);
  const [profileDraft, setProfileDraft] = useState({name:'', email:'', currentPassword:'', password:''});
  const [showProfilePassword, setShowProfilePassword] = useState(false);

  // Nuevos estados de fotografías.
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [removeExistingPhoto, setRemoveExistingPhoto] =
    useState(false);
  const [previewProduct, setPreviewProduct] =
    useState<Product | null>(null);

  const [selected, setSelected] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [confirmPrice, setConfirmPrice] = useState(false);

  const [newUser, setNewUser] = useState({
    name: '',
    email: '',
    password: '',
    role: 'seller' as 'seller' | 'admin'
  });

  const [users, setUsers] = useState<User[]>([]);

  const [
    showNewUserPassword,
    setShowNewUserPassword
  ] = useState(false);

  const [editingUser, setEditingUser] =
    useState<User | null>(null);

  const [userEdit, setUserEdit] = useState({
    name: '',
    email: '',
    password: ''
  });

  const [
    showEditPassword,
    setShowEditPassword
  ] = useState(false);

  const [productModal, setProductModal] = useState(false);
  const [newSellerModal, setNewSellerModal] = useState(false);
  const [statusTarget, setStatusTarget] =
    useState<User | null>(null);

  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Vista previa de una imagen seleccionada.
  useEffect(() => {
    if (!photoFile) {
      setPhotoPreview('');
      return;
    }

    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [photoFile]);

  // Menú lateral.
  useEffect(() => {
    if (!menuOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    const onResize = () => {
      if (window.innerWidth > 850) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);

    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [menuOpen]);

  const signOut = useCallback(() => {
    sessionStorage.removeItem('toallas_token');
    setToken('');
    setUser(null);
    setProducts([]);
    setRequests([]);
    setUsers([]);
  }, []);

  const load = useCallback(
    async (currentUser: User, auth: string) => {
      try {
        const [p, r] = await Promise.all([
          api<Product[]>('/products', auth),
          api<PriceRequest[]>('/prices/requests', auth)
        ]);

        setProducts(p);
        setRequests(r);

        if (currentUser.role === 'admin') {
          setUsers(
            await api<User[]>('/users', auth)
          );
        }
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : 'Error al cargar'
        );
      }
    },
    []
  );

  useEffect(() => {
    if (!token) return;

    let active = true;

    void api<User>('/auth/me', token)
      .then(u => {
        if (active) {
          setUser(u);
          void load(u, token);
        }
      })
      .catch(() => {
        if (active) signOut();
      });

    return () => {
      active = false;
    };
  }, [token, load, signOut]);

  const run = async (
    action: () => Promise<void>
  ): Promise<boolean> => {
    setBusy(true);
    setError('');
    setNotice('');

    try {
      await action();
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Ocurrió un error'
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    if (user) {
      await load(user, token);
    }
  };

  useEffect(() => {
    if (
      user &&
      (view === 'inventory' || view === 'dashboard')
    ) {
      void load(user, token);
    }
  }, [view, user, token, load]);

  // =============================================
  // AUTENTICACIÓN ORIGINAL
  // =============================================

  async function login(e: FormEvent) {
    e.preventDefault();

    await run(async () => {
      const result = await api<{
        token: string;
        user: User;
      }>('/auth/login', '', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password
        })
      });

      sessionStorage.setItem(
        'toallas_token',
        result.token
      );

      setToken(result.token);
      setUser(result.user);
      setPassword('');
    });
  }

  // =============================================
  // PRODUCTOS Y FOTOGRAFÍAS
  // =============================================

  function resetPhotoForm() {
    setPhotoFile(null);
    setPhotoPreview('');
    setRemoveExistingPhoto(false);
  }

  function closeProductModal() {
    setProductModal(false);
    setEditing(null);
    setDraft(blank);
    resetPhotoForm();
    setError('');
  }

  function addProduct() {
    setDraft(blank);
    setEditing(null);
    resetPhotoForm();
    setProductModal(true);
    setError('');
  }

  function editProduct(p: Product) {
    setEditing(p.id);

    setDraft({
      code: p.code,
      name: p.name,
      price_bob: p.price_bob,
      stock: String(p.stock),
      min_stock: String(p.min_stock)
    });

    resetPhotoForm();
    setView('inventory');
    setProductModal(true);
    setError('');
  }

  function choosePhoto(file: File | null) {
    if (!file) return;

    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(
        file.type
      )
    ) {
      setError(
        'Solo se permiten fotografías JPG, PNG o WebP.'
      );
      return;
    }

    if (
      file.size === 0 ||
      file.size > MAX_PHOTO_BYTES
    ) {
      setError(
        'La fotografía debe pesar como máximo 2 MB.'
      );
      return;
    }

    setPhotoFile(file);
    setRemoveExistingPhoto(false);
    setError('');
  }

  async function saveProduct(e: FormEvent) {
    e.preventDefault();

    if (!user || user.role !== 'admin') return;

    const ok = await run(async () => {
      const price = Number(draft.price_bob);
      const stock = Number(draft.stock);
      const min = Number(draft.min_stock);

      if (
        !/^\d+(\.\d{1,2})?$/.test(draft.price_bob) ||
        !Number.isSafeInteger(stock) ||
        stock < 0 ||
        !Number.isSafeInteger(min) ||
        min < 0
      ) {
        throw Error('Revisa precio y cantidades');
      }

      // Conserva la creación y edición originales.
      const saved = await api<Product>(
        `/products${editing ? '/' + editing : ''}`,
        token,
        {
          method: editing ? 'PUT' : 'POST',
          body: JSON.stringify({
            code: draft.code,
            name: draft.name,
            price_bob: price,
            stock,
            min_stock: min
          })
        }
      );

      // La foto se procesa por separado para
      // evitar volver a crear un producto si falla.
      let photoError = '';

      try {
        if (photoFile) {
          await uploadProductPhoto(
            token,
            String(saved.id),
            photoFile
          );
        } else if (
          editing &&
          removeExistingPhoto
        ) {
          await deleteProductPhoto(
            token,
            String(saved.id)
          );
        }
      } catch (e) {
        photoError =
          e instanceof Error
            ? e.message
            : 'No se pudo guardar la fotografía';
      }

      await reload();

      if (photoError) {
        setNotice(
          'Los datos del producto se guardaron, pero ' +
          `hubo un problema con la fotografía: ${photoError}. ` +
          'Puedes volver a editarlo para reintentarlo.'
        );
      } else {
        setNotice(
          editing
            ? 'Producto actualizado correctamente'
            : 'Producto registrado correctamente'
        );
      }
    });

    if (ok) {
      closeProductModal();
    }
  }

  // =============================================
  // PRECIOS - FUNCIONES ORIGINALES
  // =============================================

  async function requestPrice(e: FormEvent) {
    e.preventDefault();

    if (user?.role === 'admin') {
      if (!selected || !/^\d+(\.\d{1,2})?$/.test(newPrice)) {setError('Selecciona un producto e ingresa un precio válido');return;}
      setConfirmPrice(true);
      return;
    }

    await run(async () => {
      if (
        !selected ||
        !/^\d+(\.\d{1,2})?$/.test(newPrice)
      ) {
        throw Error(
          'Ingresa un nuevo precio válido'
        );
      }

      await api('/prices/requests', token, {
        method: 'POST',
        body: JSON.stringify({
          product_id: selected,
          new_price_bob: Number(newPrice)
        })
      });

      setNewPrice('');
      setNotice('Solicitud enviada');
      await reload();
    });
  }

  async function changePriceDirect() {
    const ok = await run(async () => {
      if (
        !selected ||
        !/^\d+(\.\d{1,2})?$/.test(newPrice)
      ) {
        throw Error(
          'Ingresa un nuevo precio válido'
        );
      }

      await api(
        `/prices/products/${selected}`,
        token,
        {
          method: 'PATCH',
          body: JSON.stringify({
            new_price_bob: Number(newPrice)
          })
        }
      );

      setNotice(
        'Precio actualizado correctamente'
      );

      await reload();
    });

    if (ok) {
      setConfirmPrice(false);
      setNewPrice('');
    }
  }

  async function review(
    id: string,
    decision: 'approved' | 'rejected'
  ) {
    await run(async () => {
      await api(
        `/prices/requests/${id}/review`,
        token,
        {
          method: 'PATCH',
          body: JSON.stringify({ decision })
        }
      );

      setNotice(
        decision === 'approved'
          ? 'Precio aprobado y actualizado'
          : 'Solicitud rechazada'
      );

      await reload();
    });
  }

  // =============================================
  // VENDEDORES - FUNCIONES ORIGINALES
  // =============================================

  async function createSeller(e: FormEvent) {
    e.preventDefault();

    const ok = await run(async () => {
      await api('/users', token, {
        method: 'POST',
        body: JSON.stringify(newUser)
      });

      setNotice(newUser.role === 'admin' ? 'Administrador creado' : 'Vendedor creado');
      await reload();
    });

    if (ok) {
      setNewUser({
        name: '',
        email: '',
        password: '',
        role: 'seller'
      });

      setNewSellerModal(false);
    }
  }

  function startEditSeller(u: User) {
    setEditingUser(u);

    setUserEdit({
      name: u.name,
      email: u.email,
      password: ''
    });

    setShowEditPassword(false);
    setError('');
    setNotice('');
  }

  async function saveSeller(e: FormEvent) {
    e.preventDefault();

    if (!editingUser) return;

    const ok = await run(async () => {
      const body: {
        name: string;
        email: string;
        password?: string;
      } = {
        name: userEdit.name,
        email: userEdit.email
      };

      if (userEdit.password) {
        body.password = userEdit.password;
      }

      await api(
        `/users/${editingUser.id}`,
        token,
        {
          method: 'PATCH',
          body: JSON.stringify(body)
        }
      );

      setNotice(
        'Vendedor actualizado correctamente'
      );

      await reload();
    });

    if (ok) {
      setEditingUser(null);
      setUserEdit({
        name: '',
        email: '',
        password: ''
      });
      setShowEditPassword(false);
    }
  }

  async function saveOwnProfile(e: FormEvent) {
    e.preventDefault();
    if (!adminUser()) return;
    const ok = await run(async () => {
      const updated = await api<User>('/auth/profile', token, {method:'PATCH', body:JSON.stringify({
        name:profileDraft.name, email:profileDraft.email,
        ...(profileDraft.password ? {password:profileDraft.password,currentPassword:profileDraft.currentPassword} : {})
      })});
      setUser(updated);
      setNotice('Perfil actualizado correctamente');
      await load(updated, token);
    });
    if(ok){setProfileModal(false);setProfileDraft({name:'',email:'',currentPassword:'',password:''});}
  }
  function adminUser(){return user?.role === 'admin';}

  async function changeStatus(
    id: string,
    active: boolean
  ) {
    const ok = await run(async () => {
      await api(
        `/users/${id}/status`,
        token,
        {
          method: 'PATCH',
          body: JSON.stringify({
            is_active: active
          })
        }
      );

      await reload();
    });

    if (ok) {
      setStatusTarget(null);
    }
  }

  // =============================================
  // PANTALLA DE INICIO DE SESIÓN
  // =============================================

  if (!user) {
    return (
      <main className="login-screen">
        <form
          className="login-card"
          onSubmit={login}
        >
          <div className="login-identity">
            <img
              src={logoToallas}
              alt="Logo Toallas Techi"
              className="login-logo"
            />

            <span className="brand">
              TOALLAS TECHI · SISTEMA DE GESTIÓN
            </span>
          </div>

          <h1>Bienvenido</h1>
          <p>
            Inicia sesión para gestionar tu tienda.
          </p>

          <label>
            Correo
            <input
              type="email"
              required
              value={email}
              onChange={e =>
                setEmail(e.target.value)
              }
            />
          </label>

          <label>
            Contraseña

            <div className="password-field">
              <input
                type={
                  showLoginPassword
                    ? 'text'
                    : 'password'
                }
                autoComplete="current-password"
                required
                value={password}
                onChange={e =>
                  setPassword(e.target.value)
                }
              />

              <button
                type="button"
                className="password-toggle"
                aria-label={
                  showLoginPassword
                    ? 'Ocultar contraseña'
                    : 'Mostrar contraseña'
                }
                aria-pressed={showLoginPassword}
                onClick={() =>
                  setShowLoginPassword(v => !v)
                }
              >
                <Eye off={showLoginPassword} />
              </button>
            </div>
          </label>

          <button
            disabled={busy}
            className="primary"
          >
            Ingresar
          </button>

          {error && (
            <p className="error">{error}</p>
          )}
        </form>
      </main>
    );
  }

  // =============================================
  // DATOS CALCULADOS
  // =============================================

  const admin = user.role === 'admin';

  const low = products.filter(
    p => p.stock <= p.min_stock
  );

  const inventoryCounts = {
    all: products.length,

    available: products.filter(
      p => p.stock > p.min_stock
    ).length,

    low: products.filter(
      p => p.stock > 0 &&
      p.stock <= p.min_stock
    ).length,

    out: products.filter(
      p => p.stock === 0
    ).length
  };

  const visible = products.filter(p => {
    const matchesSearch = (
      p.code + ' ' + p.name
    ).toLowerCase().includes(
      search.trim().toLowerCase()
    );

    const matchesState =
      inventoryFilter === 'all' ||
      (
        inventoryFilter === 'available' &&
        p.stock > p.min_stock
      ) ||
      (
        inventoryFilter === 'low' &&
        p.stock > 0 &&
        p.stock <= p.min_stock
      ) ||
      (
        inventoryFilter === 'out' &&
        p.stock === 0
      );

    return matchesSearch && matchesState;
  });

  const inventoryPages = Math.max(1, Math.ceil(visible.length / 15));
  const actualInventoryPage = Math.min(inventoryPage, inventoryPages);
  const pagedProducts = visible.slice((actualInventoryPage - 1) * 15, actualInventoryPage * 15);
  const priceMatches = products.filter(p => (p.code + ' ' + p.name).toLocaleLowerCase('es').includes(priceQuery.trim().toLocaleLowerCase('es')));

  const editingProduct = editing
    ? products.find(p => p.id === editing)
    : null;

  const existingPhoto = editingProduct
    ? productPhotoUrl(editingProduct)
    : null;

  const formPhoto =
    photoPreview ||
    (
      !removeExistingPhoto
        ? existingPhoto
        : null
    );

  const nav: [View, string][] = [
    ['dashboard', 'Resumen'],
    ['sales', 'Ventas'],
    ['history', 'Historial de ventas'],

    ...(admin
      ? [['reports', 'Reportes'] as [View, string]]
      : []),

    ['inventory', 'Inventario'],

    ...(admin
      ? [['import', 'Importar Excel'] as [View, string]]
      : []),

    ...(admin
      ? [
          ['movements', 'Movimientos'] as [View, string],
          ['cash-management', 'Control de caja'] as [View, string],
          ['audit', 'Auditoría'] as [View, string]
        ]
      : []),

    ['prices', 'Precios'],

    ...(admin
      ? [['users', 'Vendedores'] as [View, string]]
      : [])
  ];

  // =============================================
  // INTERFAZ PRINCIPAL
  // =============================================

  return (
    <div className="shell">
      {menuOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Cerrar menú"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <aside
        id="main-navigation"
        className={`sidebar ${
          menuOpen ? 'sidebar-open' : ''
        }`}
      >
        <div className="logo">
          <img
            className="sidebar-brand-image"
            src={logoToallas}
            alt="Logo Toallas Techi"
          />

          <div className="sidebar-brand-copy">
            <strong>Toallas Techi</strong>
            <small>Sistema de gestión</small>
          </div>

          <button
            type="button"
            className="sidebar-close"
            aria-label="Cerrar menú"
            onClick={() =>
              setMenuOpen(false)
            }
          >
            ×
          </button>
        </div>

        <div className="sidebar-label">
          MENÚ PRINCIPAL
        </div>

        <nav>
          {nav.map(([id, label]) => (
            <button
              key={id}
              className={
                view === id ? 'active' : ''
              }
              onClick={() => {
                setView(id);
                setMenuOpen(false);
                setNotice('');
                setError('');
              }}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <span>
            {admin ? 'Administrador' : 'Vendedor'}
            <b>{user.name}</b>
          </span>

          <button
            onClick={() => {
              void api(
                '/auth/logout',
                token,
                { method: 'POST' }
              ).finally(signOut);
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="menu-toggle"
              aria-label={
                menuOpen
                  ? 'Cerrar menú'
                  : 'Abrir menú'
              }
              aria-expanded={menuOpen}
              aria-controls="main-navigation"
              onClick={() =>
                setMenuOpen(v => !v)
              }
            >
              <span />
              <span />
              <span />
            </button>

            <img
              src={logoToallas}
              alt=""
              className="mobile-header-logo"
            />

            <div className="topbar-heading">
              <span className="eyebrow">
                PANEL{' '}
                {admin
                  ? 'ADMINISTRATIVO'
                  : 'DE VENTAS'}
              </span>

              <h1>
                {view === 'dashboard'
                  ? 'Resumen general'
                  : view === 'inventory'
                  ? 'Inventario'
                  : view === 'import'
                  ? 'Importar Excel'
                  : view === 'audit'
                  ? 'Auditoría'
                  : view === 'cash-management'
                  ? 'Control de caja'
                  : view === 'movements'
                  ? 'Movimientos de inventario'
                  : view === 'prices'
                  ? 'Gestión de precios'
                  : view === 'sales'
                  ? 'Punto de venta'
                  : view === 'history'
                  ? 'Historial de ventas'
                  : view === 'reports'
                  ? 'Reportes'
                  : 'Vendedores'}
              </h1>
            </div>
          </div>

          <span className="user-pill">
            {user.name} · {admin ? 'Admin' : 'Ventas'}
          </span>
        </header>

        {notice && (
          <div className="notice">
            {notice}
          </div>
        )}

        {error && (
          <div className="error">
            {error}
          </div>
        )}

        {/* REPORTES */}
        {view === 'reports' && admin && (
          <ReportsDashboard token={token} />
        )}

        {/* IMPORTACIÓN EXCEL */}
        {view === 'import' && admin && (
          <ProductImport
            token={token}
            onImported={reload}
          />
        )}

        {/* AUDITORÍA */}
        {view === 'audit' && admin && (
          <ManagementPanel
            token={token}
            mode="audit"
          />
        )}

        {/* CONTROL DE CAJA */}
        {view === 'cash-management' && admin && (
          <ManagementPanel
            token={token}
            mode="cash"
          />
        )}

        {/* MOVIMIENTOS */}
        {view === 'movements' && admin && (
          <InventoryMovements
            token={token}
            onChanged={reload}
          />
        )}

        {/* PUNTO DE VENTA */}
        {view === 'sales' && (
          <SalesPanel
            token={token}
            admin={admin}
            onInventoryChanged={reload}
          />
        )}

        {/* HISTORIAL DE VENTAS */}
        {view === 'history' && (
          <SalesHistory
            token={token}
            admin={admin}
            onInventoryChanged={reload}
          />
        )}

        {/* RESUMEN ADMINISTRADOR */}
        {view === 'dashboard' && admin && (
          <GeneralDashboard
            token={token}
            products={products}
            requests={requests}
            users={users}
            onNavigate={setView}
          />
        )}

        {/* RESUMEN VENDEDOR */}
        {view === 'dashboard' && !admin && (
          <>
            <div className="stats">
              <article>
                <span>Productos disponibles</span>
                <strong>{products.length}</strong>
              </article>

              <article>
                <span>Stock bajo o agotado</span>
                <strong>{low.length}</strong>
              </article>

              <article>
                <span>Mis solicitudes pendientes</span>
                <strong>
                  {requests.filter(
                    r => r.status === 'pending'
                  ).length}
                </strong>
              </article>
            </div>

            <section className="panel">
              <h2>Atención de inventario</h2>
              <p className="muted">
                Productos que necesitan reposición.
              </p>

              {low.length === 0 ? (
                <p>Todo en orden.</p>
              ) : (
                <div className="tablewrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>Código</th>
                        <th>Stock</th>
                        <th>Estado</th>
                      </tr>
                    </thead>

                    <tbody>
                      {low.map(p => (
                        <tr key={p.id}>
                          <td>{p.name}</td>
                          <td>{p.code}</td>
                          <td>{p.stock}</td>
                          <td>
                            <span className="tag warning">
                              {p.stock === 0
                                ? 'Agotado'
                                : 'Bajo'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {/* ==================================
            INVENTARIO CON FOTOS Y FILTROS
            ================================== */}
        {view === 'inventory' && (
          <>
            <section className="panel inventory-page">
              <div className="section-head">
                <div>
                  <h2>Productos</h2>
                  <p className="muted">
                    Consulta existencias, fotografías
                    y precios vigentes.
                  </p>
                </div>

                {admin && (
                  <button
                    className="primary"
                    type="button"
                    onClick={addProduct}
                  >
                    + Agregar nuevo producto
                  </button>
                )}

                <input
                  aria-label="Buscar producto"
                  placeholder="Buscar producto..."
                  value={search}
                  onChange={e => {setSearch(e.target.value);setInventoryPage(1);}}
                />
              </div>

              {/* FILTROS RÁPIDOS */}
              <div
                className="inventory-quickfilters"
                role="group"
                aria-label="Filtrar productos por existencias"
              >
                {([
                  ['all', 'Todos', inventoryCounts.all],
                  [
                    'available',
                    'Disponibles',
                    inventoryCounts.available
                  ],
                  ['low', 'Stock bajo', inventoryCounts.low],
                  ['out', 'Agotados', inventoryCounts.out]
                ] as const).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={
                      inventoryFilter === key
                    }
                    className={`inventory-filter-button ${
                      inventoryFilter === key
                        ? 'is-active'
                        : ''
                    }`}
                    onClick={() =>
                      (setInventoryFilter(key), setInventoryPage(1))
                    }
                  >
                    {label}

                    <span className="inventory-filter-count">
                      {count}
                    </span>
                  </button>
                ))}
              </div>

              {/* TABLA DE INVENTARIO */}
              <div className="tablewrap">
                <table className="inventory-table">
                  <thead>
                    <tr>
                      <th>Foto</th>
                      <th>Código</th>
                      <th>Producto</th>
                      <th>Precio</th>
                      <th>Stock</th>
                      <th>Estado</th>
                      {admin && <th>Acción</th>}
                    </tr>
                  </thead>

                  <tbody>
                    {pagedProducts.map(p => {
                      const state =
                        p.stock === 0
                          ? 'out'
                          : p.stock <= p.min_stock
                          ? 'low'
                          : 'available';

                      return (
                        <tr
                          key={p.id}
                          className={
                            state === 'out'
                              ? 'inventory-row-out'
                              : ''
                          }
                        >
                          <td>
                            <ProductThumbnail
                              product={p}
                              onOpen={() =>
                                setPreviewProduct(p)
                              }
                            />
                          </td>

                          <td>{p.code}</td>
                          <td>{p.name}</td>

                          <td>
                            Bs {formatMoney(p.price_bob)}
                          </td>

                          <td>{p.stock}</td>

                          <td>
                            <span
                              className={`tag inventory-stock-status inventory-stock-${state}`}
                            >
                              {state === 'out'
                                ? 'Agotado'
                                : state === 'low'
                                ? 'Stock bajo'
                                : 'Disponible'}
                            </span>
                          </td>

                          {admin && (
                            <td>
                              <button
                                className="link"
                                onClick={() =>
                                  editProduct(p)
                                }
                              >
                                Editar
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {visible.length === 0 && (
                  <p className="inventory-empty">
                    No hay productos que coincidan
                    con la búsqueda o el filtro seleccionado.
                  </p>
                )}
              </div>
              <div className="inventory-pagination">
                <span>Mostrando {visible.length === 0 ? 0 : (actualInventoryPage-1)*15+1}–{Math.min(actualInventoryPage*15,visible.length)} de {visible.length} productos · Página {actualInventoryPage} de {inventoryPages}</span>
                <div><button type="button" disabled={actualInventoryPage<=1} onClick={()=>setInventoryPage(p=>Math.max(1,p-1))}>Anterior</button>
                <button type="button" disabled={actualInventoryPage>=inventoryPages} onClick={()=>setInventoryPage(p=>Math.min(inventoryPages,p+1))}>Siguiente</button></div>
              </div>
            </section>

            {/* MODAL PARA CREAR O EDITAR PRODUCTO */}
            {admin && productModal && (
              <Modal
                title={
                  editing
                    ? 'Editar producto'
                    : 'Agregar nuevo producto'
                }
                subtitle="Completa los datos y, si deseas, añade una fotografía."
                busy={busy}
                close={closeProductModal}
              >
                <form
                  onSubmit={saveProduct}
                  className="grid-form"
                >
                  <label>
                    Código
                    <input
                      required
                      value={draft.code}
                      onChange={e =>
                        setDraft({
                          ...draft,
                          code: e.target.value
                        })
                      }
                    />
                  </label>

                  <label>
                    Nombre
                    <input
                      required
                      value={draft.name}
                      onChange={e =>
                        setDraft({
                          ...draft,
                          name: e.target.value
                        })
                      }
                    />
                  </label>

                  <label>
                    Precio Bs
                    <input
                      required
                      value={draft.price_bob}
                      onChange={e =>
                        setDraft({
                          ...draft,
                          price_bob: e.target.value
                        })
                      }
                    />
                  </label>

                  {!editing && (
                    <label>
                      Stock inicial
                      <input
                        required
                        type="number"
                        min="0"
                        value={draft.stock}
                        onChange={e =>
                          setDraft({
                            ...draft,
                            stock: e.target.value
                          })
                        }
                      />
                    </label>
                  )}

                  <label>
                    Alerta desde
                    <input
                      required
                      type="number"
                      min="0"
                      value={draft.min_stock}
                      onChange={e =>
                        setDraft({
                          ...draft,
                          min_stock: e.target.value
                        })
                      }
                    />
                  </label>

                  {/* FOTOGRAFÍA DEL PRODUCTO */}
                  <div className="inventory-photo-editor">
                    <div className="inventory-photo-editor-head">
                      <strong>
                        Fotografía del producto
                      </strong>

                      <small>
                        Opcional · JPG, PNG o WebP · Máximo 2 MB
                      </small>
                    </div>

                    <div className="inventory-photo-editor-content">
                      <div className="inventory-photo-preview">
                        {formPhoto ? (
                          <img
                            src={formPhoto}
                            alt="Vista previa del producto"
                          />
                        ) : (
                          <span>
                            Sin fotografía
                          </span>
                        )}
                      </div>

                      <div className="inventory-photo-editor-actions">
                        <label className="inventory-upload-label">
                          Seleccionar fotografía

                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            disabled={busy}
                            onChange={e => {
                              choosePhoto(
                                e.target.files?.[0] ?? null
                              );

                              e.target.value = '';
                            }}
                          />
                        </label>

                        {(
                          photoFile ||
                          (
                            existingPhoto &&
                            !removeExistingPhoto
                          )
                        ) && (
                          <button
                            type="button"
                            className="inventory-remove-photo"
                            disabled={busy}
                            onClick={() => {
                              setPhotoFile(null);
                              setRemoveExistingPhoto(true);
                            }}
                          >
                            Quitar fotografía
                          </button>
                        )}

                        <p className="muted">
                          Al guardar, el sistema convierte
                          la imagen a WebP, hasta 800 píxeles
                          por lado y máximo 150 KB almacenados.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="form-actions">
                    <button
                      className="primary"
                      disabled={busy}
                    >
                      {busy ? 'Guardando…' : 'Guardar'}
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={closeProductModal}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>

                {error && (
                  <p className="modal-alert">{error}</p>
                )}
              </Modal>
            )}

            {/* VISTA AMPLIADA DE FOTOGRAFÍA */}
            {previewProduct &&
              productPhotoUrl(previewProduct) && (
                <Modal
                  title={previewProduct.name}
                  subtitle={`Código: ${previewProduct.code}`}
                  close={() =>
                    setPreviewProduct(null)
                  }
                >
                  <div className="inventory-photo-lightbox">
                    <img
                      src={
                        productPhotoUrl(previewProduct)!
                      }
                      alt={previewProduct.name}
                    />
                  </div>
                </Modal>
              )}
          </>
        )}

        {/* ==================================
            GESTIÓN DE PRECIOS ORIGINAL
            ================================== */}
        {view === 'prices' && (
          <>
            <section className="panel form-panel">
              <h2>
                {admin
                  ? 'Cambiar precio'
                  : 'Solicitar cambio de precio'}
              </h2>

              <p className="muted">
                {admin
                  ? 'Selecciona un producto y confirma el cambio directo de precio.'
                  : 'Selecciona un producto e introduce el nuevo precio; el administrador revisará la solicitud.'}
              </p>

              <form
                onSubmit={requestPrice}
                className="grid-form"
              >
                <div className="price-product-picker">
                  <label htmlFor="price-product-search">Producto</label>
                  <button type="button" className="price-selected-button" onClick={()=>setPricePickerOpen(v=>!v)} aria-expanded={pricePickerOpen}>
                    {products.find(p=>p.id===selected) ? `${products.find(p=>p.id===selected)!.code} — ${products.find(p=>p.id===selected)!.name} (Bs ${formatMoney(products.find(p=>p.id===selected)!.price_bob)})` : 'Selecciona un producto'} <span aria-hidden="true">⌄</span>
                  </button>
                  {pricePickerOpen && <div className="price-picker-options">
                    <input id="price-product-search" autoFocus type="search" placeholder="Buscar por código o nombre…" value={priceQuery} onChange={e=>setPriceQuery(e.target.value)}/>
                    <div className="price-picker-list" role="listbox" aria-label="Productos disponibles">
                      {priceMatches.length===0 ? <p className="muted">No se encontraron productos.</p> : priceMatches.map(p=><button type="button" key={p.id} role="option" aria-selected={selected===p.id} onClick={()=>{setSelected(p.id);setPricePickerOpen(false);setPriceQuery('');}}>{p.code} — {p.name} <small>Bs {formatMoney(p.price_bob)}</small></button>)}
                    </div>
                  </div>}
                </div>

                <label>
                  Nuevo precio en Bs
                  <input
                    required
                    inputMode="decimal"
                    placeholder="Añadir nuevo Precio"
                    value={newPrice}
                    onChange={e =>
                      setNewPrice(e.target.value)
                    }
                  />
                </label>

                <div className="form-actions">
                  <button
                    disabled={busy}
                    className="primary"
                  >
                    {admin
                      ? 'Cambiar precio'
                      : 'Enviar solicitud'}
                  </button>
                </div>
              </form>
            </section>

            <section className="panel">
              <h2>
                {admin
                  ? 'Solicitudes recibidas'
                  : 'Mis solicitudes'}
              </h2>

              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Solicitante</th>
                      <th>Anterior</th>
                      <th>Nuevo</th>
                      <th>Estado</th>
                      {admin && <th>Revisar</th>}
                    </tr>
                  </thead>

                  <tbody>
                    {requests.map(r => (
                      <tr key={r.id}>
                        <td>{r.product_name}</td>
                        <td>{r.requested_by_name}</td>
                        <td>
                          Bs {formatMoney(r.old_price_bob)}
                        </td>
                        <td>
                          Bs {formatMoney(r.new_price_bob)}
                        </td>

                        <td>
                          <span
                            className={`tag ${
                              r.status === 'pending'
                                ? 'warning'
                                : r.status === 'approved'
                                ? 'success'
                                : 'neutral'
                            }`}
                          >
                            {r.status === 'pending'
                              ? 'Pendiente'
                              : r.status === 'approved'
                              ? 'Aprobada'
                              : 'Rechazada'}
                          </span>
                        </td>

                        {admin && (
                          <td>
                            {r.status === 'pending' && (
                              <div className="row-actions">
                                <button
                                  disabled={busy}
                                  className="approve"
                                  onClick={() =>
                                    void review(
                                      r.id,
                                      'approved'
                                    )
                                  }
                                >
                                  Aprobar
                                </button>

                                <button
                                  disabled={busy}
                                  className="reject"
                                  onClick={() =>
                                    void review(
                                      r.id,
                                      'rejected'
                                    )
                                  }
                                >
                                  Rechazar
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* CONFIRMACIÓN DE CAMBIO DE PRECIO */}
        {confirmPrice && admin && (
          <Modal
            title="¿Confirmar nuevo precio?"
            subtitle="El cambio se aplicará inmediatamente, sin solicitar otra aprobación."
            busy={busy}
            close={() => setConfirmPrice(false)}
          >
            <p>
              ¿Cambiar el precio de{' '}
              <strong>
                {products.find(
                  p => p.id === selected
                )?.name}
              </strong>{' '}
              de{' '}
              <strong>
                Bs {formatMoney(
                  products.find(
                    p => p.id === selected
                  )?.price_bob ?? 0
                )}
              </strong>{' '}
              a{' '}
              <strong>
                Bs {formatMoney(newPrice || 0)}
              </strong>
              ?
            </p>

            <div className="confirm-actions">
              <button
                disabled={busy}
                onClick={() =>
                  setConfirmPrice(false)
                }
              >
                Cancelar
              </button>

              <button
                disabled={busy}
                className="primary"
                onClick={() =>
                  void changePriceDirect()
                }
              >
                Sí, cambiar precio
              </button>
            </div>

            {error && (
              <p className="modal-alert">{error}</p>
            )}
          </Modal>
        )}

        {/* ==================================
            VENDEDORES ORIGINALES
            ================================== */}
        {view === 'users' && admin && (
          <>
            <div className="users-action users-actions-extended">
              <button type="button" className="plain-button" onClick={()=>{setProfileDraft({name:user.name,email:user.email,currentPassword:'',password:''});setShowProfilePassword(false);setProfileModal(true);setError('');}}>Editar mi perfil</button>
              <button
                className="primary"
                type="button"
                onClick={() => {
                  setNewSellerModal(true);
                  setError('');
                  setNewUser({
                    name: '',
                    email: '',
                    password: '',
                    role: 'seller'
                  });
                }}
              >
                + Registrar usuario
              </button>
            </div>

            {profileModal && <Modal title="Editar mi perfil" subtitle="Actualiza tu nombre o correo. Para cambiar la contraseña debes ingresar la actual." busy={busy} close={()=>{setProfileModal(false);setError('');}}>
              <form className="grid-form" onSubmit={saveOwnProfile}>
                <label>Nombre<input required maxLength={120} value={profileDraft.name} onChange={e=>setProfileDraft({...profileDraft,name:e.target.value})}/></label>
                <label>Correo<input required type="email" value={profileDraft.email} onChange={e=>setProfileDraft({...profileDraft,email:e.target.value})}/></label>
                <label>Contraseña actual (solo si cambias contraseña)<input type={showProfilePassword?'text':'password'} autoComplete="current-password" required={Boolean(profileDraft.password)} value={profileDraft.currentPassword} onChange={e=>setProfileDraft({...profileDraft,currentPassword:e.target.value})}/></label>
                <label>Nueva contraseña (opcional, mínimo 12 caracteres)<input type={showProfilePassword?'text':'password'} autoComplete="new-password" minLength={12} maxLength={200} value={profileDraft.password} onChange={e=>setProfileDraft({...profileDraft,password:e.target.value})}/></label>
                <label className="profile-visibility"><input type="checkbox" checked={showProfilePassword} onChange={e=>setShowProfilePassword(e.target.checked)}/> Mostrar contraseñas</label>
                <div className="form-actions"><button className="primary" disabled={busy}>Guardar perfil</button><button type="button" disabled={busy} onClick={()=>setProfileModal(false)}>Cancelar</button></div>
              </form>{error&&<p className="modal-alert">{error}</p>}
            </Modal>}

            {newSellerModal && (
              <Modal
                title="Registrar usuario"
                subtitle="Completa los datos para crear su cuenta."
                busy={busy}
                close={() => {
                  setNewSellerModal(false);
                  setError('');
                }}
              >
                <form
                  className="grid-form"
                  onSubmit={createSeller}
                >
                  <label>
                    Nombre
                    <input
                      required
                      value={newUser.name}
                      onChange={e =>
                        setNewUser({
                          ...newUser,
                          name: e.target.value
                        })
                      }
                    />
                  </label>

                  <label>
                    Correo
                    <input
                      type="email"
                      required
                      value={newUser.email}
                      onChange={e =>
                        setNewUser({
                          ...newUser,
                          email: e.target.value
                        })
                      }
                    />
                  </label>

                  <label>Rol de la cuenta
                    <select value={newUser.role} onChange={e=>setNewUser({...newUser,role:e.target.value as 'seller'|'admin'})}>
                      <option value="seller">Vendedor</option><option value="admin">Administrador</option>
                    </select>
                  </label>

                  <label>
                    Contraseña inicial (mínimo 12 caracteres)
                    <div className="password-field">
                      <input
                        required
                        type={
                          showNewUserPassword
                            ? 'text'
                            : 'password'
                        }
                        autoComplete="new-password"
                        minLength={12}
                        maxLength={200}
                        value={newUser.password}
                        onChange={e =>
                          setNewUser({
                            ...newUser,
                            password: e.target.value
                          })
                        }
                      />

                      <button
                        type="button"
                        className="password-toggle"
                        aria-label={
                          showNewUserPassword
                            ? 'Ocultar contraseña'
                            : 'Mostrar contraseña'
                        }
                        aria-pressed={showNewUserPassword}
                        onClick={() =>
                          setShowNewUserPassword(v => !v)
                        }
                      >
                        <Eye off={showNewUserPassword} />
                      </button>
                    </div>
                  </label>

                  <div className="form-actions">
                    <button
                      disabled={busy}
                      className="primary"
                    >
                      Crear {newUser.role === 'admin' ? 'administrador' : 'vendedor'}
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setNewSellerModal(false)
                      }
                    >
                      Cancelar
                    </button>
                  </div>
                </form>

                {error && (
                  <p className="modal-alert">
                    {error}
                  </p>
                )}
              </Modal>
            )}

            {editingUser && (
              <Modal
                title={`Editar vendedor: ${editingUser.name}`}
                subtitle="Deja vacía la contraseña si no deseas cambiarla."
                busy={busy}
                close={() => {
                  setEditingUser(null);
                  setError('');
                }}
              >
                <form
                  className="grid-form"
                  onSubmit={saveSeller}
                >
                  <label>
                    Nombre
                    <input
                      required
                      maxLength={120}
                      value={userEdit.name}
                      onChange={e =>
                        setUserEdit({
                          ...userEdit,
                          name: e.target.value
                        })
                      }
                    />
                  </label>

                  <label>
                    Correo
                    <input
                      required
                      type="email"
                      value={userEdit.email}
                      onChange={e =>
                        setUserEdit({
                          ...userEdit,
                          email: e.target.value
                        })
                      }
                    />
                  </label>

                  <label>
                    Nueva contraseña (opcional; mínimo 12 caracteres)
                    <div className="password-field">
                      <input
                        type={
                          showEditPassword
                            ? 'text'
                            : 'password'
                        }
                        autoComplete="new-password"
                        minLength={12}
                        maxLength={200}
                        placeholder="Dejar vacío para no cambiar"
                        value={userEdit.password}
                        onChange={e =>
                          setUserEdit({
                            ...userEdit,
                            password: e.target.value
                          })
                        }
                      />

                      <button
                        className="password-toggle"
                        type="button"
                        aria-label={
                          showEditPassword
                            ? 'Ocultar contraseña'
                            : 'Mostrar contraseña'
                        }
                        aria-pressed={showEditPassword}
                        onClick={() =>
                          setShowEditPassword(v => !v)
                        }
                      >
                        <Eye off={showEditPassword} />
                      </button>
                    </div>
                  </label>

                  <div className="form-actions">
                    <button
                      className="primary"
                      disabled={busy}
                    >
                      Guardar cambios
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setEditingUser(null);
                        setUserEdit({
                          name: '',
                          email: '',
                          password: ''
                        });
                        setShowEditPassword(false);
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>

                {error && (
                  <p className="modal-alert">
                    {error}
                  </p>
                )}
              </Modal>
            )}

            <section className="panel">
              <h2>Usuarios registrados</h2>

              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Correo</th>
                      <th>Rol</th>
                      <th>Estado</th>
                      <th>Acción</th>
                    </tr>
                  </thead>

                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td>{u.name}</td>
                        <td>{u.email}</td>

                        <td>
                          {u.role === 'admin'
                            ? 'Admin'
                            : 'Vendedor'}
                        </td>

                        <td>
                          {u.is_active
                            ? 'Activo'
                            : 'Inactivo'}
                        </td>

                        <td>
                          {(u.role === 'seller' || u.id === user.id) && (
                            <div className="row-actions">
                              <button
                                className="link"
                                disabled={busy}
                                onClick={() => u.role === 'admin' ? (setProfileDraft({name:user.name,email:user.email,currentPassword:'',password:''}),setProfileModal(true),setError('')) : startEditSeller(u)}
                              >
                                Editar
                              </button>

                              {u.role === 'seller' && <button
                                className="link"
                                disabled={busy}
                                onClick={() => {
                                  setStatusTarget(u);
                                  setError('');
                                }}
                              >
                                {u.is_active
                                  ? 'Desactivar'
                                  : 'Activar'}
                              </button>}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {statusTarget && (
              <Modal
                title={
                  statusTarget.is_active
                    ? '¿Desactivar vendedor?'
                    : '¿Activar vendedor?'
                }
                subtitle={
                  statusTarget.is_active
                    ? `¿Estás seguro de desactivar a ${statusTarget.name}? No podrá entrar al sistema.`
                    : `¿Estás seguro de activar a ${statusTarget.name}? Podrá volver a iniciar sesión.`
                }
                busy={busy}
                close={() => {
                  setStatusTarget(null);
                  setError('');
                }}
              >
                <div className="confirm-actions">
                  <button
                    className="plain-button"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setStatusTarget(null)
                    }
                  >
                    Cancelar
                  </button>

                  <button
                    type="button"
                    disabled={busy}
                    className={
                      statusTarget.is_active
                        ? 'danger-button'
                        : 'primary'
                    }
                    onClick={() =>
                      void changeStatus(
                        statusTarget.id,
                        !statusTarget.is_active
                      )
                    }
                  >
                    {statusTarget.is_active
                      ? 'Sí, desactivar'
                      : 'Sí, activar'}
                  </button>
                </div>

                {error && (
                  <p className="modal-alert">
                    {error}
                  </p>
                )}
              </Modal>
            )}
          </>
        )}

        <footer className="footer">
          Toallas Techi
        </footer>
      </main>
    </div>
  );
}
