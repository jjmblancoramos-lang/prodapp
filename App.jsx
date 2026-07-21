import React, { useState, useEffect, useCallback, useMemo } from "react";

/* ---------- constantes de dominio ---------- */

const CATEGORIAS = {
  "Hijos": { stripe: "#5B7F6A", tag: "#EDF2EE" },
  "Comunidad de Vecinos": { stripe: "#5C7A94", tag: "#EBF0F4" },
  "Personal": { stripe: "#9C7A54", tag: "#F3EDE4" },
};

const PRIORIDADES = {
  "Alto": "#A8503D",
  "Medio": "#D3A64B",
  "Bajo": "#96A88F",
};

const ESTADOS = [
  { key: "hecho", label: "Hecho" },
  { key: "en_curso", label: "En curso" },
  { key: "bloqueado", label: "Bloqueado" },
  { key: "backlog", label: "Backlog" },
];

const STORAGE_KEY = "gestor-tareas:tasks";
const uid = () => Math.random().toString(36).slice(2, 10);

const todayISO = () => new Date().toISOString().slice(0, 10);

const emptyTask = () => ({
  id: uid(),
  titulo: "",
  categoria: "Hijos",
  prioridad: "Medio",
  estado: "backlog",
  inicio: todayISO(),
  fin: "",
  motivoBloqueo: "",
  comentarios: "",
});

const SEMILLA = [
  { ...emptyTask(), titulo: "Renovar seguro de la comunidad", categoria: "Comunidad de Vecinos", prioridad: "Alto", estado: "en_curso", inicio: todayISO(), fin: "" , comentarios: "Pedir 3 presupuestos antes de la junta." },
  { ...emptyTask(), titulo: "Reunión tutora del cole", categoria: "Hijos", prioridad: "Medio", estado: "backlog", inicio: todayISO(), fin: "" },
  { ...emptyTask(), titulo: "Convocar junta de propietarios", categoria: "Comunidad de Vecinos", prioridad: "Alto", estado: "bloqueado", inicio: todayISO(), fin: "", motivoBloqueo: "Falta confirmar sala disponible." },
];

/* ---------- utilidades de fecha ---------- */

function fmt(d) {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}/${m}`;
}

function inRange(iso, start, end) {
  if (!start) return false;
  const e = end || start;
  return iso >= start && iso <= e;
}

function monthMatrix(year, month) {
  // month: 0-indexed
  const first = new Date(year, month, 1);
  const startDow = (first.getDay() + 6) % 7; // lunes=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const DOW = ["L","M","X","J","V","S","D"];

/* ---------- almacenamiento ---------- */

function useTasks() {
  const [tasks, setTasks] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      setTasks(raw ? JSON.parse(raw) : SEMILLA);
    } catch (e) {
      setTasks(SEMILLA);
    }
    setStatus("ready");
  }, []);

  const persist = useCallback((next) => {
    setTasks(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      // best-effort; se mantiene en memoria aunque falle el guardado
    }
  }, []);

  return { tasks: tasks || [], status, persist };
}

/* ---------- componentes pequeños ---------- */

function CornerFold({ color }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 0,
        height: 0,
        borderStyle: "solid",
        borderWidth: "0 22px 22px 0",
        borderColor: `transparent ${color} transparent transparent`,
        borderTopRightRadius: 6,
      }}
    />
  );
}

function TaskCard({ task, onOpen }) {
  const cat = CATEGORIAS[task.categoria] || CATEGORIAS["Personal"];
  return (
    <button
      onClick={() => onOpen(task)}
      style={{
        position: "relative",
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "#FFFEFB",
        border: "1px solid #E4DFD3",
        borderLeft: `5px solid ${cat.stripe}`,
        borderRadius: 8,
        padding: "12px 26px 12px 12px",
        marginBottom: 10,
        boxShadow: "0 1px 2px rgba(43,42,38,0.06)",
        cursor: "pointer",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <CornerFold color={PRIORIDADES[task.prioridad]} />
      <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 15.5, fontWeight: 600, color: "#2B2A26", lineHeight: 1.3, marginBottom: 6 }}>
        {task.titulo || "(sin título)"}
      </div>
      <div style={{ fontSize: 11.5, color: "#7A756A", fontFamily: "'IBM Plex Mono', monospace", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={{ background: cat.tag, padding: "1px 6px", borderRadius: 4 }}>{task.categoria}</span>
        {task.inicio && <span>{fmt(task.inicio)}{task.fin ? ` → ${fmt(task.fin)}` : ""}</span>}
      </div>
      {task.estado === "bloqueado" && task.motivoBloqueo && (
        <div style={{ marginTop: 6, fontSize: 12, color: "#A8503D" }}>⛔ {task.motivoBloqueo}</div>
      )}
    </button>
  );
}

function TaskModal({ task, onSave, onDelete, onClose }) {
  const [form, setForm] = useState(task);
  useEffect(() => setForm(task), [task]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(43,42,38,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#FBF9F4", width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, fontFamily: "'Inter', system-ui, sans-serif" }}
      >
        <div style={{ width: 40, height: 4, background: "#DDD6C7", borderRadius: 2, margin: "0 auto 16px" }} />

        <label style={lbl}>Título</label>
        <input style={inp} value={form.titulo} onChange={set("titulo")} placeholder="¿Qué hay que hacer?" />

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Categoría</label>
            <select style={inp} value={form.categoria} onChange={set("categoria")}>
              {Object.keys(CATEGORIAS).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Prioridad</label>
            <select style={inp} value={form.prioridad} onChange={set("prioridad")}>
              {Object.keys(PRIORIDADES).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <label style={lbl}>Estado</label>
        <select style={inp} value={form.estado} onChange={set("estado")}>
          {ESTADOS.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
        </select>

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Fecha inicio</label>
            <input type="date" style={inp} value={form.inicio || ""} onChange={set("inicio")} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Fecha fin</label>
            <input type="date" style={inp} value={form.fin || ""} onChange={set("fin")} />
          </div>
        </div>

        {form.estado === "bloqueado" && (
          <>
            <label style={lbl}>Motivo del bloqueo</label>
            <textarea style={{ ...inp, minHeight: 50 }} value={form.motivoBloqueo || ""} onChange={set("motivoBloqueo")} />
          </>
        )}

        <label style={lbl}>Comentarios</label>
        <textarea style={{ ...inp, minHeight: 60 }} value={form.comentarios || ""} onChange={set("comentarios")} />

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={btnGhost}>Cancelar</button>
          {onDelete && <button onClick={() => onDelete(form.id)} style={btnDanger}>Eliminar</button>}
          <button onClick={() => onSave(form)} style={btnPrimary}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

const lbl = { display: "block", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#8A8577", marginTop: 12, marginBottom: 4, fontFamily: "'IBM Plex Mono', monospace" };
const inp = { width: "100%", padding: "9px 10px", borderRadius: 7, border: "1px solid #DDD6C7", background: "#FFFEFB", fontSize: 14.5, fontFamily: "'Inter', system-ui, sans-serif", boxSizing: "border-box", color: "#2B2A26" };
const btnBase = { flex: 1, padding: "11px 0", borderRadius: 8, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" };
const btnPrimary = { ...btnBase, background: "#2B2A26", color: "#FBF9F4" };
const btnGhost = { ...btnBase, background: "transparent", color: "#8A8577", border: "1px solid #DDD6C7" };
const btnDanger = { ...btnBase, background: "#FBEAE6", color: "#A8503D" };

/* ---------- vistas ---------- */

function Tablero({ tasks, onOpen }) {
  return (
    <div style={{ display: "flex", gap: 14, overflowX: "auto", padding: "4px 16px 16px", WebkitOverflowScrolling: "touch" }}>
      {ESTADOS.map((estado) => {
        const items = tasks.filter((t) => t.estado === estado.key);
        return (
          <div key={estado.key} style={{ minWidth: 240, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", color: "#2B2A26", fontWeight: 600 }}>
                {estado.label}
              </div>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#8A8577", background: "#EDEAE1", padding: "1px 7px", borderRadius: 10 }}>
                {items.length}
              </span>
            </div>
            {items.length === 0 && (
              <div style={{ fontSize: 12.5, color: "#B5AF9E", fontStyle: "italic", padding: "8px 2px" }}>Sin tareas</div>
            )}
            {items.map((t) => <TaskCard key={t.id} task={t} onOpen={onOpen} />)}
          </div>
        );
      })}
    </div>
  );
}

function Calendario({ tasks, onOpen }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState(todayISO());

  const cells = useMemo(() => monthMatrix(year, month), [year, month]);

  const tasksForDay = (day) => {
    if (!day) return [];
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return tasks.filter((t) => inRange(iso, t.inicio, t.fin));
  };

  const changeMonth = (delta) => {
    let m = month + delta, y = year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setMonth(m); setYear(y);
  };

  const selectedTasks = tasks.filter((t) => inRange(selected, t.inicio, t.fin));

  return (
    <div style={{ padding: "4px 16px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button onClick={() => changeMonth(-1)} style={navBtn}>‹</button>
        <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 600, textTransform: "capitalize" }}>
          {MESES[month]} {year}
        </div>
        <button onClick={() => changeMonth(1)} style={navBtn}>›</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 4 }}>
        {DOW.map((d) => (
          <div key={d} style={{ textAlign: "center", fontSize: 10.5, color: "#B5AF9E", fontFamily: "'IBM Plex Mono', monospace" }}>{d}</div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayTasks = tasksForDay(day);
          const isSelected = iso === selected;
          const isToday = iso === todayISO();
          return (
            <button
              key={i}
              onClick={() => setSelected(iso)}
              style={{
                aspectRatio: "1",
                borderRadius: 8,
                border: isToday ? "1.5px solid #2B2A26" : "1px solid #E4DFD3",
                background: isSelected ? "#2B2A26" : "#FFFEFB",
                color: isSelected ? "#FBF9F4" : "#2B2A26",
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 12.5,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                cursor: "pointer",
                padding: 0,
              }}
            >
              {day}
              <div style={{ display: "flex", gap: 2 }}>
                {dayTasks.slice(0, 3).map((t) => (
                  <span key={t.id} style={{ width: 4, height: 4, borderRadius: 2, background: isSelected ? "#FBF9F4" : CATEGORIAS[t.categoria]?.stripe || "#999" }} />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "#8A8577", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 8 }}>
          {selected.split("-").reverse().join("/")}
        </div>
        {selectedTasks.length === 0 && <div style={{ fontSize: 13, color: "#B5AF9E", fontStyle: "italic" }}>Nada agendado este día</div>}
        {selectedTasks.map((t) => <TaskCard key={t.id} task={t} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

const navBtn = { width: 34, height: 34, borderRadius: 8, border: "1px solid #E4DFD3", background: "#FFFEFB", fontSize: 18, cursor: "pointer", color: "#2B2A26" };

function Lista({ tasks, onOpen }) {
  const [filtroCategoria, setFiltroCategoria] = useState("Todas");
  const [filtroEstado, setFiltroEstado] = useState("Todos");

  const filtered = tasks.filter((t) =>
    (filtroCategoria === "Todas" || t.categoria === filtroCategoria) &&
    (filtroEstado === "Todos" || t.estado === filtroEstado)
  );

  return (
    <div style={{ padding: "4px 16px 16px" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <select style={{ ...inp, flex: 1 }} value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
          <option>Todas</option>
          {Object.keys(CATEGORIAS).map((c) => <option key={c}>{c}</option>)}
        </select>
        <select style={{ ...inp, flex: 1 }} value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
          <option value="Todos">Todos</option>
          {ESTADOS.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
        </select>
      </div>
      {filtered.length === 0 && <div style={{ fontSize: 13, color: "#B5AF9E", fontStyle: "italic" }}>Sin resultados</div>}
      {filtered.map((t) => <TaskCard key={t.id} task={t} onOpen={onOpen} />)}
    </div>
  );
}

/* ---------- app ---------- */

export default function App() {
  const { tasks, status, persist } = useTasks();
  const [tab, setTab] = useState("tablero");
  const [modalTask, setModalTask] = useState(null);
  const [isNew, setIsNew] = useState(false);

  const openTask = (t) => { setModalTask(t); setIsNew(false); };
  const openNew = () => { setModalTask(emptyTask()); setIsNew(true); };

  const saveTask = (form) => {
    const exists = tasks.some((t) => t.id === form.id);
    const next = exists ? tasks.map((t) => (t.id === form.id ? form : t)) : [...tasks, form];
    persist(next);
    setModalTask(null);
  };

  const deleteTask = (id) => {
    persist(tasks.filter((t) => t.id !== id));
    setModalTask(null);
  };

  if (status === "loading") {
    return <div style={{ padding: 40, textAlign: "center", color: "#8A8577", fontFamily: "'Inter', sans-serif" }}>Cargando…</div>;
  }

  const TABS = [
    { key: "tablero", label: "Tablero" },
    { key: "calendario", label: "Calendario" },
    { key: "tareas", label: "Tareas" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#F6F3EC", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { -webkit-tap-highlight-color: transparent; }
        button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid #5C7A94; outline-offset: 1px; }
      `}</style>

      <div style={{ padding: "20px 16px 12px", position: "sticky", top: 0, background: "#F6F3EC", zIndex: 10, borderBottom: "1px solid #E4DFD3" }}>
        <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 700, color: "#2B2A26", marginBottom: 12 }}>
          Casa &amp; Comunidad
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: "7px 14px",
                borderRadius: 20,
                border: "none",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                background: tab === t.key ? "#2B2A26" : "#EDEAE1",
                color: tab === t.key ? "#FBF9F4" : "#6B665A",
                fontFamily: "'Inter', system-ui, sans-serif",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "tablero" && <Tablero tasks={tasks} onOpen={openTask} />}
      {tab === "calendario" && <Calendario tasks={tasks} onOpen={openTask} />}
      {tab === "tareas" && <Lista tasks={tasks} onOpen={openTask} />}

      <button
        onClick={openNew}
        aria-label="Añadir tarea"
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          width: 54,
          height: 54,
          borderRadius: 27,
          background: "#2B2A26",
          color: "#FBF9F4",
          border: "none",
          fontSize: 26,
          lineHeight: "54px",
          boxShadow: "0 4px 12px rgba(43,42,38,0.3)",
          cursor: "pointer",
        }}
      >
        +
      </button>

      {modalTask && (
        <TaskModal
          task={modalTask}
          onSave={saveTask}
          onDelete={isNew ? null : deleteTask}
          onClose={() => setModalTask(null)}
        />
      )}
    </div>
  );
}
