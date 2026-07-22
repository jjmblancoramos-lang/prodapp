import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient";
import comidasData from "./comidas-data.json";
import entrenoData from "./entreno-data.json";
import recetasData from "./recetas-data.json";
import compraData from "./compra-data.json";
import entrenoDetalleData from "./entreno-detalle-data.json";

/* ---------- constantes de dominio ---------- */

const CATEGORIAS = {
  "Hijos": { stripe: "#5B7F6A", tag: "#EDF2EE" },
  "Comunidad de Vecinos": { stripe: "#5C7A94", tag: "#EBF0F4" },
  "Personal": { stripe: "#9C7A54", tag: "#F3EDE4" },
};
const PRIORIDADES = { "Alto": "#A8503D", "Medio": "#D3A64B", "Bajo": "#96A88F" };
const ESTADOS = [
  { key: "hecho", label: "Hecho" }, { key: "en_curso", label: "En curso" },
  { key: "bloqueado", label: "Bloqueado" }, { key: "backlog", label: "Backlog" },
];
const SLOTS_COMIDA = [
  { key: "desayuno", label: "Desayuno" }, { key: "almuerzo", label: "Almuerzo" },
  { key: "comida", label: "Comida" }, { key: "merienda", label: "Merienda" }, { key: "cena", label: "Cena" },
];
const SLOTS_CON_RECETA = ["comida", "cena"];

const TIPOS_EVENTO_ESPECIAL = {
  viaje: { color: "#9B968A", label: "Viaje" },
  homeexchange: { color: "#8B6FA8", label: "HomeExchange" },
  vacaciones_ninos: { color: "#7FA66B", label: "Vacaciones de los niños" },
  compromiso: { color: "#B5484A", label: "Cita/Reunión/Evento" },
};

const uid = () => Math.random().toString(36).slice(2, 10);
const todayISO = () => new Date().toISOString().slice(0, 10);
const emptyTask = () => ({ id: uid(), titulo: "", categoria: "Hijos", prioridad: "Medio", estado: "backlog", inicio: todayISO(), fin: "", motivoBloqueo: "", comentarios: "" });
const emptyReceta = () => ({ titulo: "", nota: "", ingredientes: [], pasos: [] });

/* ---------- utilidades ---------- */

function fmtCorto(d) { if (!d) return ""; const [y, m, day] = d.split("-"); return `${day}/${m}`; }
function fmtLargo(iso) { if (!iso) return ""; const d = new Date(iso + "T00:00:00"); return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }
function addDays(iso, delta) { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + delta); return d.toISOString().slice(0, 10); }
function inRange(iso, start, end) { if (!start) return false; const e = end || start; return iso >= start && iso <= e; }
function monthMatrix(year, month) {
  const first = new Date(year, month, 1);
  const startDow = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const DOW = ["L","M","X","J","V","S","D"];

function shareWhatsApp(text) {
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

/* ---------- eventos especiales (viaje / HomeExchange / vacaciones niños / compromiso) ---------- */

function eventoCubreDia(evento, iso) {
  const fin = addDays(evento.inicio, evento.dias - 1);
  return iso >= evento.inicio && iso <= fin;
}
function eventosParaDia(eventos, iso) {
  return eventos.filter((e) => eventoCubreDia(e, iso));
}
function fondoEventosDia(eventos, iso) {
  const activos = eventosParaDia(eventos, iso);
  const coloresUnicos = [...new Set(activos.map((e) => TIPOS_EVENTO_ESPECIAL[e.tipo].color))];
  if (coloresUnicos.length === 0) return null;
  if (coloresUnicos.length === 1) return coloresUnicos[0];
  const step = 100 / coloresUnicos.length;
  const stops = coloresUnicos.map((c, i) => `${c} ${i * step}%, ${c} ${(i + 1) * step}%`).join(", ");
  return `linear-gradient(135deg, ${stops})`;
}

/* ---------- ayudas para restar/sumar ingredientes de la lista de la compra ---------- */

function parseCantidadStr(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^([\d.,]+)\s*(.*)$/);
  if (!m) return null;
  const num = parseFloat(m[1].replace(",", "."));
  if (isNaN(num)) return null;
  return { num, unidad: m[2].trim().toLowerCase() };
}
function convertirUnidad(num, unidad) {
  const u = (unidad || "").toLowerCase();
  if (u === "kg") return { num: num * 1000, unidad: "g" };
  if (u === "l") return { num: num * 1000, unidad: "ml" };
  return { num, unidad: u };
}
function formatCantidadStr(num, unidad) {
  const rounded = Math.round(num * 100) / 100;
  return unidad ? `${rounded} ${unidad}` : `${rounded}`;
}

/* ---------- importador de .ics (Google Calendar / cualquier calendario estándar) ---------- */

function unescapeICS(t) {
  return (t || "").replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}
function parseICSDateTime(v) {
  const clean = (v || "").replace(/[^0-9TZ]/g, "");
  const datePart = clean.slice(0, 8);
  if (datePart.length < 8) return { iso: null, hora: null };
  const iso = `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}`;
  let hora = null;
  const tIdx = clean.indexOf("T");
  if (tIdx !== -1) {
    const tp = clean.slice(tIdx + 1, tIdx + 5);
    if (tp.length === 4) hora = `${tp.slice(0, 2)}:${tp.slice(2, 4)}`;
  }
  return { iso, hora };
}
function parseICS(text) {
  const rawLines = text.split(/\r\n|\n|\r/);
  const lines = [];
  rawLines.forEach((line) => {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  });
  const events = [];
  let cur = null;
  lines.forEach((line) => {
    if (line.startsWith("BEGIN:VEVENT")) cur = {};
    else if (line.startsWith("END:VEVENT")) { if (cur) events.push(cur); cur = null; }
    else if (cur) {
      const idx = line.indexOf(":");
      if (idx === -1) return;
      const key = line.slice(0, idx).split(";")[0];
      cur[key] = line.slice(idx + 1);
    }
  });
  return events.map((e) => {
    const inicio = parseICSDateTime(e.DTSTART);
    const fin = parseICSDateTime(e.DTEND);
    const horaTxt = inicio.hora ? `Hora: ${inicio.hora}${fin.hora ? ` – ${fin.hora}` : ""}` : "";
    const partesComentario = [horaTxt, e.LOCATION ? `Lugar: ${unescapeICS(e.LOCATION)}` : "", unescapeICS(e.DESCRIPTION)].filter(Boolean);
    return {
      gcalUid: e.UID || null,
      titulo: unescapeICS(e.SUMMARY) || "(sin título)",
      inicio: inicio.iso,
      fin: fin.iso || inicio.iso,
      comentarios: partesComentario.join("\n"),
    };
  }).filter((e) => e.inicio);
}

/* ---------- importador de Excel (planificación / recetario / compra / entrenamiento) ---------- */

function excelDateToISO(value) {
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const m = String(value || "").trim().match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
function parseFechaLarga(texto) {
  const meses = { enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,octubre:10,noviembre:11,diciembre:12 };
  const m = (texto || "").toLowerCase().match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/);
  if (!m) return null;
  const mes = meses[m[2]];
  if (!mes) return null;
  return `${m[3]}-${String(mes).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
}
function sheetToRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
}

function parsePlanificacionSemanal(workbook) {
  const resultado = {};
  workbook.SheetNames.forEach((nombreHoja) => {
    const rows = sheetToRows(workbook.Sheets[nombreHoja]);
    const headerRowIdx = rows.findIndex((r) => r.some((c) => excelDateToISO(c)));
    if (headerRowIdx === -1) return;
    const columnasFecha = {};
    rows[headerRowIdx].forEach((cell, colIdx) => { const iso = excelDateToISO(cell); if (iso) columnasFecha[colIdx] = iso; });
    const mapaSlot = { desayuno: "desayuno", almuerzo: "almuerzo", comida: "comida", merienda: "merienda", cena: "cena" };
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const slot = mapaSlot[String(rows[r][0] || "").trim().toLowerCase()];
      if (!slot) continue;
      Object.entries(columnasFecha).forEach(([colIdx, iso]) => {
        const texto = String(rows[r][colIdx] || "").trim();
        if (!texto) return;
        if (!resultado[iso]) resultado[iso] = {};
        resultado[iso][slot] = texto;
      });
    }
  });
  return resultado;
}

function parseRecetarioDiario(workbook) {
  const resultado = {};
  workbook.SheetNames.forEach((nombreHoja) => {
    const rows = sheetToRows(workbook.Sheets[nombreHoja]);
    const iso = parseFechaLarga(String(rows[0]?.[0] || "")) || excelDateToISO(nombreHoja);
    if (!iso) return;
    const bloques = { comida: null, cena: null };
    let bloqueActual = null, modo = null;
    for (let r = 0; r < rows.length; r++) {
      const a = String(rows[r][0] || "").trim();
      if (/^COMIDA\s*—/i.test(a)) { bloqueActual = "comida"; bloques.comida = { titulo: "", nota: "", ingredientes: [], pasos: [] }; modo = null; continue; }
      if (/^CENA\s*—/i.test(a)) { bloqueActual = "cena"; bloques.cena = { titulo: "", nota: "", ingredientes: [], pasos: [] }; modo = null; continue; }
      if (!bloqueActual) continue;
      if (/^INGREDIENTES/i.test(a)) { modo = "ingredientes-header"; continue; }
      if (/^ELABORACI[ÓO]N/i.test(a)) { modo = "elaboracion"; continue; }
      if (modo === "ingredientes-header") { if (a.toLowerCase() === "ingrediente") modo = "ingredientes"; continue; }
      if (modo === "ingredientes") {
        if (!a) { modo = null; continue; }
        bloques[bloqueActual].ingredientes.push({ ingrediente: a, cantidad: String(rows[r][1] ?? ""), unidad: String(rows[r][2] ?? "") });
        continue;
      }
      if (modo === "elaboracion") { if (a) bloques[bloqueActual].pasos.push(a.replace(/^\d+\.\s*/, "")); continue; }
      if (!bloques[bloqueActual].titulo && a) { bloques[bloqueActual].titulo = a; continue; }
      if (!bloques[bloqueActual].nota && a) { bloques[bloqueActual].nota = a; continue; }
    }
    resultado[iso] = bloques;
  });
  return resultado;
}

function parseListaCompraSemanal(workbook) {
  const resultado = {};
  workbook.SheetNames.forEach((nombreHoja) => {
    const rows = sheetToRows(workbook.Sheets[nombreHoja]);
    const titulo = String(rows[0]?.[0] || "");
    const fechas = titulo.match(/(\d{1,2}\/\d{1,2}\/\d{4})/g) || [];
    const inicio = fechas[0] ? excelDateToISO(fechas[0]) : null;
    const fin = fechas[1] ? excelDateToISO(fechas[1]) : null;
    if (!inicio) return;
    const categorias = {};
    let catActual = null, enHeader = false;
    for (let r = 1; r < rows.length; r++) {
      const a = String(rows[r][0] || "").trim();
      const b = String(rows[r][1] || "").trim();
      if (!a && !b) { catActual = null; enHeader = false; continue; }
      if (a && !b && a === a.toUpperCase() && a.length > 2) { catActual = a; categorias[catActual] = []; enHeader = true; continue; }
      if (enHeader && a.toLowerCase() === "ingrediente") { enHeader = false; continue; }
      if (catActual && a) categorias[catActual].push({ ingrediente: a, cantidad: b, gramos: rows[r][2] || null });
    }
    resultado[inicio] = { inicio, fin, categorias };
  });
  return resultado;
}

function parsePlanEntrenamiento(workbook) {
  const resultadoEntreno = {}, resultadoDetalle = {};
  workbook.SheetNames.forEach((nombreHoja) => {
    const rows = sheetToRows(workbook.Sheets[nombreHoja]);
    const cab = String(rows[0]?.[0] || "");
    const fechaMatch = cab.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (!fechaMatch) return;
    const iso = excelDateToISO(fechaMatch[1]);
    const semanaMatch = cab.match(/Semana\s+(\d+)/i);
    const infoFase = String(rows[1]?.[0] || "");
    const faseMatch = infoFase.match(/Fase:\s*([^|]+)/i);
    const tipoMatch = infoFase.match(/\|\s*([^|—]+)/);
    resultadoEntreno[iso] = { semana: semanaMatch ? semanaMatch[1] : "", fase: faseMatch ? faseMatch[1].trim() : "", tipo: tipoMatch ? tipoMatch[1].trim() : "", notas: "", hecho: false };
    const headerIdx = rows.findIndex((r) => String(r[0]).trim().toLowerCase() === "bloque");
    if (headerIdx === -1) return;
    const filas = [];
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const bloque = String(rows[r][0] || "").trim();
      if (!bloque || /^TOTAL/i.test(bloque)) break;
      filas.push({ "Bloque": bloque, "Ejercicio": String(rows[r][1] || ""), "Series": String(rows[r][2] || ""), "Repeticiones": String(rows[r][3] || ""), "Tempo": String(rows[r][4] || ""), "Descanso": String(rows[r][5] || ""), "Duración (min)": String(rows[r][6] || ""), "Notas": String(rows[r][8] || "") });
    }
    resultadoDetalle[iso] = { columnas: ["Bloque","Ejercicio","Series","Repeticiones","Tempo","Descanso","Duración (min)","Notas"], filas };
  });
  return { entreno: resultadoEntreno, detalle: resultadoDetalle };
}

/* ---------- fusión de datos importados: solo rellenar huecos, nunca sobrescribir ---------- */

function fusionarComidasVacias(actual, nuevo) {
  const r = { ...actual };
  Object.entries(nuevo).forEach(([iso, dia]) => {
    const ex = { ...(r[iso] || {}) };
    Object.entries(dia).forEach(([slot, texto]) => { if (!ex[slot]) ex[slot] = texto; });
    r[iso] = ex;
  });
  return r;
}
function fusionarRecetasVacias(actual, nuevo) {
  const r = { ...actual };
  Object.entries(nuevo).forEach(([iso, bloques]) => {
    const ex = { ...(r[iso] || {}) };
    ["comida", "cena"].forEach((slot) => { if (bloques[slot] && (!ex[slot] || !ex[slot].titulo)) ex[slot] = bloques[slot]; });
    r[iso] = ex;
  });
  return r;
}
function fusionarEntrenoVacio(actual, nuevo) {
  const r = { ...actual };
  Object.entries(nuevo).forEach(([iso, dia]) => { if (!r[iso] || !r[iso].tipo) r[iso] = dia; });
  return r;
}
function fusionarDetalleVacio(actual, nuevo) {
  const r = { ...actual };
  Object.entries(nuevo).forEach(([iso, det]) => { if (!r[iso] || !r[iso].filas?.length) r[iso] = det; });
  return r;
}
function fusionarCompraSoloFaltante(actual, nuevo) {
  const r = { ...actual };
  Object.entries(nuevo).forEach(([weekKey, semanaNueva]) => {
    const ex = r[weekKey];
    if (!ex) { r[weekKey] = semanaNueva; return; }
    const nuevasCategorias = {};
    Object.entries(ex.categorias).forEach(([cat, items]) => { nuevasCategorias[cat] = [...items]; });
    Object.entries(semanaNueva.categorias).forEach(([cat, itemsNuevos]) => {
      if (!nuevasCategorias[cat]) nuevasCategorias[cat] = [];
      itemsNuevos.forEach((itemNuevo) => {
        const existente = nuevasCategorias[cat].find((it) => it.ingrediente.toLowerCase() === itemNuevo.ingrediente.toLowerCase());
        if (!existente) { nuevasCategorias[cat].push(itemNuevo); return; }
        const pActual = parseCantidadStr(existente.cantidad), pNuevo = parseCantidadStr(itemNuevo.cantidad);
        if (!pActual || !pNuevo) return;
        const bActual = convertirUnidad(pActual.num, pActual.unidad), bNuevo = convertirUnidad(pNuevo.num, pNuevo.unidad);
        if (bActual.unidad === bNuevo.unidad && bNuevo.num > bActual.num) existente.cantidad = itemNuevo.cantidad;
      });
    });
    r[weekKey] = { ...ex, categorias: nuevasCategorias };
  });
  return r;
}

/* ---------- almacenamiento genérico (Supabase, sincronizado en tiempo real) ---------- */

function useStore(key, seed) {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let activo = true;
    (async () => {
      const { data: row } = await supabase.from("app_data").select("value").eq("key", key).maybeSingle();
      if (!activo) return;
      if (row) setData(row.value);
      else {
        setData(seed);
        await supabase.from("app_data").upsert({ key, value: seed });
      }
      setLoaded(true);
    })();

    const canal = supabase
      .channel(`app_data_${key}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "app_data", filter: `key=eq.${key}` }, (payload) => {
        if (payload.new && payload.new.value) setData(payload.new.value);
      })
      .subscribe();

    return () => { activo = false; supabase.removeChannel(canal); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const persist = useCallback((next) => {
    setData(next);
    supabase.from("app_data").upsert({ key, value: next, updated_at: new Date().toISOString() });
  }, [key]);

  return [loaded ? (data ?? seed) : seed, persist];
}

/* ---------- estilos compartidos ---------- */

const lbl = { display: "block", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#8A8577", marginTop: 12, marginBottom: 4, fontFamily: "'IBM Plex Mono', monospace" };
const inp = { width: "100%", padding: "9px 10px", borderRadius: 7, border: "1px solid #DDD6C7", background: "#FFFEFB", fontSize: 14.5, fontFamily: "'Inter', system-ui, sans-serif", boxSizing: "border-box", color: "#2B2A26" };
const inpSm = { ...inp, padding: "7px 8px", fontSize: 13.5 };
const btnBase = { flex: 1, padding: "11px 0", borderRadius: 8, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" };
const btnPrimary = { ...btnBase, background: "#2B2A26", color: "#FBF9F4" };
const btnGhost = { ...btnBase, background: "transparent", color: "#8A8577", border: "1px solid #DDD6C7" };
const btnDanger = { ...btnBase, background: "#FBEAE6", color: "#A8503D" };
const navBtn = { width: 34, height: 34, borderRadius: 8, border: "1px solid #E4DFD3", background: "#FFFEFB", fontSize: 18, cursor: "pointer", color: "#2B2A26", flexShrink: 0 };
const sectionTitle = { fontFamily: "'Fraunces', Georgia, serif", fontSize: 14.5, fontWeight: 600, color: "#2B2A26", marginTop: 20, marginBottom: 10 };
const removeBtn = { width: 26, height: 26, borderRadius: 6, border: "1px solid #E4DFD3", background: "#FFFEFB", color: "#A8503D", fontSize: 14, cursor: "pointer", flexShrink: 0 };
const addLink = { background: "none", border: "none", color: "#5C7A94", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "6px 0", fontFamily: "'Inter', system-ui, sans-serif" };

function ShareButton({ getText, label }) {
  return (
    <button
      onClick={() => shareWhatsApp(getText())}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", padding: "11px 0", borderRadius: 8, border: "1px solid #BFE3CB", background: "#F0FAF3", color: "#1F7A44", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif", marginTop: 14 }}
    >
      <span style={{ fontSize: 15 }}>↗</span> {label || "Compartir por WhatsApp"}
    </button>
  );
}

/* ---------- tareas ---------- */

function CornerFold({ color }) {
  return <div style={{ position: "absolute", top: 0, right: 0, width: 0, height: 0, borderStyle: "solid", borderWidth: "0 22px 22px 0", borderColor: `transparent ${color} transparent transparent`, borderTopRightRadius: 6 }} />;
}
function TaskCard({ task, onOpen }) {
  const cat = CATEGORIAS[task.categoria] || CATEGORIAS["Personal"];
  return (
    <button onClick={() => onOpen(task)} style={{ position: "relative", display: "block", width: "100%", textAlign: "left", background: "#FFFEFB", border: "1px solid #E4DFD3", borderLeft: `5px solid ${cat.stripe}`, borderRadius: 8, padding: "12px 26px 12px 12px", marginBottom: 10, boxShadow: "0 1px 2px rgba(43,42,38,0.06)", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <CornerFold color={PRIORIDADES[task.prioridad]} />
      <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 15.5, fontWeight: 600, color: "#2B2A26", lineHeight: 1.3, marginBottom: 6 }}>{task.titulo || "(sin título)"}</div>
      <div style={{ fontSize: 11.5, color: "#7A756A", fontFamily: "'IBM Plex Mono', monospace", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={{ background: cat.tag, padding: "1px 6px", borderRadius: 4 }}>{task.categoria}</span>
        {task.inicio && <span>{fmtCorto(task.inicio)}{task.fin ? ` → ${fmtCorto(task.fin)}` : ""}</span>}
      </div>
      {task.estado === "bloqueado" && task.motivoBloqueo && <div style={{ marginTop: 6, fontSize: 12, color: "#A8503D" }}>⛔ {task.motivoBloqueo}</div>}
    </button>
  );
}
function TaskModal({ task, onSave, onDelete, onClose }) {
  const [form, setForm] = useState(task);
  useEffect(() => setForm(task), [task]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(43,42,38,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#FBF9F4", width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ width: 40, height: 4, background: "#DDD6C7", borderRadius: 2, margin: "0 auto 16px" }} />
        <label style={lbl}>Título</label>
        <input style={inp} value={form.titulo} onChange={set("titulo")} placeholder="¿Qué hay que hacer?" />
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><label style={lbl}>Categoría</label><select style={inp} value={form.categoria} onChange={set("categoria")}>{Object.keys(CATEGORIAS).map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          <div style={{ flex: 1 }}><label style={lbl}>Prioridad</label><select style={inp} value={form.prioridad} onChange={set("prioridad")}>{Object.keys(PRIORIDADES).map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
        </div>
        <label style={lbl}>Estado</label>
        <select style={inp} value={form.estado} onChange={set("estado")}>{ESTADOS.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}</select>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><label style={lbl}>Fecha inicio</label><input type="date" style={inp} value={form.inicio || ""} onChange={set("inicio")} /></div>
          <div style={{ flex: 1 }}><label style={lbl}>Fecha fin</label><input type="date" style={inp} value={form.fin || ""} onChange={set("fin")} /></div>
        </div>
        {form.estado === "bloqueado" && (<><label style={lbl}>Motivo del bloqueo</label><textarea style={{ ...inp, minHeight: 50 }} value={form.motivoBloqueo || ""} onChange={set("motivoBloqueo")} /></>)}
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

/* ---------- importar Google Calendar ---------- */

function ImportModal({ onImport, onClose }) {
  const [categoria, setCategoria] = useState("Personal");
  const [estado, setEstado] = useState(null);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setEstado({ procesando: true });
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const eventos = parseICS(reader.result);
        if (!eventos.length) { setEstado({ error: "No se ha encontrado ningún evento en ese archivo." }); return; }
        const { nuevos, actualizados } = onImport(eventos, categoria);
        setEstado({ ok: true, nuevos, actualizados });
      } catch (err) {
        setEstado({ error: "No se ha podido leer el archivo. ¿Es un .ics válido?" });
      }
    };
    reader.readAsText(file);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(43,42,38,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#FBF9F4", width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ width: 40, height: 4, background: "#DDD6C7", borderRadius: 2, margin: "0 auto 16px" }} />
        <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 600, marginBottom: 10 }}>Importar de Google Calendar</div>
        <div style={{ fontSize: 13, color: "#6B665A", lineHeight: 1.5, marginBottom: 14 }}>
          1. En Google Calendar (calendar.google.com), entra en Ajustes del calendario que quieras importar.<br />
          2. Busca "Integrar calendario" y copia la "Dirección secreta en formato iCal".<br />
          3. Pega esa dirección en una pestaña nueva del navegador — se descargará un archivo .ics.<br />
          4. Selecciona ese archivo aquí abajo.
        </div>

        <label style={lbl}>Categoría para los eventos importados</label>
        <select style={inp} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          {Object.keys(CATEGORIAS).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <label style={lbl}>Archivo .ics</label>
        <input type="file" accept=".ics,text/calendar" onChange={handleFile} style={{ ...inp, padding: 8 }} />

        {estado?.procesando && <div style={{ marginTop: 12, fontSize: 13, color: "#8A8577" }}>Procesando…</div>}
        {estado?.error && <div style={{ marginTop: 12, fontSize: 13, color: "#A8503D" }}>{estado.error}</div>}
        {estado?.ok && <div style={{ marginTop: 12, fontSize: 13, color: "#1F7A44" }}>Importados {estado.nuevos} eventos nuevos{estado.actualizados ? ` y actualizados ${estado.actualizados}` : ""}.</div>}

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={btnPrimary}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- importar Excel (planificación / recetario / compra / entrenamiento) ---------- */

function ImportExcelModal({ onImport, onClose }) {
  const [estado, setEstado] = useState(null);
  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setEstado({ procesando: true });
    try {
      for (const file of files) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const nombre = file.name.toLowerCase();
        if (nombre.includes("planificacion")) onImport("comidas", parsePlanificacionSemanal(wb));
        else if (nombre.includes("recetario")) onImport("recetas", parseRecetarioDiario(wb));
        else if (nombre.includes("compra")) onImport("compra", parseListaCompraSemanal(wb));
        else if (nombre.includes("entrenamiento")) { const { entreno, detalle } = parsePlanEntrenamiento(wb); onImport("entreno", entreno); onImport("detalle", detalle); }
      }
      setEstado({ ok: true });
    } catch (err) {
      setEstado({ error: "No se pudo procesar alguno de los archivos. Revisa que el formato coincida con el esperado." });
    }
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(43,42,38,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 55 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#FBF9F4", width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ width: 40, height: 4, background: "#DDD6C7", borderRadius: 2, margin: "0 auto 16px" }} />
        <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 600, marginBottom: 10 }}>Importar planificación desde Excel</div>
        <div style={{ fontSize: 13, color: "#6B665A", lineHeight: 1.5, marginBottom: 14 }}>
          Selecciona uno o varios archivos (Planificación Semanal, Recetario Diario, Lista de la Compra, Plan de Entrenamiento). Solo se rellenan los días/campos vacíos; nada de lo que ya tengas se sobrescribe.
        </div>
        <input type="file" accept=".xlsx" multiple onChange={handleFiles} style={{ ...inp, padding: 8 }} />
        {estado?.procesando && <div style={{ marginTop: 12, fontSize: 13, color: "#8A8577" }}>Procesando…</div>}
        {estado?.error && <div style={{ marginTop: 12, fontSize: 13, color: "#A8503D" }}>{estado.error}</div>}
        {estado?.ok && <div style={{ marginTop: 12, fontSize: 13, color: "#1F7A44" }}>Importación completada.</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}><button onClick={onClose} style={btnPrimary}>Cerrar</button></div>
      </div>
    </div>
  );
}

/* ---------- evento especial (viaje / HomeExchange / vacaciones niños / compromiso) ---------- */

function EventoEspecialModal({ fecha, onSave, onClose }) {
  const [paso, setPaso] = useState("eleccion");
  const [personas, setPersonas] = useState(1);
  const [motivo, setMotivo] = useState("Vacaciones");
  const [dias, setDias] = useState(1);
  const [destino, setDestino] = useState("");
  const [eventoViajePendiente, setEventoViajePendiente] = useState(null);
  const [categoriaCompromiso, setCategoriaCompromiso] = useState("Cita");
  const [descripcionCompromiso, setDescripcionCompromiso] = useState("");
  const [personasCompromiso, setPersonasCompromiso] = useState(1);

  const elegir = (opcion) => {
    if (opcion === "cancelar") { onClose(); return; }
    setPaso(opcion);
  };

  const irAConfirmarComidas = () => {
    setEventoViajePendiente({ id: uid(), tipo: "viaje", inicio: fecha, dias: Number(dias) || 1, personas: Number(personas) || 1, motivo, destino });
    setPaso("confirmarComidas");
  };
  const confirmarComidas = (borrar) => onSave({ ...eventoViajePendiente, borrarComidas: borrar });

  const aceptarHomeExchange = () => onSave({ id: uid(), tipo: "homeexchange", inicio: fecha, dias: Number(dias) || 1 });
  const aceptarVacaciones = () => onSave({ id: uid(), tipo: "vacaciones_ninos", inicio: fecha, dias: Number(dias) || 1 });
  const aceptarCompromiso = () => onSave({ id: uid(), tipo: "compromiso", inicio: fecha, dias: 1, categoriaCompromiso, descripcion: descripcionCompromiso, personas: Number(personasCompromiso) || 1 });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(43,42,38,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 60 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#FBF9F4", width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ width: 40, height: 4, background: "#DDD6C7", borderRadius: 2, margin: "0 auto 16px" }} />

        {paso === "eleccion" && (
          <>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, fontWeight: 600, marginBottom: 14, color: "#2B2A26" }}>
              ¿Este día os vais de casa o viene alguien a casa con HomeExchange? ¿Son vacaciones para los niños?
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button style={btnPrimary} onClick={() => elegir("viaje")}>Sí, nos vamos</button>
              <button style={btnPrimary} onClick={() => elegir("homeexchange")}>Sí, vienen a casa con HomeExchange</button>
              <button style={btnPrimary} onClick={() => elegir("vacaciones")}>Sí, son vacaciones para los niños</button>
              <button style={btnPrimary} onClick={() => elegir("compromiso")}>No, pero tengo una cita, un evento o una reunión</button>
              <button style={btnGhost} onClick={() => elegir("cancelar")}>No, nada de lo anterior, cancelar</button>
            </div>
          </>
        )}

        {paso === "viaje" && (
          <>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, fontWeight: 600, marginBottom: 4, color: "#2B2A26" }}>Nos vamos de casa</div>
            <label style={lbl}>¿Cuántos os vais?</label>
            <input type="number" min="1" style={inp} value={personas} onChange={(e) => setPersonas(e.target.value)} />
            <label style={lbl}>¿Por qué motivo os vais?</label>
            <select style={inp} value={motivo} onChange={(e) => setMotivo(e.target.value)}>
              <option value="Vacaciones">Vacaciones</option>
              <option value="Trabajo">Trabajo</option>
              <option value="Otros">Otros</option>
            </select>
            <label style={lbl}>¿Cuánto tiempo os vais? (días)</label>
            <input type="number" min="1" style={inp} value={dias} onChange={(e) => setDias(e.target.value)} />
            <label style={lbl}>¿A dónde os vais?</label>
            <input type="text" style={inp} value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Destino" />
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button onClick={onClose} style={btnGhost}>Cancelar</button>
              <button onClick={irAConfirmarComidas} style={btnPrimary}>Aceptar</button>
            </div>
          </>
        )}

        {paso === "confirmarComidas" && (
          <>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, fontWeight: 600, marginBottom: 10, color: "#2B2A26" }}>
              ¿Quieres eliminar la planificación de comidas de esos días y sus ingredientes de la lista de la compra?
            </div>
            <div style={{ fontSize: 12.5, color: "#8A8577", marginBottom: 14, lineHeight: 1.4 }}>
              Se borrarán las comidas planificadas para esos días y se intentará descontar los ingredientes correspondientes de la lista de la compra (el ajuste es aproximado; conviene revisar la lista después). Podrás deshacerlo si eliminas este mismo viaje más adelante.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button style={btnPrimary} onClick={() => confirmarComidas(true)}>Sí, eliminar</button>
              <button style={btnGhost} onClick={() => confirmarComidas(false)}>No, dejar como estaba</button>
            </div>
          </>
        )}

        {paso === "homeexchange" && (
          <>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, fontWeight: 600, marginBottom: 4, color: "#2B2A26" }}>HomeExchange</div>
            <label style={lbl}>¿Cuántos días vienen?</label>
            <input type="number" min="1" style={inp} value={dias} onChange={(e) => setDias(e.target.value)} />
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button onClick={onClose} style={btnGhost}>Cancelar</button>
              <button onClick={aceptarHomeExchange} style={btnPrimary}>Aceptar</button>
            </div>
          </>
        )}

        {paso === "vacaciones" && (
          <>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, fontWeight: 600, marginBottom: 4, color: "#2B2A26" }}>Vacaciones de los niños</div>
            <label style={lbl}>¿Cuántos días tienen de vacaciones?</label>
            <input type="number" min="1" style={inp} value={dias} onChange={(e) => setDias(e.target.value)} />
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button onClick={onClose} style={btnGhost}>Cancelar</button>
              <button onClick={aceptarVacaciones} style={btnPrimary}>Aceptar</button>
            </div>
          </>
        )}

        {paso === "compromiso" && (
          <>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 16, fontWeight: 600, marginBottom: 4, color: "#2B2A26" }}>Cita, evento o reunión</div>
            <label style={lbl}>¿Qué tienes?</label>
            <select style={inp} value={categoriaCompromiso} onChange={(e) => setCategoriaCompromiso(e.target.value)}>
              <option value="Cita">Cita</option>
              <option value="Reunión">Reunión</option>
              <option value="Evento">Evento</option>
            </select>
            <label style={lbl}>Descripción</label>
            <input type="text" style={inp} value={descripcionCompromiso} onChange={(e) => setDescripcionCompromiso(e.target.value)} placeholder="¿De qué se trata?" />
            <label style={lbl}>¿Cuántos lo tenéis?</label>
            <input type="number" min="1" style={inp} value={personasCompromiso} onChange={(e) => setPersonasCompromiso(e.target.value)} />
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button onClick={onClose} style={btnGhost}>Cancelar</button>
              <button onClick={aceptarCompromiso} style={btnPrimary}>Aceptar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- navegador de fecha ---------- */

function DateNav({ date, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      <button style={navBtn} onClick={() => onChange(addDays(date, -1))}>‹</button>
      <input type="date" style={{ ...inp, textAlign: "center", flex: 1 }} value={date} onChange={(e) => onChange(e.target.value)} />
      <button style={navBtn} onClick={() => onChange(addDays(date, 1))}>›</button>
    </div>
  );
}

/* ---------- bloque de receta (comida / cena) ---------- */

function RecetaBlock({ label, receta, onChange }) {
  const r = receta || emptyReceta();
  const update = (patch) => onChange({ ...r, ...patch });
  const updateIngrediente = (i, patch) => {
    const next = r.ingredientes.map((ing, idx) => (idx === i ? { ...ing, ...patch } : ing));
    update({ ingredientes: next });
  };
  const addIngrediente = () => update({ ingredientes: [...r.ingredientes, { ingrediente: "", cantidad: "", unidad: "" }] });
  const removeIngrediente = (i) => update({ ingredientes: r.ingredientes.filter((_, idx) => idx !== i) });
  const pasosTexto = (r.pasos || []).join("\n");
  const setPasos = (e) => update({ pasos: e.target.value.split("\n").filter((l) => l.trim() !== "") });

  return (
    <div style={{ background: "#FFFEFB", border: "1px solid #E4DFD3", borderRadius: 10, padding: 14, marginTop: 8 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "#8A8577", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 8 }}>Receta — {label}</div>
      <input style={inp} value={r.titulo} onChange={(e) => update({ titulo: e.target.value })} placeholder="Nombre del plato" />
      <input style={{ ...inpSm, marginTop: 8 }} value={r.nota} onChange={(e) => update({ nota: e.target.value })} placeholder="Nota (opcional)" />

      <div style={{ fontSize: 11, textTransform: "uppercase", color: "#8A8577", fontFamily: "'IBM Plex Mono', monospace", marginTop: 14, marginBottom: 6 }}>Ingredientes</div>
      {r.ingredientes.map((ing, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
          <input style={{ ...inpSm, flex: 3 }} value={ing.ingrediente} onChange={(e) => updateIngrediente(i, { ingrediente: e.target.value })} placeholder="Ingrediente" />
          <input style={{ ...inpSm, flex: 1 }} value={ing.cantidad} onChange={(e) => updateIngrediente(i, { cantidad: e.target.value })} placeholder="Cant." />
          <input style={{ ...inpSm, flex: 1 }} value={ing.unidad} onChange={(e) => updateIngrediente(i, { unidad: e.target.value })} placeholder="Ud." />
          <button style={removeBtn} onClick={() => removeIngrediente(i)}>×</button>
        </div>
      ))}
      <button style={addLink} onClick={addIngrediente}>+ Añadir ingrediente</button>

      <div style={{ fontSize: 11, textTransform: "uppercase", color: "#8A8577", fontFamily: "'IBM Plex Mono', monospace", marginTop: 10, marginBottom: 6 }}>Elaboración (un paso por línea)</div>
      <textarea style={{ ...inp, minHeight: 90 }} value={pasosTexto} onChange={setPasos} />
    </div>
  );
}

function recetaATexto(label, receta) {
  if (!receta || !receta.titulo) return "";
  let t = `*${label}: ${receta.titulo}*\n`;
  if (receta.nota) t += `_${receta.nota}_\n`;
  if (receta.ingredientes?.length) {
    t += `\nIngredientes:\n`;
    receta.ingredientes.forEach((ing) => { t += `• ${ing.ingrediente} — ${ing.cantidad} ${ing.unidad}\n`; });
  }
  if (receta.pasos?.length) {
    t += `\nElaboración:\n`;
    receta.pasos.forEach((p) => { t += `${p}\n`; });
  }
  return t;
}

/* ---------- vista Comidas ---------- */

function Comidas({ date, setDate, comidas, setComidas, recetas, setRecetas }) {
  const dia = comidas[date] || {};
  const recetasDia = recetas[date] || {};
  const setSlot = (slotKey) => (e) => setComidas({ ...comidas, [date]: { ...(comidas[date] || {}), [slotKey]: e.target.value } });
  const setReceta = (slotKey) => (nueva) => setRecetas({ ...recetas, [date]: { ...(recetas[date] || {}), [slotKey]: nueva } });

  const compartir = () => {
    let t = `*Comidas — ${fmtLargo(date)}*\n\n`;
    SLOTS_COMIDA.forEach((s) => { if (dia[s.key]) t += `*${s.label}:* ${dia[s.key]}\n`; });
    SLOTS_CON_RECETA.forEach((k) => {
      const texto = recetaATexto(SLOTS_COMIDA.find((s) => s.key === k).label, recetasDia[k]);
      if (texto) t += `\n${texto}`;
    });
    return t;
  };

  return (
    <div style={{ padding: "4px 16px 16px" }}>
      <DateNav date={date} onChange={setDate} />
      <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 15, fontWeight: 600, textTransform: "capitalize", marginBottom: 14, color: "#2B2A26" }}>{fmtLargo(date)}</div>
      {SLOTS_COMIDA.map((s) => (
        <div key={s.key} style={{ marginBottom: 8 }}>
          <label style={lbl}>{s.label}</label>
          <textarea style={{ ...inp, minHeight: 54 }} value={dia[s.key] || ""} onChange={setSlot(s.key)} placeholder={`¿Qué toca de ${s.label.toLowerCase()}?`} />
          {SLOTS_CON_RECETA.includes(s.key) && (
            <RecetaBlock label={s.label} receta={recetasDia[s.key]} onChange={setReceta(s.key)} />
          )}
        </div>
      ))}
      <ShareButton getText={compartir} label="Compartir comidas del día" />
    </div>
  );
}

/* ---------- vista Entreno ---------- */

function Entreno({ date, setDate, entreno, setEntreno, detalle, setDetalle }) {
  const dia = entreno[date] || { diaSemana: "", semana: "", fase: "", tipo: "", notas: "", hecho: false };
  const det = detalle[date] || { columnas: ["Bloque", "Ejercicio", "Notas"], filas: [] };

  const set = (k) => (e) => {
    const val = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setEntreno({ ...entreno, [date]: { ...(entreno[date] || {}), [k]: val } });
  };
  const updateFila = (i, col, val) => {
    const filas = det.filas.map((f, idx) => (idx === i ? { ...f, [col]: val } : f));
    setDetalle({ ...detalle, [date]: { ...det, filas } });
  };
  const addFila = () => {
    const nueva = {}; det.columnas.forEach((c) => (nueva[c] = ""));
    setDetalle({ ...detalle, [date]: { ...det, filas: [...det.filas, nueva] } });
  };
  const removeFila = (i) => setDetalle({ ...detalle, [date]: { ...det, filas: det.filas.filter((_, idx) => idx !== i) } });

  const compartir = () => {
    let t = `*Entreno — ${fmtLargo(date)}*\n${dia.tipo || ""}\n`;
    if (dia.fase) t += `Fase: ${dia.fase} · Semana ${dia.semana}\n`;
    if (dia.notas) t += `_${dia.notas}_\n`;
    if (det.filas.length) {
      t += `\n`;
      det.filas.forEach((f) => {
        const partes = det.columnas.filter((c) => c !== "Notas" && f[c] !== "" && f[c] != null).map((c) => `${c}: ${f[c]}`);
        t += `• ${partes.join(" · ")}${f["Notas"] ? ` — ${f["Notas"]}` : ""}\n`;
      });
    }
    return t;
  };

  return (
    <div style={{ padding: "4px 16px 16px" }}>
      <DateNav date={date} onChange={setDate} />
      <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 15, fontWeight: 600, textTransform: "capitalize", marginBottom: 14, color: "#2B2A26" }}>{fmtLargo(date)}</div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}><label style={lbl}>Semana</label><input style={inp} value={dia.semana || ""} onChange={set("semana")} /></div>
        <div style={{ flex: 2 }}><label style={lbl}>Fase</label><input style={inp} value={dia.fase || ""} onChange={set("fase")} /></div>
      </div>
      <label style={lbl}>Tipo de día</label>
      <input style={inp} value={dia.tipo || ""} onChange={set("tipo")} placeholder="Ej. Carrera suave, Fuerza A…" />
      <label style={lbl}>Notas</label>
      <textarea style={{ ...inp, minHeight: 50 }} value={dia.notas || ""} onChange={set("notas")} />
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 14, color: "#2B2A26" }}>
        <input type="checkbox" checked={!!dia.hecho} onChange={set("hecho")} style={{ width: 18, height: 18 }} />
        Sesión completada
      </label>

      <div style={sectionTitle}>Detalle de la sesión</div>
      {det.filas.map((fila, i) => (
        <div key={i} style={{ background: "#FFFEFB", border: "1px solid #E4DFD3", borderRadius: 8, padding: 10, marginBottom: 8 }}>
          {det.columnas.map((col) => (
            <div key={col} style={{ marginBottom: 6 }}>
              <label style={{ ...lbl, marginTop: 0 }}>{col}</label>
              <input style={inpSm} value={fila[col] ?? ""} onChange={(e) => updateFila(i, col, e.target.value)} />
            </div>
          ))}
          <button style={{ ...btnDanger, flex: "none", padding: "6px 14px", fontSize: 12.5 }} onClick={() => removeFila(i)}>Eliminar bloque</button>
        </div>
      ))}
      <button style={addLink} onClick={addFila}>+ Añadir bloque de ejercicio</button>

      <ShareButton getText={compartir} label="Compartir entreno del día" />
    </div>
  );
}

/* ---------- vista Compra ---------- */

function Compra({ compra, setCompra }) {
  const semanas = useMemo(() => Object.keys(compra).sort(), [compra]);
  const [idx, setIdx] = useState(() => {
    const hoy = todayISO();
    const i = semanas.findIndex((s, ix) => hoy >= s && (ix === semanas.length - 1 || hoy < semanas[ix + 1]));
    return i >= 0 ? i : 0;
  });
  const semanaKey = semanas[idx];
  const semana = compra[semanaKey] || { categorias: {} };

  const updateItem = (cat, i, patch) => {
    const items = semana.categorias[cat].map((it, idx2) => (idx2 === i ? { ...it, ...patch } : it));
    setCompra({ ...compra, [semanaKey]: { ...semana, categorias: { ...semana.categorias, [cat]: items } } });
  };
  const addItem = (cat) => {
    const items = [...(semana.categorias[cat] || []), { ingrediente: "", cantidad: "", gramos: null }];
    setCompra({ ...compra, [semanaKey]: { ...semana, categorias: { ...semana.categorias, [cat]: items } } });
  };
  const removeItem = (cat, i) => {
    const items = semana.categorias[cat].filter((_, idx2) => idx2 !== i);
    setCompra({ ...compra, [semanaKey]: { ...semana, categorias: { ...semana.categorias, [cat]: items } } });
  };

  const compartir = () => {
    let t = `*Lista de la compra*\n${semana.titulo || semanaKey}\n`;
    Object.entries(semana.categorias || {}).forEach(([cat, items]) => {
      if (!items.length) return;
      t += `\n*${cat}*\n`;
      items.forEach((it) => { if (it.ingrediente) t += `• ${it.ingrediente} — ${it.cantidad}\n`; });
    });
    return t;
  };

  if (!semanaKey) return <div style={{ padding: 16, color: "#B5AF9E", fontStyle: "italic" }}>Sin listas de la compra todavía</div>;

  return (
    <div style={{ padding: "4px 16px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <button style={navBtn} disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>‹</button>
        <div style={{ flex: 1, textAlign: "center", fontFamily: "'Fraunces', Georgia, serif", fontSize: 14, fontWeight: 600 }}>
          {fmtCorto(semana.inicio)} — {fmtCorto(semana.fin)}
        </div>
        <button style={navBtn} disabled={idx === semanas.length - 1} onClick={() => setIdx((i) => Math.min(semanas.length - 1, i + 1))}>›</button>
      </div>

      {Object.entries(semana.categorias || {}).map(([cat, items]) => (
        <div key={cat}>
          <div style={sectionTitle}>{cat}</div>
          {items.map((it, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <input style={{ ...inpSm, flex: 3 }} value={it.ingrediente} onChange={(e) => updateItem(cat, i, { ingrediente: e.target.value })} />
              <input style={{ ...inpSm, flex: 1.4 }} value={it.cantidad} onChange={(e) => updateItem(cat, i, { cantidad: e.target.value })} />
              <button style={removeBtn} onClick={() => removeItem(cat, i)}>×</button>
            </div>
          ))}
          <button style={addLink} onClick={() => addItem(cat)}>+ Añadir a {cat.toLowerCase()}</button>
        </div>
      ))}
      <ShareButton getText={compartir} label="Compartir lista de la compra" />
    </div>
  );
}

/* ---------- vista Calendario ---------- */

function Calendario({ tasks, comidas, entreno, eventos, onOpenTask, onJump, onAddEvento, onDeleteEvento, onRestaurarSnapshot }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState(todayISO());
  const cells = useMemo(() => monthMatrix(year, month), [year, month]);
  const changeMonth = (delta) => { let m = month + delta, y = year; if (m < 0) { m = 11; y -= 1; } if (m > 11) { m = 0; y += 1; } setMonth(m); setYear(y); };
  const tasksForDay = (iso) => tasks.filter((t) => inRange(iso, t.inicio, t.fin));
  const selectedTasks = tasksForDay(selected);
  const selComida = comidas[selected];
  const selEntreno = entreno[selected];
  const resumenComida = selComida ? Object.values(selComida).filter(Boolean)[0] : null;

  const [eventoModalFecha, setEventoModalFecha] = useState(null);
  const pressTimerRef = useRef(null);
  const startPress = (iso) => () => {
    pressTimerRef.current = setTimeout(() => setEventoModalFecha(iso), 500);
  };
  const clearPress = () => { if (pressTimerRef.current) clearTimeout(pressTimerRef.current); };
  const eventosDia = eventosParaDia(eventos, selected);

  const handleDeleteEvento = (ev) => {
    const confirmMsg = ev.tipo === "viaje"
      ? `¿Eliminar el viaje a "${ev.destino || "sin destino"}" (${ev.dias} día${ev.dias === 1 ? "" : "s"})?`
      : `¿Eliminar "${ev.tipo === "compromiso" ? ev.categoriaCompromiso : TIPOS_EVENTO_ESPECIAL[ev.tipo].label}" (${ev.dias} día${ev.dias === 1 ? "" : "s"})?`;
    if (!window.confirm(confirmMsg)) return;
    if (ev.snapshot) {
      if (window.confirm("Este viaje había eliminado planificación de comidas y ajustado la compra. ¿Quieres restaurarlas?")) {
        onRestaurarSnapshot(ev.snapshot);
      }
    }
    onDeleteEvento(ev.id);
  };

  return (
    <div style={{ padding: "4px 16px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button onClick={() => changeMonth(-1)} style={navBtn}>‹</button>
        <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 600, textTransform: "capitalize" }}>{MESES[month]} {year}</div>
        <button onClick={() => changeMonth(1)} style={navBtn}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 4 }}>
        {DOW.map((d) => <div key={d} style={{ textAlign: "center", fontSize: 10.5, color: "#B5AF9E", fontFamily: "'IBM Plex Mono', monospace" }}>{d}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dt = tasksForDay(iso);
          const hasComida = !!comidas[iso];
          const hasEntreno = !!entreno[iso];
          const isSelected = iso === selected;
          const isToday = iso === todayISO();
          const fondoEspecial = fondoEventosDia(eventos, iso);
          return (
            <button
              key={i}
              onClick={() => setSelected(iso)}
              onMouseDown={startPress(iso)}
              onMouseUp={clearPress}
              onMouseLeave={clearPress}
              onTouchStart={startPress(iso)}
              onTouchEnd={clearPress}
              onTouchMove={clearPress}
              onContextMenu={(e) => e.preventDefault()}
              style={{ aspectRatio: "1", borderRadius: 8, border: isSelected ? "2px solid #2B2A26" : isToday ? "1.5px solid #2B2A26" : "1px solid #E4DFD3", background: fondoEspecial || "#FFFEFB", color: "#2B2A26", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, cursor: "pointer", padding: 0 }}>
              {day}
              <div style={{ display: "flex", gap: 2 }}>
                {dt.slice(0, 2).map((t) => <span key={t.id} style={{ width: 4, height: 4, borderRadius: 2, background: CATEGORIAS[t.categoria]?.stripe || "#999" }} />)}
                {hasComida && <span style={{ width: 4, height: 4, borderRadius: 2, background: "#C9A227" }} />}
                {hasEntreno && <span style={{ width: 4, height: 4, borderRadius: 2, background: "#5C7A94" }} />}
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "#8A8577", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 8 }}>{fmtCorto(selected)}</div>
        {selectedTasks.length === 0 && <div style={{ fontSize: 13, color: "#B5AF9E", fontStyle: "italic", marginBottom: 10 }}>Sin tareas ese día</div>}
        {selectedTasks.map((t) => <TaskCard key={t.id} task={t} onOpen={onOpenTask} />)}

        {eventosDia.map((ev) => (
          <div key={ev.id} style={{ position: "relative", background: "#FFFEFB", border: "1px solid #E4DFD3", borderLeft: `5px solid ${TIPOS_EVENTO_ESPECIAL[ev.tipo].color}`, borderRadius: 8, padding: "12px 40px 12px 14px", marginTop: 10 }}>
            <button
              onClick={() => handleDeleteEvento(ev)}
              aria-label="Eliminar evento"
              style={{ position: "absolute", top: 8, right: 8, width: 24, height: 24, borderRadius: 6, border: "1px solid #E4DFD3", background: "#FBEAE6", color: "#A8503D", fontSize: 13, lineHeight: "22px", cursor: "pointer", padding: 0 }}
            >×</button>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#8A8577", marginBottom: 4 }}>
              {ev.tipo === "compromiso" ? ev.categoriaCompromiso : TIPOS_EVENTO_ESPECIAL[ev.tipo].label}
            </div>
            {ev.tipo === "viaje" ? (
              <div style={{ fontSize: 13.5, color: "#2B2A26" }}>
                {ev.personas} persona{ev.personas === 1 ? "" : "s"} · {ev.motivo} · {ev.dias} día{ev.dias === 1 ? "" : "s"}{ev.destino ? ` · Destino: ${ev.destino}` : ""}
                {ev.snapshot && <span style={{ display: "block", marginTop: 4, fontSize: 11.5, color: "#8A8577" }}>Comidas y compra ajustadas para este viaje</span>}
              </div>
            ) : ev.tipo === "compromiso" ? (
              <div style={{ fontSize: 13.5, color: "#2B2A26" }}>
                <strong>{ev.categoriaCompromiso}</strong>{ev.descripcion ? ` — ${ev.descripcion}` : ""} · {ev.personas} persona{ev.personas === 1 ? "" : "s"}
              </div>
            ) : (
              <div style={{ fontSize: 13.5, color: "#2B2A26" }}>{ev.dias} día{ev.dias === 1 ? "" : "s"}</div>
            )}
          </div>
        ))}

        <button onClick={() => onJump("comidas", selected)} style={{ display: "block", width: "100%", textAlign: "left", background: "#FFFEFB", border: "1px solid #E4DFD3", borderLeft: "5px solid #C9A227", borderRadius: 8, padding: "12px 14px", marginTop: 10, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#8A8577", marginBottom: 4 }}>🍽️ Comida</div>
          <div style={{ fontSize: 13.5, color: "#2B2A26" }}>{resumenComida ? (resumenComida.length > 70 ? resumenComida.slice(0, 70) + "…" : resumenComida) : "Toca para planificar"}</div>
        </button>
        <button onClick={() => onJump("entreno", selected)} style={{ display: "block", width: "100%", textAlign: "left", background: "#FFFEFB", border: "1px solid #E4DFD3", borderLeft: "5px solid #5C7A94", borderRadius: 8, padding: "12px 14px", marginTop: 10, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#8A8577", marginBottom: 4 }}>🏃 Entreno {selEntreno?.hecho ? "· hecho ✓" : ""}</div>
          <div style={{ fontSize: 13.5, color: "#2B2A26" }}>{selEntreno?.tipo || "Toca para planificar"}</div>
        </button>
      </div>

      {eventoModalFecha && (
        <EventoEspecialModal
          fecha={eventoModalFecha}
          onClose={() => setEventoModalFecha(null)}
          onSave={(evento) => { onAddEvento(evento); setEventoModalFecha(null); }}
        />
      )}
    </div>
  );
}

/* ---------- app ---------- */

export default function App() {
  const [tasks, setTasks] = useStore("tasks", []);
  const [comidas, setComidas] = useStore("comidas", comidasData);
  const [entreno, setEntreno] = useStore("entreno", entrenoData);
  const [recetas, setRecetas] = useStore("recetas", recetasData);
  const [compra, setCompra] = useStore("compra", compraData);
  const [detalle, setDetalle] = useStore("entrenoDetalle", entrenoDetalleData);
  const [eventosEspeciales, setEventosEspeciales] = useStore("eventosEspeciales", []);

  const [tab, setTab] = useState("calendario");
  const [focusDate, setFocusDate] = useState(todayISO());
  const [modalTask, setModalTask] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showImportExcel, setShowImportExcel] = useState(false);

  const importarEventos = (eventos, categoria) => {
    let nuevos = 0, actualizados = 0;
    let next = [...tasks];
    eventos.forEach((ev) => {
      const idxExiste = ev.gcalUid ? next.findIndex((t) => t.gcalUid === ev.gcalUid) : -1;
      if (idxExiste >= 0) {
        next[idxExiste] = { ...next[idxExiste], titulo: ev.titulo, inicio: ev.inicio, fin: ev.fin, comentarios: ev.comentarios };
        actualizados++;
      } else {
        next.push({ id: uid(), titulo: ev.titulo, categoria, prioridad: "Medio", estado: "backlog", inicio: ev.inicio, fin: ev.fin, motivoBloqueo: "", comentarios: ev.comentarios, gcalUid: ev.gcalUid });
        nuevos++;
      }
    });
    setTasks(next);
    return { nuevos, actualizados };
  };

  const importarExcel = (tipo, datos) => {
    if (tipo === "comidas") setComidas(fusionarComidasVacias(comidas, datos));
    if (tipo === "recetas") setRecetas(fusionarRecetasVacias(recetas, datos));
    if (tipo === "entreno") setEntreno(fusionarEntrenoVacio(entreno, datos));
    if (tipo === "detalle") setDetalle(fusionarDetalleVacio(detalle, datos));
    if (tipo === "compra") setCompra(fusionarCompraSoloFaltante(compra, datos));
  };

  const quitarPlanificacionComidas = (fechaInicio, dias) => {
    const fechas = [];
    for (let i = 0; i < dias; i++) fechas.push(addDays(fechaInicio, i));

    const comidasPrevias = {};
    const recetasPrevias = {};
    fechas.forEach((iso) => {
      if (comidas[iso]) comidasPrevias[iso] = comidas[iso];
      if (recetas[iso]) recetasPrevias[iso] = recetas[iso];
    });

    const restarPorSemana = {};
    fechas.forEach((iso) => {
      const rec = recetas[iso];
      if (!rec) return;
      const weekKey = Object.keys(compra).find((k) => iso >= compra[k].inicio && iso <= compra[k].fin);
      if (!weekKey) return;
      ["comida", "cena"].forEach((slot) => {
        const receta = rec[slot];
        if (!receta?.ingredientes?.length) return;
        if (!restarPorSemana[weekKey]) restarPorSemana[weekKey] = [];
        receta.ingredientes.forEach((ing) => {
          if (ing.ingrediente) restarPorSemana[weekKey].push({ ingrediente: ing.ingrediente, cantidad: ing.cantidad, unidad: ing.unidad });
        });
      });
    });

    const compraPrevia = {};
    Object.keys(restarPorSemana).forEach((weekKey) => { if (compra[weekKey]) compraPrevia[weekKey] = compra[weekKey]; });

    let nuevaCompra = { ...compra };
    Object.entries(restarPorSemana).forEach(([weekKey, lista]) => {
      const semana = nuevaCompra[weekKey];
      if (!semana) return;
      const nuevasCategorias = {};
      Object.entries(semana.categorias).forEach(([cat, items]) => { nuevasCategorias[cat] = [...items]; });
      lista.forEach(({ ingrediente, cantidad, unidad }) => {
        const target = convertirUnidad(parseFloat(cantidad) || 0, unidad || "");
        Object.keys(nuevasCategorias).forEach((cat) => {
          nuevasCategorias[cat] = nuevasCategorias[cat].map((item) => {
            if (!item.ingrediente || item.ingrediente.toLowerCase() !== ingrediente.toLowerCase()) return item;
            const parsed = parseCantidadStr(item.cantidad);
            if (!parsed) return item;
            const itemBase = convertirUnidad(parsed.num, parsed.unidad);
            if (itemBase.unidad !== target.unidad) return item;
            const restante = itemBase.num - target.num;
            if (restante <= 0.0001) return null;
            let nuevoNum = restante, nuevaUnidad = itemBase.unidad;
            if (parsed.unidad === "kg") { nuevoNum = restante / 1000; nuevaUnidad = "kg"; }
            else if (parsed.unidad === "l") { nuevoNum = restante / 1000; nuevaUnidad = "l"; }
            else { nuevaUnidad = parsed.unidad; }
            return { ...item, cantidad: formatCantidadStr(nuevoNum, nuevaUnidad) };
          }).filter(Boolean);
        });
      });
      nuevaCompra[weekKey] = { ...semana, categorias: nuevasCategorias };
    });
    setCompra(nuevaCompra);

    const nuevasComidas = { ...comidas };
    const nuevasRecetas = { ...recetas };
    fechas.forEach((iso) => { delete nuevasComidas[iso]; delete nuevasRecetas[iso]; });
    setComidas(nuevasComidas);
    setRecetas(nuevasRecetas);

    return { comidasPrevias, recetasPrevias, compraPrevia };
  };

  const restaurarSnapshotComidas = (snapshot) => {
    setComidas({ ...comidas, ...snapshot.comidasPrevias });
    setRecetas({ ...recetas, ...snapshot.recetasPrevias });
    setCompra({ ...compra, ...snapshot.compraPrevia });
  };

  const addEventoEspecial = (evento) => {
    const { borrarComidas, ...eventoLimpio } = evento;
    let snapshot = null;
    if (evento.tipo === "viaje" && borrarComidas) snapshot = quitarPlanificacionComidas(evento.inicio, evento.dias);
    setEventosEspeciales([...eventosEspeciales, { ...eventoLimpio, snapshot }]);
  };
  const deleteEventoEspecial = (id) => setEventosEspeciales(eventosEspeciales.filter((e) => e.id !== id));

  const openTask = (t) => { setModalTask(t); setIsNew(false); };
  const openNewTask = () => { setModalTask(emptyTask()); setIsNew(true); };
  const saveTask = (form) => {
    const exists = tasks.some((t) => t.id === form.id);
    setTasks(exists ? tasks.map((t) => (t.id === form.id ? form : t)) : [...tasks, form]);
    setModalTask(null);
  };
  const deleteTask = (id) => { setTasks(tasks.filter((t) => t.id !== id)); setModalTask(null); };
  const jump = (destTab, date) => { setFocusDate(date); setTab(destTab); };

  const TABS = [
    { key: "calendario", label: "Calendario" },
    { key: "comidas", label: "Comidas" },
    { key: "entreno", label: "Entreno" },
    { key: "compra", label: "Compra" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#F6F3EC", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { -webkit-tap-highlight-color: transparent; }
        button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid #5C7A94; outline-offset: 1px; }
      `}</style>

      <div style={{ padding: "20px 16px 12px", position: "sticky", top: 0, background: "#F6F3EC", zIndex: 10, borderBottom: "1px solid #E4DFD3" }}>
        <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 700, color: "#2B2A26", marginBottom: 12 }}>Casa &amp; Comunidad</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: "7px 14px", borderRadius: 20, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", background: tab === t.key ? "#2B2A26" : "#EDEAE1", color: tab === t.key ? "#FBF9F4" : "#6B665A", fontFamily: "'Inter', system-ui, sans-serif" }}>
              {t.label}
            </button>
          ))}
          {tab === "calendario" && (
            <>
              <button onClick={() => setShowImport(true)} style={{ padding: "7px 12px", borderRadius: 20, border: "1px solid #DDD6C7", fontSize: 13, fontWeight: 600, cursor: "pointer", background: "#FFFEFB", color: "#5C7A94", fontFamily: "'Inter', system-ui, sans-serif" }}>
                ⇩ Importar
              </button>
              <button onClick={() => setShowImportExcel(true)} style={{ padding: "7px 12px", borderRadius: 20, border: "1px solid #DDD6C7", fontSize: 13, fontWeight: 600, cursor: "pointer", background: "#FFFEFB", color: "#5C7A94", fontFamily: "'Inter', system-ui, sans-serif" }}>
                📊 Excel
              </button>
            </>
          )}
        </div>
      </div>

      {tab === "calendario" && <Calendario tasks={tasks} comidas={comidas} entreno={entreno} eventos={eventosEspeciales} onOpenTask={openTask} onJump={jump} onAddEvento={addEventoEspecial} onDeleteEvento={deleteEventoEspecial} onRestaurarSnapshot={restaurarSnapshotComidas} />}
      {tab === "comidas" && <Comidas date={focusDate} setDate={setFocusDate} comidas={comidas} setComidas={setComidas} recetas={recetas} setRecetas={setRecetas} />}
      {tab === "entreno" && <Entreno date={focusDate} setDate={setFocusDate} entreno={entreno} setEntreno={setEntreno} detalle={detalle} setDetalle={setDetalle} />}
      {tab === "compra" && <Compra compra={compra} setCompra={setCompra} />}

      {tab === "calendario" && (
        <button onClick={openNewTask} aria-label="Añadir tarea" style={{ position: "fixed", bottom: 20, right: 20, width: 54, height: 54, borderRadius: 27, background: "#2B2A26", color: "#FBF9F4", border: "none", fontSize: 26, lineHeight: "54px", boxShadow: "0 4px 12px rgba(43,42,38,0.3)", cursor: "pointer" }}>+</button>
      )}

      {modalTask && <TaskModal task={modalTask} onSave={saveTask} onDelete={isNew ? null : deleteTask} onClose={() => setModalTask(null)} />}
      {showImport && <ImportModal onImport={importarEventos} onClose={() => setShowImport(false)} />}
      {showImportExcel && <ImportExcelModal onImport={importarExcel} onClose={() => setShowImportExcel(false)} />}
    </div>
  );
}
