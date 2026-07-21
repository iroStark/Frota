(function () {
  "use strict";

  const STORE_KEY = "uhocha-controle-v1";
  const API_BASE_URL = String(
    window.UHOCHA_API_URL || (location.protocol === "file:" ? "http://localhost:3000" : location.origin),
  ).replace(/\/$/, "");
  const SYNC_DEBOUNCE_MS = 450;
  const routes = ["dashboard", "registar", "frota", "contrato", "relatorios", "motorista", "viatura"];
  const navTopRoutes = ["dashboard", "registar", "frota", "contrato", "relatorios"];
  const routeParents = { motorista: "frota", viatura: "frota" };
  const today = () => new Date();

  const contractDefaults = {
    weeklyFee: 130000,
    penaltyLate24: 5000,
    penaltyLate72: 15000,
    fineOffHours: 50000,
    returnDelayDaily: 30000,
    deductibleLimit: 80000,
    deliveryDay: 1,
    deliveryHour: "12:00",
    maintenanceDayName: "Segunda-feira",
    province: "Luanda",
    contractMonths: 12,
    trialDays: 30,
  };

  const seedState = () => ({
    version: 1,
    theme: "light",
    company: {
      name: "UHOCHA - Comércio & Prestação de Serviços, Lda.",
      location: "Lubango, Huíla",
      nif: "5000848280",
    },
    settings: contractDefaults,
    vehicles: [
      {
        id: uid(),
        brand: "Suzuki",
        model: "Express",
        plate: "",
        color: "",
        year: "",
        chassis: "",
        booklet: "",
        propertyTitle: "",
        insurancePolicy: "",
        mileage: "",
        status: "ativo",
        driverId: "",
        createdAt: new Date().toISOString(),
      },
    ],
    drivers: [],
    assignments: [],
    payments: [],
    expenses: [],
    events: [],
    documents: [],
    notes: [],
  });

  let state = loadState();
  let activeRouteState = getRoute();
  let activeRoute = activeRouteState.name;
  let activeRouteId = activeRouteState.id;
  let activeRegisterTab = "pagamento";
  let activeFleetTab = "viaturas";
  let activeReportMonth = monthValue(new Date());
  let activeReportTab = "geral";
  let activeDetailTab = "resumo";
  let syncTimer = null;
  let hasPendingLocalChange = false;

  const app = document.querySelector("#app");

  const icons = {
    layout: '<rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect>',
    plus: '<path d="M12 5v14"></path><path d="M5 12h14"></path>',
    car: '<path d="M5 17h14l-1.7-5.1A3 3 0 0 0 14.5 10h-5a3 3 0 0 0-2.8 1.9L5 17Z"></path><path d="M4 17h16v3H4z"></path><circle cx="7.5" cy="20" r="2"></circle><circle cx="16.5" cy="20" r="2"></circle>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8"></path><path d="M8 17h6"></path>',
    chart: '<path d="M3 3v18h18"></path><path d="M7 15l4-4 3 3 5-7"></path>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path>',
    moon: '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 1 0 9.8 9.8Z"></path>',
    sun: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path>',
    trash: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="m19 6-1 15H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path>',
    edit: '<path d="m12 20 9-9-4-4-9 9-2 6 6-2Z"></path><path d="m15 6 4 4"></path>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"></path><path d="M17 21v-8H7v8"></path><path d="M7 3v5h8"></path>',
    clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
    alert: '<path d="M10.3 3.7 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
    check: '<path d="m20 6-11 11-5-5"></path>',
    wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"></path><path d="M16 12h6v5h-6a2.5 2.5 0 0 1 0-5Z"></path>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5 5L3 18v3h3l6.7-6.7a4 4 0 0 0 5-5l-2.9 2.9-3-3 2.9-2.9Z"></path>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"></path>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 10h18"></path>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M17 8l-5-5-5 5"></path><path d="M12 3v12"></path>',
  };

  function uid() {
    return globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (!saved) return seedState();
      return normalizeState(saved);
    } catch (error) {
      console.warn(error);
      return seedState();
    }
  }

  function normalizeState(saved) {
    const seeded = seedState();
    return {
      ...seeded,
      ...saved,
      settings: { ...seeded.settings, ...(saved.settings || {}) },
      company: { ...seeded.company, ...(saved.company || {}) },
      vehicles: Array.isArray(saved.vehicles) ? saved.vehicles : seeded.vehicles,
      drivers: Array.isArray(saved.drivers) ? saved.drivers : [],
      assignments: Array.isArray(saved.assignments) ? saved.assignments : [],
      payments: Array.isArray(saved.payments) ? saved.payments : [],
      expenses: Array.isArray(saved.expenses) ? saved.expenses : [],
      events: Array.isArray(saved.events) ? saved.events : [],
      documents: Array.isArray(saved.documents) ? saved.documents : [],
      notes: Array.isArray(saved.notes) ? saved.notes : [],
    };
  }

  function persist(options = {}) {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    if (options.remote !== false) {
      hasPendingLocalChange = true;
      queueRemoteSync();
    }
  }

  function apiUrl(path) {
    return `${API_BASE_URL}${path}`;
  }

  function queueRemoteSync(delay = SYNC_DEBOUNCE_MS) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      syncState().catch((error) => {
        console.warn("Não foi possível sincronizar com o backend.", error);
      });
    }, delay);
  }

  async function syncState() {
    const response = await fetch(apiUrl("/api/state"), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ state }),
    });

    if (!response.ok) {
      throw new Error(`Falha ao guardar no backend (${response.status}).`);
    }

    hasPendingLocalChange = false;
  }

  function hasUsableRemoteState(remoteState) {
    return Boolean(
      remoteState
        && typeof remoteState === "object"
        && !Array.isArray(remoteState)
        && (
          remoteState.version
          || remoteState.vehicles?.length
          || remoteState.drivers?.length
          || remoteState.assignments?.length
          || remoteState.payments?.length
          || remoteState.expenses?.length
          || remoteState.events?.length
          || remoteState.documents?.length
        ),
    );
  }

  function meaningfulRecordCount(appState) {
    if (!appState || typeof appState !== "object") return 0;
    const vehicles = Array.isArray(appState.vehicles)
      ? appState.vehicles.filter((vehicle) => (
        vehicle.plate
        || vehicle.driverId
        || vehicle.color
        || vehicle.year
        || vehicle.chassis
        || vehicle.mileage
        || (vehicle.status && vehicle.status !== "ativo")
      )).length
      : 0;
    return vehicles
      + (Array.isArray(appState.drivers) ? appState.drivers.length : 0)
      + (Array.isArray(appState.assignments) ? appState.assignments.length : 0)
      + (Array.isArray(appState.payments) ? appState.payments.length : 0)
      + (Array.isArray(appState.expenses) ? appState.expenses.length : 0)
      + (Array.isArray(appState.events) ? appState.events.length : 0)
      + (Array.isArray(appState.documents) ? appState.documents.length : 0)
      + (Array.isArray(appState.notes) ? appState.notes.length : 0);
  }

  async function loadRemoteState() {
    try {
      const response = await fetch(apiUrl("/api/state"), {
        headers: { Accept: "application/json" },
      });

      if (response.status === 404) {
        queueRemoteSync(0);
        return;
      }

      if (!response.ok) {
        throw new Error(`Falha ao carregar do backend (${response.status}).`);
      }

      const data = await response.json();
      if (!hasUsableRemoteState(data.state)) {
        queueRemoteSync(0);
        return;
      }

      const remoteState = normalizeState(data.state);
      if (meaningfulRecordCount(state) > meaningfulRecordCount(remoteState)) {
        queueRemoteSync(0);
        return;
      }

      if (hasPendingLocalChange) return;
      state = remoteState;
      persist({ remote: false });
      render();
      toast("Dados carregados do PostgreSQL.");
    } catch (error) {
      console.warn("Backend indisponível. O app continua a guardar neste aparelho.", error);
    }
  }

  function h(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function icon(name) {
    const hugeicons = {
      layout: "grid-view",
      plus: "add-01",
      car: "taxi",
      file: "legal-document-01",
      chart: "analytics-up",
      download: "download-04",
      upload: "upload-04",
      moon: "moon-02",
      sun: "sun-03",
      trash: "delete-02",
      edit: "pencil-edit-02",
      save: "floppy-disk",
      clock: "clock-01",
      alert: "alert-circle",
      check: "checkmark-circle-02",
      wallet: "wallet-02",
      wrench: "wrench-02",
      shield: "shield-01",
      calendar: "calendar-03",
      location: "location-01",
      phone: "call-02",
      users: "user-multiple-02",
      back: "arrow-left-01",
    };
    return `<i class="icon hgi-stroke hgi-${hugeicons[name] || hugeicons.layout}" aria-hidden="true"></i>`;
  }

  function installIcons(root = document) {
    root.querySelectorAll("[data-icon]").forEach((node) => {
      node.innerHTML = icon(node.dataset.icon);
    });
  }

  function money(value) {
    const number = Number(value || 0);
    return `Kz ${new Intl.NumberFormat("pt-AO", { maximumFractionDigits: 0 }).format(number)}`;
  }

  function dateLabel(value) {
    if (!value) return "Sem data";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Sem data";
    return new Intl.DateTimeFormat("pt-AO", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  }

  function dateTimeLabel(value) {
    if (!value) return "Sem data";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Sem data";
    return new Intl.DateTimeFormat("pt-AO", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function monthValue(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function monthLabel(value) {
    const [year, month] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("pt-AO", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
  }

  function toLocalInput(date = new Date()) {
    const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return copy.toISOString().slice(0, 16);
  }

  function toDateInput(date = new Date()) {
    const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return copy.toISOString().slice(0, 10);
  }

  function mondayOf(date) {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    const day = copy.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    copy.setDate(copy.getDate() + diff);
    return copy;
  }

  function dueDateTime(date = new Date()) {
    const monday = mondayOf(date);
    const [hour, minute] = state.settings.deliveryHour.split(":").map(Number);
    monday.setHours(hour, minute, 0, 0);
    return monday;
  }

  function vehicleName(vehicle) {
    if (!vehicle) return "Sem viatura";
    const plate = vehicle.plate ? ` - ${vehicle.plate}` : "";
    return `${vehicle.brand || "Viatura"} ${vehicle.model || ""}${plate}`.trim();
  }

  function driverName(driver) {
    return driver?.name || "Sem motorista";
  }

  function getVehicle(id) {
    return state.vehicles.find((vehicle) => vehicle.id === id);
  }

  function getDriver(id) {
    return state.drivers.find((driver) => driver.id === id);
  }

  function activeAssignmentForVehicle(vehicleId) {
    return state.assignments.find((assignment) => assignment.vehicleId === vehicleId && assignment.status === "ativo");
  }

  function activeAssignmentForDriver(driverId) {
    return state.assignments.find((assignment) => assignment.driverId === driverId && assignment.status === "ativo");
  }

  function assignedVehicles() {
    return state.vehicles.filter((vehicle) => vehicle.status === "ativo" && vehicle.driverId);
  }

  function currentWeekPayments() {
    const monday = mondayOf(new Date());
    const next = new Date(monday);
    next.setDate(next.getDate() + 7);
    return state.payments.filter((payment) => {
      const due = new Date(payment.dueAt);
      return due >= monday && due < next;
    });
  }

  function currentMonthItems(list, field = "date") {
    return list.filter((item) => monthValue(new Date(item[field] || item.createdAt)) === activeReportMonth);
  }

  function periodRange(kind) {
    const now = new Date();
    if (kind === "semana") {
      const start = mondayOf(now);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end, label: "Semana" };
    }
    if (kind === "mes") {
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth() + 1, 1), label: "Mês" };
    }
    if (kind === "ano") {
      return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear() + 1, 0, 1), label: "Ano" };
    }
    return { start: null, end: null, label: "Geral" };
  }

  function filterByPeriod(list, field, kind) {
    const { start, end } = periodRange(kind);
    if (!start || !end) return list;
    return list.filter((item) => {
      const date = new Date(item[field] || item.createdAt);
      return date >= start && date < end;
    });
  }

  function paymentPenalty(payment, atDate = new Date()) {
    const due = new Date(payment.dueAt);
    const paid = payment.paidAt ? new Date(payment.paidAt) : atDate;
    const delayHours = Math.max(0, (paid - due) / 36e5);
    if (delayHours === 0) return { amount: 0, label: "Em dia", severity: "ok", delayHours };
    if (delayHours <= 24) {
      return { amount: state.settings.penaltyLate24, label: "Atraso até 24h", severity: "warn", delayHours };
    }
    if (delayHours <= 72) {
      return { amount: state.settings.penaltyLate72, label: "Atraso 24h-72h", severity: "danger", delayHours };
    }
    return { amount: state.settings.penaltyLate72, label: "Atraso superior a 72h", severity: "danger", delayHours, breach: true };
  }

  function documentStatus(doc) {
    if (!doc.expiresAt) return { label: "Sem validade", severity: "" };
    const expires = new Date(`${doc.expiresAt}T23:59:00`);
    const days = Math.ceil((expires - new Date()) / 86400000);
    if (days < 0) return { label: "Expirado", severity: "danger" };
    if (days <= 30) return { label: `${days} dias`, severity: "warn" };
    return { label: "Válido", severity: "ok" };
  }

  function calcSummary() {
    const weekPayments = currentWeekPayments();
    const expected = assignedVehicles().length * state.settings.weeklyFee;
    const collected = weekPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const penalties = weekPayments.reduce((sum, payment) => sum + paymentPenalty(payment).amount, 0);
    const monthPayments = currentMonthItems(state.payments, "paidAt");
    const monthExpensesOwner = currentMonthItems(state.expenses, "date")
      .filter((expense) => expense.responsible === "proprietaria")
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const monthCollected = monthPayments.reduce((sum, payment) => sum + Number(payment.amount || 0) + Number(payment.penaltyPaid || 0), 0);
    const net = monthCollected - monthExpensesOwner;
    const overdue = assignedVehicles().filter((vehicle) => {
      const hasPayment = weekPayments.some((payment) => payment.vehicleId === vehicle.id);
      return !hasPayment && new Date() > dueDateTime(new Date());
    }).length;
    const alerts = buildAlerts();
    return { expected, collected, penalties, monthExpensesOwner, monthCollected, net, overdue, alerts };
  }

  function calcPeriodSummary(kind) {
    const payments = filterByPeriod(state.payments, "paidAt", kind);
    const expenses = filterByPeriod(state.expenses, "date", kind);
    const events = filterByPeriod(state.events, "date", kind);
    const received = payments.reduce((sum, payment) => sum + Number(payment.amount || 0) + Number(payment.penaltyPaid || 0), 0);
    const ownerCosts = expenses.filter((expense) => expense.responsible === "proprietaria").reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const driverCosts = expenses.filter((expense) => expense.responsible === "motorista").reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const lateCount = payments.filter((payment) => paymentPenalty(payment).delayHours > 0).length;
    return { ...periodRange(kind), payments, expenses, events, received, ownerCosts, driverCosts, net: received - ownerCosts, lateCount };
  }

  function buildAlerts() {
    const alerts = [];
    const due = dueDateTime(new Date());
    if (new Date() > due) {
      assignedVehicles().forEach((vehicle) => {
        const paid = currentWeekPayments().some((payment) => payment.vehicleId === vehicle.id);
        if (!paid) {
          alerts.push({
            type: "danger",
            icon: "clock",
            title: "Entrega semanal pendente",
            text: `${vehicleName(vehicle)} ainda não tem entrega registada para esta semana.`,
          });
        }
      });
    }

    state.documents.forEach((doc) => {
      const status = documentStatus(doc);
      if (status.severity === "warn" || status.severity === "danger") {
        alerts.push({
          type: status.severity,
          icon: "file",
          title: doc.name || "Documento",
          text: `${status.label}: ${vehicleName(getVehicle(doc.vehicleId)) || driverName(getDriver(doc.driverId))}`,
        });
      }
    });

    state.payments.forEach((payment) => {
      const penalty = paymentPenalty(payment);
      if (!payment.paidAt && penalty.delayHours > 0) {
        alerts.push({
          type: penalty.severity,
          icon: "alert",
          title: penalty.label,
          text: `${driverName(getDriver(payment.driverId))}: ${money(penalty.amount)} de penalidade contratual.`,
        });
      }
    });

    state.vehicles
      .filter((vehicle) => vehicle.status === "imobilizado" || vehicle.status === "manutencao")
      .forEach((vehicle) => {
        alerts.push({
          type: "danger",
          icon: "wrench",
          title: vehicle.status === "imobilizado" ? "Viatura imobilizada" : "Viatura em manutenção",
          text: `${vehicleName(vehicle)} não deve ser atribuída nem considerada disponível.`,
        });
      });

    return alerts.slice(0, 8);
  }

  function setRoute(input) {
    const parsed = typeof input === "string" ? parseRouteString(input) : (input || { name: "dashboard", id: "" });
    activeRoute = routes.includes(parsed.name) ? parsed.name : "dashboard";
    activeRouteId = parsed.id || "";
    const target = activeRouteId ? `${activeRoute}/${activeRouteId}` : activeRoute;
    if (location.hash.replace(/^#/, "") !== target) {
      history.replaceState(null, "", `#${target}`);
    }
    render();
  }

  function parseRouteString(value) {
    const raw = String(value || "").replace(/^#/, "");
    const [name, id] = raw.split("/");
    return { name: name || "dashboard", id: id || "" };
  }

  function getRoute() {
    const parsed = parseRouteString(location.hash);
    if (!routes.includes(parsed.name)) return { name: "dashboard", id: "" };
    return parsed;
  }

  function navigate(name, id = "") {
    if (id && (name === "motorista" || name === "viatura")) {
      if (id !== activeRouteId || name !== activeRoute) activeDetailTab = "resumo";
    }
    setRoute({ name, id });
  }

  function pageHead(title, subtitle = "") {
    const now = new Intl.DateTimeFormat("pt-AO", { weekday: "short", day: "2-digit", month: "short" }).format(new Date());
    return `
      <div class="page-head">
        <div>
          <h1>${h(title)}</h1>
          ${subtitle ? `<p>${h(subtitle)}</p>` : ""}
        </div>
        <span class="date-chip">${h(now)}</span>
      </div>
    `;
  }

  function render() {
    document.documentElement.dataset.theme = state.theme || "light";
    const themeIcon = document.querySelector("#themeButton [data-icon]");
    if (themeIcon) themeIcon.dataset.icon = state.theme === "dark" ? "sun" : "moon";
    installIcons(document.querySelector("#themeButton"));
    const navActive = routeParents[activeRoute] || activeRoute;
    document.querySelectorAll("[data-route]").forEach((link) => {
      link.classList.toggle("active", link.dataset.route === navActive);
    });
    const views = {
      dashboard: renderDashboard,
      registar: renderRegister,
      frota: renderFleet,
      contrato: renderContract,
      relatorios: renderReports,
      motorista: () => renderDriverProfile(activeRouteId),
      viatura: () => renderVehicleProfile(activeRouteId),
    };
    closeOpenModal();
    app.innerHTML = views[activeRoute]();
    installIcons(app);
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  function renderDashboard() {
    const summary = calcSummary();
    const vehicles = state.vehicles.filter((vehicle) => vehicle.status === "ativo");
    const periodSummaries = ["semana", "mes", "ano", "geral"].map(calcPeriodSummary);
    const lateDrivers = aggregateByDriver(state.payments, state.expenses, state.events)
      .filter((row) => row.lateCount > 0)
      .sort((a, b) => b.lateCount - a.lateCount)
      .slice(0, 4);
    const recentPayments = [...state.payments].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
    const recentEvents = [...state.events].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
    const progress = summary.expected ? Math.min(100, Math.round((summary.collected / summary.expected) * 100)) : 0;

    return `
      ${pageHead("Painel", "Entregas, lucro mensal, alertas e estado operacional.")}
      <div class="metric-grid">
        <article class="metric wide">
          <span>Lucro líquido do mês</span>
          <strong>${money(summary.net)}</strong>
          <small>Entradas recebidas menos despesas da proprietária em ${h(monthLabel(activeReportMonth))}.</small>
        </article>
        <article class="metric">
          <span>Entrega semanal</span>
          <strong>${money(summary.collected)}</strong>
          <small>Esperado: ${money(summary.expected)}</small>
        </article>
        <article class="metric">
          <span>Viaturas ativas</span>
          <strong>${vehicles.length}</strong>
          <small>${assignedVehicles().length} com motorista atribuído</small>
        </article>
        <article class="metric">
          <span>Alertas</span>
          <strong>${summary.alerts.length}</strong>
          <small>${summary.overdue} entrega(s) vencida(s)</small>
        </article>
      </div>

      <section class="section-band">
        <div class="panel pad">
          <div class="section-title">
            <h2>Meta semanal</h2>
            <small>${progress}%</small>
          </div>
          <div class="progress-bar" aria-label="Progresso semanal"><span style="width:${progress}%"></span></div>
          <div class="status-line">
            <span class="pulse"></span>
            <span class="muted">Pagamento contratual: ${money(state.settings.weeklyFee)} por viatura, segunda-feira até ${h(state.settings.deliveryHour)}.</span>
          </div>
        </div>
      </section>

      <section class="section-band">
        <div class="section-title">
          <h2>Controlo por período</h2>
          <small>Semana, mês, ano e geral</small>
        </div>
        <div class="kpi-strip">
          ${periodSummaries.map((item) => `
            <div class="kpi">
              <span>${h(item.label)}</span>
              <strong>${money(item.net)}</strong>
              <small class="muted">${money(item.received)} recebido · ${money(item.ownerCosts)} despesas · ${item.events.length} ocorrências</small>
            </div>
          `).join("")}
        </div>
      </section>

      <section class="section-band grid-2">
        <div>
          <div class="section-title">
            <h2>Alertas</h2>
            <a class="button secondary" href="#contrato">${icon("file")}Contrato</a>
          </div>
          ${summary.alerts.length ? `
            <div class="record-list">
              ${summary.alerts.map((alert) => `
                <article class="record">
                  <div class="record-main">
                    <div class="record-title">
                      <strong>${h(alert.title)}</strong>
                      <small>${h(alert.text)}</small>
                    </div>
                    <span class="badge ${alert.type}">${icon(alert.icon)}${h(alert.type === "danger" ? "Atenção" : "Prazo")}</span>
                  </div>
                </article>
              `).join("")}
            </div>` : empty("Nenhum alerta contratual neste momento.")}
        </div>

        <div>
          <div class="section-title">
            <h2>Motoristas com mais atrasos</h2>
            <a class="button secondary" href="#relatorios">${icon("chart")}Relatórios</a>
          </div>
          <div class="record-list">
            ${lateDrivers.length ? lateDrivers.map((row) => `
              <article class="record clickable" data-nav="motorista" data-nav-id="${h(row.id)}">
                <div class="record-main">
                  <div class="record-lead">
                    ${driverAvatarHtml(row.driver, "sm")}
                    <div class="record-title">
                      <strong>${h(row.name)}</strong>
                      <small>${h(row.vehicleName)} · ${row.payments} entrega(s)</small>
                    </div>
                  </div>
                  <span class="badge danger">${row.lateCount} atraso(s)</span>
                </div>
              </article>
            `).join("") : empty("Nenhum atraso registado até agora.")}
          </div>
        </div>
      </section>

      <section class="section-band">
        <div class="section-title">
          <h2>Últimos registos</h2>
          <a class="button secondary" href="#registar">${icon("plus")}Novo</a>
        </div>
        <div class="stack">
          ${recentPayments.length ? recentPayments.map((payment) => paymentRecord(payment, true)).join("") : empty("Ainda não há entregas registadas.")}
          ${recentEvents.length ? recentEvents.map((event) => eventRecord(event, true)).join("") : ""}
        </div>
      </section>
    `;
  }

  function renderRegister() {
    const tabs = [
      ["pagamento", "Entrega"],
      ["despesa", "Despesa"],
      ["ocorrencia", "Ocorrência"],
      ["documento", "Documento"],
    ];
    const labels = {
      pagamento: { title: "Entregas semanais", btn: "Nova entrega", form: "payment", empty: "Ainda não há entregas registadas." },
      despesa: { title: "Despesas", btn: "Nova despesa", form: "expense", empty: "Ainda não há despesas." },
      ocorrencia: { title: "Ocorrências", btn: "Nova ocorrência", form: "event", empty: "Ainda não há ocorrências." },
      documento: { title: "Documentos", btn: "Novo documento", form: "document", empty: "Ainda não há documentos registados." },
    };
    const meta = labels[activeRegisterTab];
    const lists = {
      pagamento: () => [...state.payments].reverse().map((payment) => paymentRecord(payment)).join(""),
      despesa: () => [...state.expenses].reverse().map((expense) => expenseRecord(expense)).join(""),
      ocorrencia: () => [...state.events].reverse().map((event) => eventRecord(event)).join(""),
      documento: () => [...state.documents].reverse().map((doc) => documentRecord(doc)).join(""),
    };
    const listHtml = lists[activeRegisterTab]() || empty(meta.empty);
    return `
      ${pageHead("Registar", "Entradas semanais, despesas, ocorrências e prazos.")}
      <div class="tabs">
        ${tabs.map(([id, label]) => `<button class="tab ${activeRegisterTab === id ? "active" : ""}" type="button" data-register-tab="${id}">${h(label)}</button>`).join("")}
      </div>
      <div class="list-toolbar">
        <div>
          <h2>${h(meta.title)}</h2>
          <small class="muted">${state.payments.length + state.expenses.length + state.events.length + state.documents.length} registos no total.</small>
        </div>
        <button class="button" type="button" data-open-form="${h(meta.form)}">${icon("plus")}${h(meta.btn)}</button>
      </div>
      <div class="record-list">
        ${listHtml}
      </div>
    `;
  }

  function paymentForm() {
    const due = dueDateTime();
    const assigned = state.drivers.filter((driver) => activeAssignmentForDriver(driver.id));
    const initialDriverId = assigned[0]?.id || "";
    const initialVehicle = getVehicle(activeAssignmentForDriver(initialDriverId)?.vehicleId);
    return `
      <form class="panel pad form-grid" data-form="payment">
        ${selectField("driverId", "Motorista", driverOptions(true, { assignedOnly: true }), initialDriverId, "data-payment-driver class='span-2'")}
        ${inputField("vehicleLabel", "Viatura associada", "text", vehicleName(initialVehicle), "readonly data-payment-vehicle-label")}
        <input type="hidden" name="vehicleId" value="${h(initialVehicle?.id || "")}" data-payment-vehicle />
        ${inputField("amount", "Valor entregue", "number", state.settings.weeklyFee, "min='0' step='1000'")}
        ${inputField("penaltyPaid", "Penalidade paga", "number", 0, "min='0' step='1000'")}
        ${inputField("dueAt", "Vencimento", "datetime-local", toLocalInput(due))}
        ${inputField("paidAt", "Recebido em", "datetime-local", toLocalInput())}
        ${inputField("proof", "Comprovativo", "text", "", "placeholder='Transferência, talão ou referência' class='span-2'")}
        ${fileField("proofFile", "Upload do comprovativo", "accept='image/*,application/pdf'")}
        <div class="field span-3">
          <label for="paymentNotes">Notas</label>
          <textarea id="paymentNotes" name="notes" placeholder="Observações sobre atraso, comprovativo ou acordo."></textarea>
        </div>
        <button class="button full span-3" type="submit">${icon("save")}Guardar entrega</button>
      </form>
    `;
  }

  function expenseForm() {
    return `
      <form class="panel pad form-grid" data-form="expense">
        ${selectField("vehicleScope", "Aplicar despesa a", [
          ["single", "Uma viatura"],
          ["all", "Todas as viaturas"],
        ], "single", "data-expense-scope")}
        ${selectField("vehicleId", "Viatura", vehicleOptions(true), state.vehicles[0]?.id || "", "data-expense-vehicle")}
        ${inputField("date", "Data", "date", toDateInput())}
        ${selectField("category", "Grupo/Categoria", [
          ["combustivel", "Combustível"],
          ["lavagem", "Lavagem"],
          ["manutencao", "Manutenção"],
          ["pneu", "Pneu/alinhamento"],
          ["seguro", "Seguro/documento"],
          ["multa", "Multa/coima"],
          ["operacional", "Operacional geral"],
          ["documentacao", "Documentação"],
          ["outro", "Outro"],
        ])}
        ${selectField("responsible", "Responsável", [
          ["motorista", "Motorista"],
          ["proprietaria", "Proprietária"],
        ], "proprietaria")}
        ${inputField("amount", "Valor", "number", "", "min='0' step='1000'")}
        ${inputField("paidTo", "Pago a", "text", "", "placeholder='Oficina, seguradora, posto...'")}
        <div class="field span-3">
          <label for="expenseNotes">Notas</label>
          <textarea id="expenseNotes" name="notes" placeholder="Detalhe da despesa, recibo ou autorização."></textarea>
        </div>
        <button class="button full span-3" type="submit">${icon("save")}Guardar despesa</button>
      </form>
    `;
  }

  function eventForm() {
    return `
      <form class="panel pad form-grid" data-form="event">
        ${selectField("vehicleId", "Viatura", vehicleOptions(true), state.vehicles[0]?.id || "")}
        ${selectField("driverId", "Motorista", driverOptions(true), state.drivers[0]?.id || "")}
        ${inputField("date", "Data e hora", "datetime-local", toLocalInput())}
        ${selectField("type", "Tipo", [
          ["sinistro", "Acidente/sinistro"],
          ["avaria", "Avaria"],
          ["multa", "Multa"],
          ["fora_horario", "Fora de horário"],
          ["vistoria", "Vistoria"],
          ["gps", "GPS/manipulação"],
          ["furto", "Furto/roubo"],
          ["outro", "Outro"],
        ])}
        ${inputField("amount", "Valor associado", "number", "", "min='0' step='1000'")}
        ${selectField("status", "Estado", [
          ["aberto", "Aberto"],
          ["resolvido", "Resolvido"],
        ])}
        <div class="field span-3" data-event-impact>
          <label>Impacto operacional</label>
          <div class="check-grid">
            ${checkboxField("immobilizeVehicle", "Imobilizar viatura", false)}
            ${checkboxField("releaseAssignment", "Libertar motorista/atribuição", false)}
          </div>
        </div>
        <div class="field span-3">
          <label for="eventNotes">Descrição</label>
          <textarea id="eventNotes" name="notes" placeholder="O que aconteceu, quem foi avisado e próximos passos."></textarea>
        </div>
        <button class="button full span-3" type="submit">${icon("save")}Guardar ocorrência</button>
      </form>
    `;
  }

  function documentForm() {
    return `
      <form class="panel pad form-grid" data-form="document">
        ${selectField("scope", "Ligado a", [
          ["vehicle", "Viatura"],
          ["driver", "Motorista"],
          ["company", "Empresa"],
        ])}
        ${selectField("vehicleId", "Viatura", vehicleOptions(true), state.vehicles[0]?.id || "")}
        ${selectField("driverId", "Motorista", driverOptions(true), state.drivers[0]?.id || "")}
        ${selectField("name", "Documento", [
          ["Livrete", "Livrete"],
          ["Título de Propriedade", "Título de Propriedade"],
          ["Inspecção Periódica", "Inspecção Periódica"],
          ["Seguro Obrigatório", "Seguro Obrigatório"],
          ["Selo do Imposto de Circulação", "Selo do Imposto de Circulação"],
          ["Bilhete de Identidade", "Bilhete de Identidade"],
          ["Carta de Condução", "Carta de Condução"],
          ["Licenciamento de táxi", "Licenciamento de táxi"],
        ])}
        ${inputField("number", "Número", "text", "", "placeholder='Número ou referência'")}
        ${inputField("expiresAt", "Validade", "date", "")}
        ${fileField("documentFile", "Ficheiro", "accept='image/*,application/pdf' class='span-2'")}
        <div class="field span-3">
          <label for="documentNotes">Notas</label>
          <textarea id="documentNotes" name="notes" placeholder="Onde está guardado, renovação, recibo ou observação."></textarea>
        </div>
        <button class="button full span-3" type="submit">${icon("save")}Guardar documento</button>
      </form>
    `;
  }

  function renderFleet() {
    const tabs = [
      ["viaturas", "Viaturas"],
      ["motoristas", "Motoristas"],
      ["atribuicoes", "Atribuições"],
      ["config", "Valores"],
    ];
    return `
      ${pageHead("Frota", "Viaturas, motoristas, atribuições, cauções e valores do contrato.")}
      <div class="tabs">
        ${tabs.map(([id, label]) => `<button class="tab ${activeFleetTab === id ? "active" : ""}" type="button" data-fleet-tab="${id}">${h(label)}</button>`).join("")}
      </div>
      ${activeFleetTab === "viaturas" ? renderVehicles() : ""}
      ${activeFleetTab === "motoristas" ? renderDrivers() : ""}
      ${activeFleetTab === "atribuicoes" ? renderAssignments() : ""}
      ${activeFleetTab === "config" ? renderSettings() : ""}
    `;
  }

  function vehicleForm(prefill = {}) {
    const v = prefill || {};
    const isEdit = Boolean(v.id);
    return `
      <form class="panel pad form-grid" data-form="vehicle" data-modal-form="vehicle">
        <input type="hidden" name="id" value="${h(v.id || "")}" />
        ${inputField("brand", "Marca", "text", v.brand ?? "Suzuki")}
        ${inputField("model", "Modelo", "text", v.model ?? "Express")}
        ${inputField("plate", "Matrícula", "text", v.plate ?? "", "placeholder='LD-00-00-AA'")}
        ${inputField("color", "Cor", "text", v.color ?? "")}
        ${inputField("year", "Ano", "number", v.year ?? "", "min='1990' max='2100'")}
        ${inputField("mileage", "Quilometragem", "number", v.mileage ?? "", "min='0'")}
        ${inputField("chassis", "N.º de chassis", "text", v.chassis ?? "", "class='span-2'")}
        ${inputField("booklet", "N.º livrete", "text", v.booklet ?? "")}
        ${inputField("propertyTitle", "Título propriedade", "text", v.propertyTitle ?? "")}
        ${inputField("insurancePolicy", "Apólice seguro", "text", v.insurancePolicy ?? "")}
        ${fileField("photoFile", isEdit && v.files?.photo?.url ? "Substituir foto" : "Foto da viatura", "accept='image/*'")}
        ${fileField("bookletFile", isEdit && v.files?.booklet?.url ? "Substituir livrete" : "Upload livrete", "accept='image/*,application/pdf'")}
        ${fileField("propertyTitleFile", isEdit && v.files?.propertyTitle?.url ? "Substituir título" : "Upload título", "accept='image/*,application/pdf'")}
        ${fileField("insuranceFile", isEdit && v.files?.insurancePolicy?.url ? "Substituir seguro" : "Upload seguro", "accept='image/*,application/pdf'")}
        ${fileField("inspectionFile", isEdit && v.files?.inspection?.url ? "Substituir inspeção" : "Upload inspeção", "accept='image/*,application/pdf' class='span-2'")}
        ${selectField("driverId", "Motorista atribuído", driverOptions(true), v.driverId ?? "", "class='span-2'")}
        ${selectField("status", "Estado", [["ativo", "Ativo"], ["manutencao", "Manutenção"], ["imobilizado", "Imobilizado"], ["parado", "Parado"]], v.status ?? "ativo")}
        <button class="button full span-3" type="submit">${icon("save")}${isEdit ? "Atualizar viatura" : "Guardar viatura"}</button>
      </form>
    `;
  }

  function driverForm(prefill = {}) {
    const d = prefill || {};
    const isEdit = Boolean(d.id);
    const contacts = Array.isArray(d.contacts) ? d.contacts : [];
    const c1 = contacts[0] || {};
    const c2 = contacts[1] || {};
    const loc = d.addressLocation || {};
    return `
      <form class="panel pad form-grid" data-form="driver" data-modal-form="driver">
        <input type="hidden" name="id" value="${h(d.id || "")}" />
        ${inputField("name", "Nome", "text", d.name ?? "", "placeholder='Nome completo'")}
        ${phoneField("phoneLocal", "Telefone", extractLocalPhone(d.phone))}
        ${fileField("photoFile", isEdit && d.files?.photo?.url ? "Substituir foto" : "Foto do motorista", "accept='image/*'")}
        ${inputField("contact1Name", "Nome contacto 1", "text", c1.name ?? "", "placeholder='Esposa, irmão ou familiar'")}
        ${selectField("contact1Relation", "Relação contacto 1", contactRelationOptions(), c1.relation ?? "esposa")}
        ${phoneField("contact1PhoneLocal", "Telefone contacto 1", extractLocalPhone(c1.phone))}
        ${inputField("contact2Name", "Nome contacto 2", "text", c2.name ?? "", "placeholder='Esposa, irmão ou familiar'")}
        ${selectField("contact2Relation", "Relação contacto 2", contactRelationOptions(), c2.relation ?? "irmao")}
        ${phoneField("contact2PhoneLocal", "Telefone contacto 2", extractLocalPhone(c2.phone))}
        ${inputField("bi", "BI", "text", d.bi ?? "")}
        ${inputField("biValid", "Validade do BI", "date", d.biValid ?? "")}
        ${inputField("license", "Carta de condução", "text", d.license ?? "")}
        ${inputField("licenseValid", "Validade da carta", "date", d.licenseValid ?? "")}
        ${fileField("biFile", isEdit && d.files?.bi?.url ? "Substituir BI" : "Upload BI", "accept='image/*,application/pdf'")}
        ${fileField("licenseFile", isEdit && d.files?.license?.url ? "Substituir carta" : "Upload carta", "accept='image/*,application/pdf'")}
        ${inputField("category", "Categoria", "text", d.category ?? "", "placeholder='B, C...'")}
        ${inputField("nif", "NIF", "text", d.nif ?? "")}
        ${inputField("deposit", "Caução", "number", d.deposit ?? "", "min='0' step='1000'")}
        ${inputField("contractStart", "Início do contrato", "date", d.contractStart || toDateInput())}
        ${locationField({ address: d.address, latitude: loc.latitude, longitude: loc.longitude })}
        <button class="button full span-3" type="submit">${icon("save")}${isEdit ? "Atualizar motorista" : "Guardar motorista"}</button>
      </form>
    `;
  }

  function renderVehicles() {
    return `
      <div class="list-toolbar">
        <div>
          <h2>Viaturas</h2>
          <small class="muted">${state.vehicles.length} registadas · clique numa viatura para abrir o detalhe.</small>
        </div>
        <button class="button" type="button" data-open-form="vehicle">${icon("plus")}Nova viatura</button>
      </div>
      <div class="record-list">
        ${state.vehicles.map(vehicleRecord).join("") || empty("Ainda não há viaturas. Use o botão acima para registar a primeira.")}
      </div>
    `;
  }

  function renderDrivers() {
    return `
      <div class="list-toolbar">
        <div>
          <h2>Motoristas</h2>
          <small class="muted">${state.drivers.length} registados · clique num motorista para abrir o perfil.</small>
        </div>
        <button class="button" type="button" data-open-form="driver">${icon("plus")}Novo motorista</button>
      </div>
      <div class="record-list">
        ${state.drivers.map(driverRecord).join("") || empty("Ainda não há motoristas. Use o botão acima para registar o primeiro.")}
      </div>
    `;
  }

  function assignmentForm() {
    const availableVehicles = vehiclesAvailableForAssignment();
    const availableDrivers = driversAvailableForAssignment();
    return `
      <form class="panel pad form-grid" data-form="assignment" data-modal-form="assignment">
        ${selectField("vehicleId", "Viatura disponível", vehicleOptions(true, { availableOnly: true }), availableVehicles[0]?.id || "")}
        ${selectField("driverId", "Motorista disponível", driverOptions(true, { availableOnly: true }), availableDrivers[0]?.id || "")}
        ${inputField("startAt", "Data de entrega", "datetime-local", toLocalInput())}
        ${inputField("weeklyFee", "Entrega semanal acordada", "number", state.settings.weeklyFee, "min='0' step='1000'")}
        ${inputField("depositReceived", "Caução recebida", "number", "", "min='0' step='1000'")}
        ${inputField("handoverMileage", "Quilometragem na entrega", "number", "", "min='0'")}
        ${selectField("fuelLevel", "Combustível", fuelOptions(), "meio")}
        <div class="field span-3">
          <label>Documentos/itens entregues</label>
          <div class="check-grid">
            ${checkboxField("docBooklet", "Livrete")}
            ${checkboxField("docInsurance", "Seguro")}
            ${checkboxField("docInspection", "Inspeção")}
            ${checkboxField("docLicense", "Licença táxi")}
            ${checkboxField("keysDelivered", "Chaves")}
            ${checkboxField("gpsConfirmed", "GPS confirmado")}
          </div>
        </div>
        <div class="field span-3">
          <label for="assignmentNotes">Notas da entrega</label>
          <textarea id="assignmentNotes" name="notes" placeholder="Estado da viatura, acessórios, observações e responsabilidades."></textarea>
        </div>
        <button class="button full span-3" type="submit">${icon("save")}Atribuir viatura</button>
      </form>
    `;
  }

  function renderAssignments() {
    const activeAssignments = state.assignments.filter((assignment) => assignment.status === "ativo");
    const history = [...state.assignments]
      .filter((assignment) => assignment.status !== "ativo")
      .sort((a, b) => new Date(b.endedAt || b.createdAt) - new Date(a.endedAt || a.createdAt))
      .slice(0, 10);

    return `
      <div class="list-toolbar">
        <div>
          <h2>Atribuições</h2>
          <small class="muted">${activeAssignments.length} ativas · ${history.length} no histórico.</small>
        </div>
        <button class="button" type="button" data-open-form="assignment">${icon("plus")}Nova atribuição</button>
      </div>
      <section class="grid-2">
        <div>
          <div class="section-title">
            <h2>Atribuições ativas</h2>
            <small>${activeAssignments.length}</small>
          </div>
          <div class="record-list">
            ${activeAssignments.map(assignmentRecord).join("") || empty("Nenhuma viatura atribuída.")}
          </div>
        </div>
        <div>
          <div class="section-title">
            <h2>Histórico</h2>
            <small>${state.assignments.length}</small>
          </div>
          <div class="record-list">
            ${history.map(assignmentRecord).join("") || empty("Ainda não há histórico de atribuições.")}
          </div>
        </div>
      </section>
    `;
  }

  function renderSettings() {
    return `
      <form class="panel pad form-grid" data-form="settings">
        ${inputField("weeklyFee", "Entrega semanal", "number", state.settings.weeklyFee, "min='0' step='1000'")}
        ${inputField("penaltyLate24", "Multa até 24h", "number", state.settings.penaltyLate24, "min='0' step='1000'")}
        ${inputField("penaltyLate72", "Multa 24h-72h", "number", state.settings.penaltyLate72, "min='0' step='1000'")}
        ${inputField("fineOffHours", "Multa fora de horário", "number", state.settings.fineOffHours, "min='0' step='1000'")}
        ${inputField("returnDelayDaily", "Multa diária sem restituição", "number", state.settings.returnDelayDaily, "min='0' step='1000'")}
        ${inputField("deductibleLimit", "Franquia máxima por sinistro", "number", state.settings.deductibleLimit, "min='0' step='1000'")}
        ${inputField("deliveryHour", "Hora limite de segunda", "time", state.settings.deliveryHour)}
        ${inputField("contractMonths", "Meses do contrato", "number", state.settings.contractMonths, "min='1'")}
        ${inputField("trialDays", "Dias experimentais", "number", state.settings.trialDays, "min='0'")}
        <button class="button full span-3" type="submit">${icon("save")}Guardar valores</button>
      </form>
    `;
  }

  function renderDriverProfile(driverId) {
    const driver = getDriver(driverId);
    if (!driver) {
      return `
        ${pageHead("Motorista", "Perfil indisponível.")}
        <div class="empty-state">Motorista não encontrado. <a class="button secondary" href="#frota">Voltar à frota</a></div>
      `;
    }
    const assignment = activeAssignmentForDriver(driver.id);
    const vehicle = assignment ? getVehicle(assignment.vehicleId) : state.vehicles.find((v) => v.driverId === driver.id);
    const licenseStatus = driver.licenseValid ? documentStatus({ expiresAt: driver.licenseValid }) : null;
    const biStatus = driver.biValid ? documentStatus({ expiresAt: driver.biValid }) : null;
    const allPayments = state.payments.filter((payment) => payment.driverId === driver.id);
    const allEvents = state.events.filter((event) => event.driverId === driver.id);
    const driverAssignments = state.assignments.filter((assignment) => assignment.driverId === driver.id);

    const tabs = [
      ["resumo", "Resumo"],
      ["movimentos", `Movimentos · ${allPayments.length + allEvents.length}`],
      ["documentos", "Documentos"],
    ];
    const active = ["resumo", "movimentos", "documentos"].includes(activeDetailTab) ? activeDetailTab : "resumo";
    const tabContent = {
      resumo: () => driverResumoView(driver, vehicle, assignment),
      movimentos: () => driverMovimentosView(driver, allPayments, allEvents, driverAssignments),
      documentos: () => driverDocumentosView(driver),
    };

    return `
      <div class="detail-toolbar">
        <button class="button ghost" type="button" data-back="frota">${icon("back")}Voltar</button>
        <div class="detail-actions">
          <button class="button secondary" type="button" data-edit="driver" data-id="${h(driver.id)}">${icon("edit")}Editar</button>
          <button class="icon-button danger" type="button" title="Remover" data-delete="driver" data-id="${h(driver.id)}">${icon("trash")}</button>
        </div>
      </div>
      <section class="profile-header panel pad">
        <div class="profile-photo">${driverAvatarHtml(driver, "lg")}</div>
        <div class="profile-meta">
          <h1>${h(driver.name || "Motorista sem nome")}</h1>
          <p class="muted">${h(driver.phone || "Sem telefone")}${driver.category ? ` · Categoria ${h(driver.category)}` : ""}</p>
          <div class="badge-row">
            <span class="badge">${icon("shield")}Caução ${money(driver.deposit)}</span>
            ${assignment ? `<span class="badge ok">${icon("car")}${h(vehicleName(vehicle))}</span>` : `<span class="badge warn">${icon("car")}Sem viatura</span>`}
            ${biStatus ? `<span class="badge ${biStatus.severity}">BI ${h(biStatus.label)}</span>` : ""}
            ${licenseStatus ? `<span class="badge ${licenseStatus.severity}">Carta ${h(licenseStatus.label)}</span>` : ""}
            ${driver.contractStart ? `<span class="badge">${icon("calendar")}Início ${h(dateLabel(driver.contractStart))}</span>` : ""}
          </div>
        </div>
      </section>

      <div class="tabs">
        ${tabs.map(([id, label]) => `<button class="tab ${active === id ? "active" : ""}" type="button" data-detail-tab="${id}">${h(label)}</button>`).join("")}
      </div>

      ${tabContent[active]()}
    `;
  }

  function driverResumoView(driver, vehicle, assignment) {
    const contacts = Array.isArray(driver.contacts) ? driver.contacts : [];
    const mapHref = residenceMapUrl(driver.addressLocation);
    const totalReceived = state.payments.filter((p) => p.driverId === driver.id).reduce((sum, p) => sum + Number(p.amount || 0) + Number(p.penaltyPaid || 0), 0);
    const totalPenalties = state.payments.filter((p) => p.driverId === driver.id).reduce((sum, p) => sum + paymentPenalty(p).amount, 0);
    const openEvents = state.events.filter((e) => e.driverId === driver.id && e.status !== "resolvido").length;
    return `
      <section class="section-band">
        <div class="kpi-strip">
          <div class="kpi"><span>Total recebido</span><strong>${money(totalReceived)}</strong></div>
          <div class="kpi"><span>Penalidades devidas</span><strong>${money(totalPenalties)}</strong></div>
          <div class="kpi"><span>Ocorrências abertas</span><strong>${openEvents}</strong></div>
        </div>
      </section>
      <section class="section-band grid-2">
        <div class="panel pad info-block">
          <div class="section-title"><h2>Dados pessoais</h2></div>
          <dl class="info-grid">
            ${infoRow("Nome", driver.name)}
            ${infoRow("Telefone", driver.phone)}
            ${infoRow("BI", driver.bi)}
            ${infoRow("Validade BI", driver.biValid ? dateLabel(driver.biValid) : "")}
            ${infoRow("Carta de condução", driver.license)}
            ${infoRow("Validade carta", driver.licenseValid ? dateLabel(driver.licenseValid) : "")}
            ${infoRow("Categoria", driver.category)}
            ${infoRow("NIF", driver.nif)}
            ${infoRow("Caução", money(driver.deposit))}
            ${infoRow("Início contrato", driver.contractStart ? dateLabel(driver.contractStart) : "")}
            ${infoRow("Endereço", driver.address)}
            ${mapHref ? `<div class="info-row"><dt>GPS</dt><dd><a class="badge file-badge" href="${h(mapHref)}" target="_blank" rel="noopener" data-no-nav>${icon("location")}Abrir no mapa</a></dd></div>` : ""}
          </dl>
        </div>

        <div class="panel pad info-block">
          <div class="section-title"><h2>Contactos de emergência</h2></div>
          ${contacts.length ? `
            <div class="record-list">
              ${contacts.map((contact) => `
                <article class="record">
                  <div class="record-main">
                    <div class="record-title">
                      <strong>${h(contact.name || "Sem nome")}</strong>
                      <small>${h(contact.relation || "")}</small>
                    </div>
                    ${contact.phone ? `<a class="badge file-badge" href="tel:${h(contact.phone)}" data-no-nav>${icon("phone")}${h(contact.phone)}</a>` : ""}
                  </div>
                </article>
              `).join("")}
            </div>
          ` : empty("Sem contactos registados.")}
          ${vehicle ? `
            <div class="section-title" style="margin-top:18px"><h2>Viatura atribuída</h2></div>
            <article class="record clickable" data-nav="viatura" data-nav-id="${h(vehicle.id)}">
              <div class="record-main">
                <div class="record-lead">
                  ${vehicleThumbHtml(vehicle)}
                  <div class="record-title">
                    <strong>${h(vehicleName(vehicle))}</strong>
                    <small>${assignment ? `Desde ${h(dateLabel(assignment.startAt))}` : "Sem atribuição ativa"}</small>
                  </div>
                </div>
              </div>
            </article>
          ` : ""}
        </div>
      </section>
    `;
  }

  function driverMovimentosView(driver, payments, events, assignments) {
    const rows = buildDriverTimeline(driver, payments, events, assignments);
    const summary = paymentsSummary(payments);
    return `
      <section class="section-band">
        <div class="kpi-strip">
          <div class="kpi"><span>Entregas</span><strong>${payments.length}</strong></div>
          <div class="kpi"><span>Recebido</span><strong>${money(summary.received)}</strong></div>
          <div class="kpi"><span>Penalidades pagas</span><strong>${money(summary.penaltiesPaid)}</strong></div>
          <div class="kpi"><span>Atrasos</span><strong>${summary.lateCount}</strong></div>
          <div class="kpi"><span>Ocorrências</span><strong>${events.length}</strong></div>
          <div class="kpi"><span>Atribuições</span><strong>${assignments.length}</strong></div>
        </div>
      </section>
      <section class="section-band">
        <div class="section-title"><h2>Linha do tempo</h2><small>${rows.length} eventos</small></div>
        ${rows.length ? `
          <div class="table-wrap">
            <table class="report-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th>Viatura</th>
                  <th>Valor</th>
                  <th>Estado / notas</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((row) => `
                  <tr>
                    <td>${h(dateTimeLabel(row.date))}</td>
                    <td data-label="Tipo"><span class="badge ${row.tone || ""}">${h(row.type)}</span></td>
                    <td data-label="Viatura">${h(row.vehicle)}</td>
                    <td data-label="Valor">${row.amount ? h(money(row.amount)) : "—"}</td>
                    <td data-label="Notas">${h(row.notes || "")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : empty("Sem movimentos registados.")}
      </section>
    `;
  }

  function driverDocumentosView(driver) {
    const files = driver.files || {};
    const linkedDocs = state.documents.filter((doc) => doc.scope === "driver" && doc.driverId === driver.id);
    return `
      <section class="section-band">
        <div class="section-title">
          <h2>Documentos do motorista</h2>
          <a class="button secondary compact" href="#registar">${icon("plus")}Adicionar</a>
        </div>
        <div class="doc-grid">
          ${docCard("Bilhete de Identidade", files.bi, driver.bi, driver.biValid)}
          ${docCard("Carta de Condução", files.license, driver.license, driver.licenseValid)}
          ${linkedDocs.map((doc) => docCard(doc.name, doc.file, doc.number, doc.expiresAt)).join("")}
          ${(!files.bi?.url && !files.license?.url && !linkedDocs.length) ? empty("Sem documentos anexados.") : ""}
        </div>
      </section>
    `;
  }

  function renderVehicleProfile(vehicleId) {
    const vehicle = getVehicle(vehicleId);
    if (!vehicle) {
      return `
        ${pageHead("Viatura", "Detalhe indisponível.")}
        <div class="empty-state">Viatura não encontrada. <a class="button secondary" href="#frota">Voltar à frota</a></div>
      `;
    }
    const assignment = activeAssignmentForVehicle(vehicle.id);
    const driver = getDriver(vehicle.driverId);
    const imageUrl = vehicleImageUrl(vehicle);
    const allPayments = state.payments.filter((payment) => payment.vehicleId === vehicle.id);
    const allExpenses = state.expenses.filter((expense) => expense.vehicleId === vehicle.id);
    const allEvents = state.events.filter((event) => event.vehicleId === vehicle.id);
    const vehicleAssignments = state.assignments.filter((assignment) => assignment.vehicleId === vehicle.id);

    const tabs = [
      ["resumo", "Resumo"],
      ["movimentos", `Movimentos · ${allPayments.length + allExpenses.length + allEvents.length}`],
      ["documentos", "Documentos"],
    ];
    const active = ["resumo", "movimentos", "documentos"].includes(activeDetailTab) ? activeDetailTab : "resumo";
    const tabContent = {
      resumo: () => vehicleResumoView(vehicle, driver),
      movimentos: () => vehicleMovimentosView(vehicle, allPayments, allExpenses, allEvents, vehicleAssignments),
      documentos: () => vehicleDocumentosView(vehicle),
    };

    return `
      <div class="detail-toolbar">
        <button class="button ghost" type="button" data-back="frota">${icon("back")}Voltar</button>
        <div class="detail-actions">
          <button class="button secondary" type="button" data-edit="vehicle" data-id="${h(vehicle.id)}">${icon("edit")}Editar</button>
          <button class="icon-button danger" type="button" title="Remover" data-delete="vehicle" data-id="${h(vehicle.id)}">${icon("trash")}</button>
        </div>
      </div>
      <section class="vehicle-hero panel pad">
        <div class="vehicle-hero-image ${imageUrl ? "" : "is-empty"}">
          ${imageUrl ? `<img src="${h(imageUrl)}" alt="${h(vehicleName(vehicle))}" loading="lazy" onerror="this.parentElement.classList.add('is-empty');this.remove();" />` : ""}
          <span class="hero-fallback">${icon("car")}</span>
        </div>
        <div class="vehicle-hero-meta">
          <h1>${h(`${vehicle.brand || ""} ${vehicle.model || ""}`.trim() || "Viatura")}</h1>
          <p class="muted">${h(vehicle.plate || "Sem matrícula")}${vehicle.year ? ` · ${h(vehicle.year)}` : ""}${vehicle.color ? ` · ${h(vehicle.color)}` : ""}</p>
          <div class="badge-row">
            <span class="badge ${vehicle.status === "ativo" ? "ok" : "warn"}">${h(vehicle.status || "—")}</span>
            ${driver ? `<span class="badge ok" data-nav="motorista" data-nav-id="${h(driver.id)}">${icon("users")}${h(driver.name)}</span>` : `<span class="badge warn">${icon("users")}Sem motorista</span>`}
            ${vehicle.mileage ? `<span class="badge">${h(vehicle.mileage)} km</span>` : ""}
            ${assignment ? `<span class="badge">${icon("calendar")}Atribuída ${h(dateLabel(assignment.startAt))}</span>` : ""}
          </div>
        </div>
      </section>

      <div class="tabs">
        ${tabs.map(([id, label]) => `<button class="tab ${active === id ? "active" : ""}" type="button" data-detail-tab="${id}">${h(label)}</button>`).join("")}
      </div>

      ${tabContent[active]()}
    `;
  }

  function vehicleResumoView(vehicle, driver) {
    const totalReceived = state.payments.filter((p) => p.vehicleId === vehicle.id).reduce((sum, p) => sum + Number(p.amount || 0) + Number(p.penaltyPaid || 0), 0);
    const ownerCosts = state.expenses.filter((e) => e.vehicleId === vehicle.id && e.responsible === "proprietaria").reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const net = totalReceived - ownerCosts;
    return `
      <section class="section-band">
        <div class="kpi-strip">
          <div class="kpi"><span>Total recebido</span><strong>${money(totalReceived)}</strong></div>
          <div class="kpi"><span>Despesas proprietária</span><strong>${money(ownerCosts)}</strong></div>
          <div class="kpi"><span>Lucro acumulado</span><strong class="${net >= 0 ? "" : "value-danger"}">${money(net)}</strong></div>
        </div>
      </section>
      <section class="section-band grid-2">
        <div class="panel pad info-block">
          <div class="section-title"><h2>Identificação</h2></div>
          <dl class="info-grid">
            ${infoRow("Marca", vehicle.brand)}
            ${infoRow("Modelo", vehicle.model)}
            ${infoRow("Matrícula", vehicle.plate)}
            ${infoRow("Cor", vehicle.color)}
            ${infoRow("Ano", vehicle.year)}
            ${infoRow("Quilometragem", vehicle.mileage ? `${vehicle.mileage} km` : "")}
            ${infoRow("Chassis", vehicle.chassis)}
            ${infoRow("Livrete nº", vehicle.booklet)}
            ${infoRow("Título de propriedade", vehicle.propertyTitle)}
            ${infoRow("Apólice de seguro", vehicle.insurancePolicy)}
            ${infoRow("Estado", vehicle.status)}
          </dl>
        </div>

        <div class="panel pad info-block">
          <div class="section-title"><h2>Motorista atribuído</h2></div>
          ${driver ? `
            <article class="record clickable" data-nav="motorista" data-nav-id="${h(driver.id)}">
              <div class="record-main">
                <div class="record-lead">
                  ${driverAvatarHtml(driver, "md")}
                  <div class="record-title">
                    <strong>${h(driver.name)}</strong>
                    <small>${h(driver.phone || "Sem telefone")}</small>
                  </div>
                </div>
              </div>
              <div class="badge-row">
                ${driver.license ? `<span class="badge">Carta ${h(driver.license)}</span>` : ""}
                ${driver.licenseValid ? `<span class="badge ${documentStatus({ expiresAt: driver.licenseValid }).severity}">${h(documentStatus({ expiresAt: driver.licenseValid }).label)}</span>` : ""}
              </div>
            </article>
          ` : empty("Esta viatura ainda não tem motorista atribuído.")}
        </div>
      </section>
    `;
  }

  function vehicleMovimentosView(vehicle, payments, expenses, events, assignments) {
    const rows = buildVehicleTimeline(vehicle, payments, expenses, events, assignments);
    const summary = paymentsSummary(payments);
    const ownerCosts = expenses.filter((e) => e.responsible === "proprietaria").reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const driverCosts = expenses.filter((e) => e.responsible === "motorista").reduce((sum, e) => sum + Number(e.amount || 0), 0);
    return `
      <section class="section-band">
        <div class="kpi-strip">
          <div class="kpi"><span>Entregas</span><strong>${payments.length}</strong></div>
          <div class="kpi"><span>Recebido</span><strong>${money(summary.received)}</strong></div>
          <div class="kpi"><span>Despesas proprietária</span><strong>${money(ownerCosts)}</strong></div>
          <div class="kpi"><span>Custos do motorista</span><strong>${money(driverCosts)}</strong></div>
          <div class="kpi"><span>Ocorrências</span><strong>${events.length}</strong></div>
          <div class="kpi"><span>Atribuições</span><strong>${assignments.length}</strong></div>
        </div>
      </section>
      <section class="section-band">
        <div class="section-title"><h2>Linha do tempo</h2><small>${rows.length} eventos</small></div>
        ${rows.length ? `
          <div class="table-wrap">
            <table class="report-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th>Motorista</th>
                  <th>Valor</th>
                  <th>Estado / notas</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((row) => `
                  <tr>
                    <td>${h(dateTimeLabel(row.date))}</td>
                    <td data-label="Tipo"><span class="badge ${row.tone || ""}">${h(row.type)}</span></td>
                    <td data-label="Motorista">${h(row.driver || "—")}</td>
                    <td data-label="Valor">${row.amount ? h(money(row.amount)) : "—"}</td>
                    <td data-label="Notas">${h(row.notes || "")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : empty("Sem movimentos registados.")}
      </section>
    `;
  }

  function vehicleDocumentosView(vehicle) {
    const files = vehicle.files || {};
    const linkedDocs = state.documents.filter((doc) => doc.scope === "vehicle" && doc.vehicleId === vehicle.id);
    return `
      <section class="section-band">
        <div class="section-title">
          <h2>Documentos da viatura</h2>
          <a class="button secondary compact" href="#registar">${icon("plus")}Adicionar</a>
        </div>
        <div class="doc-grid">
          ${docCard("Livrete", files.booklet, vehicle.booklet)}
          ${docCard("Título de Propriedade", files.propertyTitle, vehicle.propertyTitle)}
          ${docCard("Seguro", files.insurancePolicy, vehicle.insurancePolicy)}
          ${docCard("Inspeção", files.inspection)}
          ${linkedDocs.map((doc) => docCard(doc.name, doc.file, doc.number, doc.expiresAt)).join("")}
          ${(!files.booklet?.url && !files.propertyTitle?.url && !files.insurancePolicy?.url && !files.inspection?.url && !linkedDocs.length) ? empty("Sem documentos anexados.") : ""}
        </div>
      </section>
    `;
  }

  function paymentsSummary(payments) {
    return payments.reduce((acc, payment) => {
      acc.received += Number(payment.amount || 0) + Number(payment.penaltyPaid || 0);
      acc.penaltiesPaid += Number(payment.penaltyPaid || 0);
      if (paymentPenalty(payment).delayHours > 0) acc.lateCount += 1;
      return acc;
    }, { received: 0, penaltiesPaid: 0, lateCount: 0 });
  }

  function buildDriverTimeline(driver, payments, events, assignments) {
    const rows = [];
    payments.forEach((payment) => {
      const penalty = paymentPenalty(payment);
      rows.push({
        date: payment.paidAt || payment.dueAt || payment.createdAt,
        type: "Entrega",
        tone: penalty.severity === "ok" ? "ok" : penalty.severity,
        vehicle: vehicleName(getVehicle(payment.vehicleId)),
        amount: Number(payment.amount || 0) + Number(payment.penaltyPaid || 0),
        notes: [penalty.label, payment.proof, payment.notes].filter(Boolean).join(" · "),
      });
    });
    events.forEach((event) => {
      rows.push({
        date: event.date || event.createdAt,
        type: `Ocorrência: ${eventLabel(event.type)}`,
        tone: event.status === "resolvido" ? "ok" : "warn",
        vehicle: vehicleName(getVehicle(event.vehicleId)),
        amount: Number(event.amount || 0),
        notes: [event.status, event.notes].filter(Boolean).join(" · "),
      });
    });
    assignments.forEach((assignment) => {
      rows.push({
        date: assignment.startAt || assignment.createdAt,
        type: assignment.status === "ativo" ? "Atribuição iniciada" : "Atribuição encerrada",
        tone: assignment.status === "ativo" ? "ok" : "",
        vehicle: vehicleName(getVehicle(assignment.vehicleId)),
        amount: Number(assignment.weeklyFee || 0),
        notes: assignment.notes || "",
      });
    });
    return rows.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  function buildVehicleTimeline(vehicle, payments, expenses, events, assignments) {
    const rows = [];
    payments.forEach((payment) => {
      const penalty = paymentPenalty(payment);
      rows.push({
        date: payment.paidAt || payment.dueAt || payment.createdAt,
        type: "Entrega",
        tone: penalty.severity === "ok" ? "ok" : penalty.severity,
        driver: driverName(getDriver(payment.driverId)),
        amount: Number(payment.amount || 0) + Number(payment.penaltyPaid || 0),
        notes: [penalty.label, payment.proof, payment.notes].filter(Boolean).join(" · "),
      });
    });
    expenses.forEach((expense) => {
      rows.push({
        date: expense.date || expense.createdAt,
        type: `Despesa ${expense.responsible === "motorista" ? "motorista" : "proprietária"}`,
        tone: expense.responsible === "proprietaria" ? "warn" : "",
        driver: expense.responsible === "motorista" ? driverName(getDriver(vehicle.driverId)) : "",
        amount: Number(expense.amount || 0),
        notes: [expense.category, expense.paidTo, expense.notes].filter(Boolean).join(" · "),
      });
    });
    events.forEach((event) => {
      rows.push({
        date: event.date || event.createdAt,
        type: `Ocorrência: ${eventLabel(event.type)}`,
        tone: event.status === "resolvido" ? "ok" : "warn",
        driver: driverName(getDriver(event.driverId)),
        amount: Number(event.amount || 0),
        notes: [event.status, event.notes].filter(Boolean).join(" · "),
      });
    });
    assignments.forEach((assignment) => {
      rows.push({
        date: assignment.startAt || assignment.createdAt,
        type: assignment.status === "ativo" ? "Atribuição iniciada" : "Atribuição encerrada",
        tone: assignment.status === "ativo" ? "ok" : "",
        driver: driverName(getDriver(assignment.driverId)),
        amount: Number(assignment.weeklyFee || 0),
        notes: assignment.notes || "",
      });
    });
    return rows.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  function infoRow(label, value) {
    if (value === null || value === undefined || value === "") return "";
    return `<div class="info-row"><dt>${h(label)}</dt><dd>${h(value)}</dd></div>`;
  }

  function docCard(title, upload, number = "", expiresAt = "") {
    const href = uploadUrl(upload);
    const status = expiresAt ? documentStatus({ expiresAt }) : null;
    const isImage = upload?.mimeType?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(upload?.url || "");
    return `
      <article class="doc-card ${href ? "" : "doc-empty"}">
        <div class="doc-preview">
          ${href && isImage ? `<img src="${h(href)}" alt="" loading="lazy" />` : `<span class="doc-icon">${icon("file")}</span>`}
        </div>
        <div class="doc-body">
          <strong>${h(title)}</strong>
          ${number ? `<small>${h(number)}</small>` : ""}
          <div class="badge-row">
            ${status ? `<span class="badge ${status.severity}">${h(status.label)}</span>` : ""}
            ${expiresAt ? `<span class="badge">${icon("calendar")}${h(dateLabel(expiresAt))}</span>` : ""}
          </div>
          ${href ? `<a class="button secondary compact" href="${h(href)}" target="_blank" rel="noopener" data-no-nav>${icon("file")}Abrir</a>` : `<span class="muted small">Sem ficheiro carregado.</span>`}
        </div>
      </article>
    `;
  }

  function renderContract() {
    const rules = [
      ["Objeto", "Viatura entregue para transporte público de passageiros em regime de táxi, sem vínculo laboral."],
      ["Vigência", `${state.settings.contractMonths} meses, renovação automática e período experimental de ${state.settings.trialDays} dias.`],
      ["Horário", "Segunda-feira não circula. Terça a quinta: 05h00-22h00. Sexta a domingo: 05h00-00h00."],
      ["Entrega semanal", `${money(state.settings.weeklyFee)} todas as segundas-feiras até ${state.settings.deliveryHour}, com comprovativo em até 12 horas.`],
      ["Atrasos", `${money(state.settings.penaltyLate24)} até 24h; ${money(state.settings.penaltyLate72)} entre 24h e 72h; acima de 72h pode haver resolução imediata.`],
      ["Despesas do motorista", "Combustível, lavagens correntes, pequenos consumíveis, multas por conduta, furos/alinhamento e refeições."],
      ["Despesas da proprietária", "Seguro, imposto, inspeção, licenciamento, manutenção programada e reparações por desgaste normal."],
      ["Sinistro", `Comunicação em até 2 horas. Franquia suportada pelo motorista até ${money(state.settings.deductibleLimit)} por sinistro.`],
      ["Furto ou roubo", "Queixa-crime em até 4 horas e comunicação imediata à proprietária."],
      ["Faltas graves", "Álcool, fins ilícitos, cedência a terceiros, manipulação de GPS, falsas declarações e reincidência fora de horário."],
    ];
    return `
      ${pageHead("Contrato", "Regras transformadas em alertas e controlos do sistema.")}
      <div class="grid-2">
        ${rules.map(([title, text]) => `
          <article class="contract-rule">
            <strong>${h(title)}</strong>
            <p>${h(text)}</p>
          </article>
        `).join("")}
      </div>
      <section class="section-band grid-2">
        <div>
          <div class="section-title"><h2>Documentos</h2><small>${state.documents.length}</small></div>
          <div class="record-list">
            ${state.documents.map(documentRecord).join("") || empty("Registe livrete, seguro, inspeção, BI e carta.")}
          </div>
        </div>
        <div>
          <div class="section-title"><h2>Ocorrências abertas</h2><small>${state.events.filter((event) => event.status === "aberto").length}</small></div>
          <div class="record-list">
            ${state.events.filter((event) => event.status === "aberto").map(eventRecord).join("") || empty("Nenhuma ocorrência aberta.")}
          </div>
        </div>
      </section>
    `;
  }

  function renderReports() {
    const tabs = [
      ["geral", "Visão geral"],
      ["motoristas", "Por motorista"],
      ["viaturas", "Por viatura"],
      ["semanas", "Por semana"],
      ["mensal", "Tendência"],
      ["movimentos", "Movimentos"],
    ];
    const views = {
      geral: reportOverview,
      motoristas: reportByDriver,
      viaturas: reportByVehicle,
      semanas: reportByWeek,
      mensal: reportTrend,
      movimentos: reportMovements,
    };
    const view = views[activeReportTab] || reportOverview;
    return `
      ${pageHead("Relatórios", "Detalhe por motorista, viatura, semana e mês.")}
      <div class="panel pad">
        <div class="filter-row">
          <div class="field">
            <label for="reportMonth">Mês</label>
            <input id="reportMonth" type="month" value="${h(activeReportMonth)}" data-report-month />
          </div>
          <button class="button secondary" type="button" data-action="export-csv">${icon("download")}CSV</button>
          <button class="button secondary" type="button" data-action="import-backup">${icon("upload")}Importar</button>
          <input class="sr-only" type="file" accept="application/json" data-backup-file />
        </div>
      </div>
      <div class="tabs">
        ${tabs.map(([id, label]) => `<button class="tab ${activeReportTab === id ? "active" : ""}" type="button" data-report-tab="${id}">${h(label)}</button>`).join("")}
      </div>
      ${view()}
    `;
  }

  function reportOverview() {
    const payments = currentMonthItems(state.payments, "paidAt");
    const expenses = currentMonthItems(state.expenses, "date");
    const events = currentMonthItems(state.events, "date");
    const received = payments.reduce((sum, payment) => sum + Number(payment.amount || 0) + Number(payment.penaltyPaid || 0), 0);
    const ownerCosts = expenses.filter((expense) => expense.responsible === "proprietaria").reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const driverCosts = expenses.filter((expense) => expense.responsible === "motorista").reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const penalties = payments.reduce((sum, payment) => sum + paymentPenalty(payment).amount, 0);
    const penaltiesPaid = payments.reduce((sum, payment) => sum + Number(payment.penaltyPaid || 0), 0);
    const expected = expectedForMonth(activeReportMonth);
    const net = received - ownerCosts;
    const margin = received > 0 ? Math.round((net / received) * 100) : 0;
    const compliance = expected > 0 ? Math.min(100, Math.round((received / expected) * 100)) : 0;

    const byDriver = aggregateByDriver(payments, expenses, events);
    const byVehicle = aggregateByVehicle(payments, expenses, events);
    const topDriver = byDriver[0];
    const topVehicle = byVehicle.slice().sort((a, b) => b.net - a.net)[0];
    const openEvents = state.events.filter((event) => event.status !== "resolvido").length;
    const overdue = state.payments.filter((payment) => !payment.paidAt && paymentPenalty(payment).delayHours > 0).length;

    return `
      <section class="section-band">
        <div class="kpi-strip">
          <div class="kpi"><span>Recebido</span><strong>${money(received)}</strong></div>
          <div class="kpi"><span>Esperado</span><strong>${money(expected)}</strong><small class="muted">${compliance}% cumprido</small></div>
          <div class="kpi"><span>Lucro líquido</span><strong>${money(net)}</strong><small class="muted">Margem ${margin}%</small></div>
          <div class="kpi"><span>Despesas proprietária</span><strong>${money(ownerCosts)}</strong></div>
          <div class="kpi"><span>Custos do motorista</span><strong>${money(driverCosts)}</strong></div>
          <div class="kpi"><span>Penalidades devidas</span><strong>${money(penalties)}</strong><small class="muted">${money(penaltiesPaid)} pagas</small></div>
          <div class="kpi"><span>Entregas</span><strong>${payments.length}</strong></div>
          <div class="kpi"><span>Ocorrências</span><strong>${events.length}</strong><small class="muted">${openEvents} abertas</small></div>
          <div class="kpi"><span>Atrasos pendentes</span><strong>${overdue}</strong></div>
        </div>
      </section>

      <section class="section-band grid-2">
        <div class="panel pad">
          <div class="section-title"><h2>Top motorista</h2><small>${h(monthLabel(activeReportMonth))}</small></div>
          ${topDriver ? `
            <article class="record clickable" data-nav="motorista" data-nav-id="${h(topDriver.id)}">
              <div class="record-main">
                <div class="record-lead">
                  ${driverAvatarHtml(topDriver.driver, "md")}
                  <div class="record-title">
                    <strong>${h(topDriver.name)}</strong>
                    <small>${topDriver.payments} entregas · ${money(topDriver.received)}</small>
                  </div>
                </div>
              </div>
              <div class="badge-row">
                <span class="badge ok">${money(topDriver.received)}</span>
                ${topDriver.penaltiesPaid ? `<span class="badge warn">${money(topDriver.penaltiesPaid)} penalidades</span>` : ""}
                ${topDriver.events ? `<span class="badge">${topDriver.events} ocorrências</span>` : ""}
              </div>
            </article>
          ` : empty("Sem entregas registadas neste mês.")}
        </div>
        <div class="panel pad">
          <div class="section-title"><h2>Viatura mais rentável</h2><small>${h(monthLabel(activeReportMonth))}</small></div>
          ${topVehicle ? `
            <article class="record clickable" data-nav="viatura" data-nav-id="${h(topVehicle.id)}">
              <div class="record-main">
                <div class="record-lead">
                  ${vehicleThumbHtml(topVehicle.vehicle)}
                  <div class="record-title">
                    <strong>${h(topVehicle.name)}</strong>
                    <small>${money(topVehicle.received)} − ${money(topVehicle.ownerCosts)} = ${money(topVehicle.net)}</small>
                  </div>
                </div>
              </div>
              <div class="badge-row">
                <span class="badge ok">${money(topVehicle.net)} lucro</span>
                ${topVehicle.events ? `<span class="badge">${topVehicle.events} ocorrências</span>` : ""}
              </div>
            </article>
          ` : empty("Sem dados suficientes neste mês.")}
        </div>
      </section>
    `;
  }

  function reportByDriver() {
    const payments = currentMonthItems(state.payments, "paidAt");
    const expenses = currentMonthItems(state.expenses, "date");
    const events = currentMonthItems(state.events, "date");
    const rows = aggregateByDriver(payments, expenses, events);
    const totalReceived = rows.reduce((sum, row) => sum + row.received, 0);
    return `
      <section class="section-band">
        <div class="section-title"><h2>Por motorista</h2><small>${h(monthLabel(activeReportMonth))} · ${rows.length} motoristas</small></div>
        ${rows.length ? `
          <div class="table-wrap">
            <table class="report-table">
              <thead>
                <tr>
                  <th>Motorista</th>
                  <th>Viatura</th>
                  <th>Entregas</th>
                  <th>Recebido</th>
                  <th>Penalidades pagas</th>
                  <th>Atrasos</th>
                  <th>Ocorrências</th>
                  <th>% total</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((row) => `
                  <tr class="clickable" data-nav="motorista" data-nav-id="${h(row.id)}">
                    <td><div class="cell-lead">${driverAvatarHtml(row.driver, "sm")}<span>${h(row.name)}</span></div></td>
                    <td data-label="Viatura">${h(row.vehicleName)}</td>
                    <td data-label="Entregas">${row.payments}</td>
                    <td data-label="Recebido">${h(money(row.received))}</td>
                    <td data-label="Penalidades">${h(money(row.penaltiesPaid))}</td>
                    <td data-label="Atrasos">${row.lateCount}</td>
                    <td data-label="Ocorrências">${row.events}</td>
                    <td data-label="% total">${totalReceived ? Math.round((row.received / totalReceived) * 100) : 0}%</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : empty("Nenhuma atividade de motoristas neste mês.")}
      </section>
    `;
  }

  function reportByVehicle() {
    const payments = currentMonthItems(state.payments, "paidAt");
    const expenses = currentMonthItems(state.expenses, "date");
    const events = currentMonthItems(state.events, "date");
    const rows = aggregateByVehicle(payments, expenses, events);
    return `
      <section class="section-band">
        <div class="section-title"><h2>Por viatura</h2><small>${h(monthLabel(activeReportMonth))} · ${rows.length} viaturas</small></div>
        ${rows.length ? `
          <div class="table-wrap">
            <table class="report-table">
              <thead>
                <tr>
                  <th>Viatura</th>
                  <th>Motorista</th>
                  <th>Entregas</th>
                  <th>Recebido</th>
                  <th>Despesas</th>
                  <th>Lucro</th>
                  <th>Ocorrências</th>
                  <th>Margem</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((row) => `
                  <tr class="clickable" data-nav="viatura" data-nav-id="${h(row.id)}">
                    <td><div class="cell-lead">${vehicleThumbHtml(row.vehicle)}<span>${h(row.name)}</span></div></td>
                    <td data-label="Motorista">${h(row.driverName)}</td>
                    <td data-label="Entregas">${row.payments}</td>
                    <td data-label="Recebido">${h(money(row.received))}</td>
                    <td data-label="Despesas">${h(money(row.ownerCosts))}</td>
                    <td data-label="Lucro" class="${row.net >= 0 ? "value-ok" : "value-danger"}">${h(money(row.net))}</td>
                    <td data-label="Ocorrências">${row.events}</td>
                    <td data-label="Margem">${row.received ? Math.round((row.net / row.received) * 100) : 0}%</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : empty("Nenhuma atividade de viaturas neste mês.")}
      </section>
    `;
  }

  function reportByWeek() {
    const weeks = buildWeeklyBuckets(8);
    const maxReceived = Math.max(1, ...weeks.map((week) => week.received));
    return `
      <section class="section-band">
        <div class="section-title"><h2>Últimas semanas</h2><small>${weeks.length} semanas</small></div>
        <div class="bar-list">
          ${weeks.map((week) => {
            const progressed = week.expected ? Math.min(100, Math.round((week.received / week.expected) * 100)) : 0;
            const barWidth = Math.round((week.received / maxReceived) * 100);
            return `
              <div class="bar-row">
                <div class="bar-head">
                  <strong>${h(week.label)}</strong>
                  <span class="muted small">${money(week.received)} / ${money(week.expected)} · ${progressed}%</span>
                </div>
                <div class="progress-bar"><span style="width:${barWidth}%"></span></div>
                <div class="bar-meta">
                  <span class="badge">${week.payments} entregas</span>
                  ${week.lateCount ? `<span class="badge warn">${week.lateCount} com atraso</span>` : ""}
                  ${week.missing ? `<span class="badge danger">${week.missing} em falta</span>` : ""}
                  ${week.penalties ? `<span class="badge">${money(week.penalties)} penalidade</span>` : ""}
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  function reportTrend() {
    const months = buildMonthlyBuckets(6);
    const maxNet = Math.max(1, ...months.map((month) => Math.abs(month.net)));
    return `
      <section class="section-band">
        <div class="section-title"><h2>Tendência mensal</h2><small>${months.length} meses</small></div>
        <div class="table-wrap">
          <table class="report-table">
            <thead>
              <tr>
                <th>Mês</th>
                <th>Recebido</th>
                <th>Despesas</th>
                <th>Lucro</th>
                <th>Entregas</th>
                <th>Ocorrências</th>
                <th>Tendência</th>
              </tr>
            </thead>
            <tbody>
              ${months.map((month) => `
                <tr>
                  <td>${h(monthLabel(month.key))}</td>
                  <td data-label="Recebido">${h(money(month.received))}</td>
                  <td data-label="Despesas">${h(money(month.ownerCosts))}</td>
                  <td data-label="Lucro" class="${month.net >= 0 ? "value-ok" : "value-danger"}">${h(money(month.net))}</td>
                  <td data-label="Entregas">${month.payments}</td>
                  <td data-label="Ocorrências">${month.events}</td>
                  <td data-label="Tendência">
                    <div class="mini-bar"><span style="width:${Math.round((Math.abs(month.net) / maxNet) * 100)}%; background:${month.net >= 0 ? "var(--ok)" : "var(--danger)"};"></span></div>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function reportMovements() {
    const payments = currentMonthItems(state.payments, "paidAt");
    const expenses = currentMonthItems(state.expenses, "date");
    const events = currentMonthItems(state.events, "date");
    return `
      <section class="section-band">
        <div class="section-title"><h2>Movimentos de ${h(monthLabel(activeReportMonth))}</h2><small>${payments.length + expenses.length + events.length} registos</small></div>
        <div class="table-wrap">
          <table class="report-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Viatura</th>
                <th>Motorista</th>
                <th>Valor</th>
                <th>Notas</th>
              </tr>
            </thead>
            <tbody>
              ${reportRows(payments, expenses, events)}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function aggregateByDriver(payments, expenses, events) {
    const map = new Map();
    const ensure = (driverId) => {
      const driver = getDriver(driverId);
      const id = driverId || "sem-motorista";
      if (!map.has(id)) {
        const vehicle = state.vehicles.find((v) => v.driverId === driverId);
        map.set(id, {
          id,
          driver,
          name: driver?.name || "Sem motorista",
          vehicleName: vehicleName(vehicle),
          payments: 0,
          received: 0,
          penaltiesPaid: 0,
          lateCount: 0,
          events: 0,
        });
      }
      return map.get(id);
    };

    payments.forEach((payment) => {
      const row = ensure(payment.driverId);
      row.payments += 1;
      row.received += Number(payment.amount || 0) + Number(payment.penaltyPaid || 0);
      row.penaltiesPaid += Number(payment.penaltyPaid || 0);
      if (paymentPenalty(payment).delayHours > 0) row.lateCount += 1;
    });
    events.forEach((event) => {
      if (!event.driverId) return;
      const row = ensure(event.driverId);
      row.events += 1;
    });

    return [...map.values()].filter((row) => row.driver || row.payments || row.events).sort((a, b) => b.received - a.received);
  }

  function aggregateByVehicle(payments, expenses, events) {
    const map = new Map();
    const ensure = (vehicleId) => {
      const vehicle = getVehicle(vehicleId);
      const id = vehicleId || "sem-viatura";
      if (!map.has(id)) {
        const driver = getDriver(vehicle?.driverId);
        map.set(id, {
          id,
          vehicle,
          name: vehicleName(vehicle),
          driverName: driverName(driver),
          payments: 0,
          received: 0,
          ownerCosts: 0,
          driverCosts: 0,
          events: 0,
          net: 0,
        });
      }
      return map.get(id);
    };

    payments.forEach((payment) => {
      const row = ensure(payment.vehicleId);
      row.payments += 1;
      row.received += Number(payment.amount || 0) + Number(payment.penaltyPaid || 0);
    });
    expenses.forEach((expense) => {
      const row = ensure(expense.vehicleId);
      const amount = Number(expense.amount || 0);
      if (expense.responsible === "proprietaria") row.ownerCosts += amount;
      else row.driverCosts += amount;
    });
    events.forEach((event) => {
      if (!event.vehicleId) return;
      const row = ensure(event.vehicleId);
      row.events += 1;
    });

    map.forEach((row) => { row.net = row.received - row.ownerCosts; });
    return [...map.values()].filter((row) => row.vehicle || row.payments || row.ownerCosts || row.events).sort((a, b) => b.received - a.received);
  }

  function buildWeeklyBuckets(weekCount) {
    const buckets = [];
    const today = new Date();
    const thisMonday = mondayOf(today);
    for (let i = weekCount - 1; i >= 0; i--) {
      const start = new Date(thisMonday);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      const label = `${new Intl.DateTimeFormat("pt-AO", { day: "2-digit", month: "short" }).format(start)} – ${new Intl.DateTimeFormat("pt-AO", { day: "2-digit", month: "short" }).format(new Date(end.getTime() - 86400000))}`;
      const weekPayments = state.payments.filter((payment) => {
        const due = new Date(payment.dueAt);
        return due >= start && due < end;
      });
      const received = weekPayments.reduce((sum, payment) => sum + Number(payment.amount || 0) + Number(payment.penaltyPaid || 0), 0);
      const penalties = weekPayments.reduce((sum, payment) => sum + paymentPenalty(payment).amount, 0);
      const lateCount = weekPayments.filter((payment) => paymentPenalty(payment).delayHours > 0).length;
      const activeCount = assignedVehiclesAt(start).length;
      const expected = activeCount * Number(state.settings.weeklyFee || 0);
      const missing = Math.max(0, activeCount - weekPayments.length);
      buckets.push({ start, end, label, payments: weekPayments.length, received, penalties, lateCount, expected, missing });
    }
    return buckets;
  }

  function buildMonthlyBuckets(monthCount) {
    const buckets = [];
    const ref = new Date();
    ref.setDate(1);
    for (let i = monthCount - 1; i >= 0; i--) {
      const date = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
      const key = monthValue(date);
      const payments = state.payments.filter((payment) => monthValue(new Date(payment.paidAt || payment.dueAt || payment.createdAt)) === key);
      const expenses = state.expenses.filter((expense) => monthValue(new Date(expense.date || expense.createdAt)) === key);
      const events = state.events.filter((event) => monthValue(new Date(event.date || event.createdAt)) === key);
      const received = payments.reduce((sum, payment) => sum + Number(payment.amount || 0) + Number(payment.penaltyPaid || 0), 0);
      const ownerCosts = expenses.filter((expense) => expense.responsible === "proprietaria").reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
      buckets.push({ key, payments: payments.length, received, ownerCosts, net: received - ownerCosts, events: events.length });
    }
    return buckets;
  }

  function assignedVehiclesAt(date) {
    return state.assignments.filter((assignment) => {
      const start = new Date(assignment.startAt);
      const end = assignment.endedAt ? new Date(assignment.endedAt) : null;
      return start <= date && (!end || end >= date);
    });
  }

  function expectedForMonth(key) {
    const [year, month] = key.split("-").map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    let weeks = 0;
    const cursor = mondayOf(start);
    while (cursor < end) {
      const count = assignedVehiclesAt(new Date(cursor)).length;
      weeks += count;
      cursor.setDate(cursor.getDate() + 7);
    }
    return weeks * Number(state.settings.weeklyFee || 0);
  }

  function reportRows(payments, expenses, events) {
    const rows = [
      ...payments.map((payment) => ({
        date: payment.paidAt,
        type: "Entrega",
        vehicle: vehicleName(getVehicle(payment.vehicleId)),
        driver: driverName(getDriver(payment.driverId)),
        amount: Number(payment.amount || 0) + Number(payment.penaltyPaid || 0),
        notes: payment.notes || payment.proof || "",
      })),
      ...expenses.map((expense) => ({
        date: expense.date,
        type: `Despesa ${expense.responsible === "motorista" ? "motorista" : "proprietária"}`,
        vehicle: vehicleName(getVehicle(expense.vehicleId)),
        driver: "",
        amount: Number(expense.amount || 0),
        notes: expense.notes || expenseCategoryLabel(expense.category) || "",
      })),
      ...events.map((event) => ({
        date: event.date,
        type: `Ocorrência: ${event.type}`,
        vehicle: vehicleName(getVehicle(event.vehicleId)),
        driver: driverName(getDriver(event.driverId)),
        amount: Number(event.amount || 0),
        notes: event.notes || "",
      })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (!rows.length) return `<tr><td colspan="6">Sem movimentos neste mês.</td></tr>`;
    return rows.map((row) => `
      <tr>
        <td>${h(dateLabel(row.date))}</td>
        <td data-label="Tipo">${h(row.type)}</td>
        <td data-label="Viatura">${h(row.vehicle)}</td>
        <td data-label="Motorista">${h(row.driver)}</td>
        <td data-label="Valor">${h(money(row.amount))}</td>
        <td data-label="Notas">${h(row.notes)}</td>
      </tr>
    `).join("");
  }

  function vehicleImageUrl(vehicle) {
    if (!vehicle) return "";
    const custom = vehicle.files?.photo;
    if (custom?.url) return uploadUrl(custom);
    if (!vehicle.brand && !vehicle.model) return "";
    const make = encodeURIComponent((vehicle.brand || "").trim());
    const model = encodeURIComponent((vehicle.model || "").trim());
    const year = vehicle.year ? `&modelYear=${encodeURIComponent(vehicle.year)}` : "";
    return `https://cdn.imagin.studio/getimage?customer=img&make=${make}&modelFamily=${model}${year}&angle=23&zoomType=fullscreen&billingTag=catalog`;
  }

  function vehicleThumbHtml(vehicle) {
    const src = vehicleImageUrl(vehicle);
    const fallback = `<span class="thumb-fallback">${icon("car")}</span>`;
    if (!src) return `<span class="record-thumb">${fallback}</span>`;
    return `<span class="record-thumb"><img src="${h(src)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('thumb-missing');this.remove();" />${fallback}</span>`;
  }

  function driverPhotoUrl(driver) {
    const upload = driver?.files?.photo;
    return upload?.url ? uploadUrl(upload) : "";
  }

  function driverAvatarHtml(driver, size = "md") {
    const src = driverPhotoUrl(driver);
    const initials = (driver?.name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?";
    const cls = `avatar avatar-${size}`;
    if (src) return `<span class="${cls}"><img src="${h(src)}" alt="" loading="lazy" /></span>`;
    return `<span class="${cls} avatar-initials">${h(initials)}</span>`;
  }

  function vehicleRecord(vehicle) {
    const driver = getDriver(vehicle.driverId);
    const files = vehicle.files || {};
    const assignment = activeAssignmentForVehicle(vehicle.id);
    const thumb = vehicleThumbHtml(vehicle);
    return `
      <article class="record clickable" data-nav="viatura" data-nav-id="${h(vehicle.id)}">
        <div class="record-main">
          <div class="record-lead">
            ${thumb}
            <div class="record-title">
              <strong>${h(vehicleName(vehicle))}</strong>
              <small>${h(driverName(driver))} · ${h(vehicle.mileage || "0")} km</small>
            </div>
          </div>
          <div class="record-actions">
            <button class="icon-button" type="button" title="Remover" data-delete="vehicle" data-id="${h(vehicle.id)}">${icon("trash")}</button>
          </div>
        </div>
        <div class="badge-row">
          <span class="badge ${vehicle.status === "ativo" ? "ok" : "warn"}">${h(vehicle.status)}</span>
          ${assignment ? `<span class="badge ok">${icon("calendar")}Atribuída desde ${h(dateLabel(assignment.startAt))}</span>` : ""}
          ${vehicle.chassis ? `<span class="badge">Chassis ${h(vehicle.chassis)}</span>` : ""}
          ${vehicle.insurancePolicy ? `<span class="badge">Seguro ${h(vehicle.insurancePolicy)}</span>` : ""}
          ${vehicle.booklet ? `<span class="badge">Livrete ${h(vehicle.booklet)}</span>` : ""}
          ${vehicle.propertyTitle ? `<span class="badge">Título ${h(vehicle.propertyTitle)}</span>` : ""}
          ${fileBadge(files.booklet, "Livrete")}
          ${fileBadge(files.propertyTitle, "Título")}
          ${fileBadge(files.insurancePolicy, "Seguro")}
          ${fileBadge(files.inspection, "Inspeção")}
        </div>
      </article>
    `;
  }

  function driverRecord(driver) {
    const assigned = state.vehicles.find((vehicle) => vehicle.driverId === driver.id);
    const assignment = activeAssignmentForDriver(driver.id);
    const files = driver.files || {};
    const contacts = Array.isArray(driver.contacts) ? driver.contacts : [];
    const mapHref = residenceMapUrl(driver.addressLocation);
    return `
      <article class="record clickable" data-nav="motorista" data-nav-id="${h(driver.id)}">
        <div class="record-main">
          <div class="record-lead">
            ${driverAvatarHtml(driver, "sm")}
            <div class="record-title">
              <strong>${h(driver.name || "Motorista sem nome")}</strong>
              <small>${h(driver.phone || "Sem telefone")} · ${h(vehicleName(assigned))}</small>
            </div>
          </div>
          <div class="record-actions">
            <button class="icon-button" type="button" title="Remover" data-delete="driver" data-id="${h(driver.id)}">${icon("trash")}</button>
          </div>
        </div>
        <div class="badge-row">
          <span class="badge">${icon("shield")}Caução ${money(driver.deposit)}</span>
          ${assignment ? `<span class="badge ok">${icon("car")}${h(vehicleName(getVehicle(assignment.vehicleId)))}</span>` : ""}
          ${driver.licenseValid ? `<span class="badge ${documentStatus({ expiresAt: driver.licenseValid }).severity}">Carta ${h(documentStatus({ expiresAt: driver.licenseValid }).label)}</span>` : ""}
          ${driver.contractStart ? `<span class="badge">${icon("calendar")}${h(dateLabel(driver.contractStart))}</span>` : ""}
          ${driver.address ? `<span class="badge">${icon("location")}${h(driver.address)}</span>` : ""}
          ${mapHref ? `<a class="badge file-badge" href="${h(mapHref)}" target="_blank" rel="noopener">${icon("location")}GPS residência</a>` : ""}
          ${contacts.map(contactBadge).join("")}
          ${fileBadge(files.bi, "BI")}
          ${fileBadge(files.license, "Carta")}
        </div>
      </article>
    `;
  }

  function assignmentRecord(assignment) {
    const vehicle = getVehicle(assignment.vehicleId);
    const driver = getDriver(assignment.driverId);
    const docs = assignmentDocuments(assignment);
    const active = assignment.status === "ativo";
    return `
      <article class="record">
        <div class="record-main">
          <div class="record-title">
            <strong>${h(vehicleName(vehicle))}</strong>
            <small>${h(driverName(driver))} · ${h(dateTimeLabel(assignment.startAt))}</small>
          </div>
          <div class="record-actions">
            ${active ? `<button class="button secondary compact" type="button" data-action="close-assignment" data-id="${h(assignment.id)}">${icon("check")}Encerrar</button>` : ""}
            <button class="icon-button" type="button" title="Remover" data-delete="assignment" data-id="${h(assignment.id)}">${icon("trash")}</button>
          </div>
        </div>
        <div class="badge-row">
          <span class="badge ${active ? "ok" : ""}">${h(active ? "Ativa" : assignment.status || "Histórico")}</span>
          <span class="badge">${icon("wallet")}${money(assignment.weeklyFee || state.settings.weeklyFee)}</span>
          ${assignment.depositReceived ? `<span class="badge">${icon("shield")}Caução ${money(assignment.depositReceived)}</span>` : ""}
          ${assignment.handoverMileage ? `<span class="badge">${h(assignment.handoverMileage)} km</span>` : ""}
          ${assignment.fuelLevel ? `<span class="badge">${h(fuelLabel(assignment.fuelLevel))}</span>` : ""}
          ${docs.length ? `<span class="badge">${icon("file")}${h(docs.join(", "))}</span>` : ""}
          ${assignment.endedAt ? `<span class="badge">${icon("calendar")}Encerrada ${h(dateTimeLabel(assignment.endedAt))}</span>` : ""}
          ${assignment.notes ? `<span class="badge">${h(assignment.notes)}</span>` : ""}
        </div>
      </article>
    `;
  }

  function paymentRecord(payment, compact = false) {
    const penalty = paymentPenalty(payment);
    return `
      <article class="record">
        <div class="record-main">
          <div class="record-title">
            <strong>${money(payment.amount)}</strong>
            <small>${h(driverName(getDriver(payment.driverId)))} · ${h(vehicleName(getVehicle(payment.vehicleId)))}</small>
          </div>
          ${compact ? "" : `<button class="icon-button" type="button" title="Remover" data-delete="payment" data-id="${h(payment.id)}">${icon("trash")}</button>`}
        </div>
        <div class="badge-row">
          <span class="badge ${penalty.severity}">${h(penalty.label)}</span>
          <span class="badge">${icon("calendar")}${h(dateTimeLabel(payment.paidAt || payment.dueAt))}</span>
          ${payment.proof ? `<span class="badge">${h(payment.proof)}</span>` : ""}
          ${fileBadge(payment.files?.proof, "Comprovativo")}
        </div>
      </article>
    `;
  }

  function expenseRecord(expense) {
    return `
      <article class="record">
        <div class="record-main">
          <div class="record-title">
            <strong>${money(expense.amount)}</strong>
            <small>${h(expenseCategoryLabel(expense.category))} · ${h(vehicleName(getVehicle(expense.vehicleId)))}</small>
          </div>
          <button class="icon-button" type="button" title="Remover" data-delete="expense" data-id="${h(expense.id)}">${icon("trash")}</button>
        </div>
        <div class="badge-row">
          <span class="badge ${expense.responsible === "proprietaria" ? "warn" : ""}">${h(expense.responsible === "proprietaria" ? "Proprietária" : "Motorista")}</span>
          <span class="badge">${h(dateLabel(expense.date))}</span>
          ${expense.batchId ? `<span class="badge">${icon("car")}Despesa em lote</span>` : ""}
        </div>
      </article>
    `;
  }

  function eventRecord(event, compact = false) {
    const tone = event.status === "resolvido" ? "ok" : "warn";
    return `
      <article class="record">
        <div class="record-main">
          <div class="record-title">
            <strong>${h(eventLabel(event.type))}</strong>
            <small>${h(vehicleName(getVehicle(event.vehicleId)))} · ${h(driverName(getDriver(event.driverId)))}</small>
          </div>
          ${compact ? "" : `<button class="icon-button" type="button" title="Remover" data-delete="event" data-id="${h(event.id)}">${icon("trash")}</button>`}
        </div>
        <div class="badge-row">
          <span class="badge ${tone}">${h(event.status)}</span>
          ${event.amount ? `<span class="badge">${money(event.amount)}</span>` : ""}
          ${event.immobilizeVehicle ? `<span class="badge danger">${icon("wrench")}Viatura imobilizada</span>` : ""}
          ${event.releaseAssignment ? `<span class="badge warn">${icon("check")}Atribuição encerrada</span>` : ""}
          <span class="badge">${h(dateTimeLabel(event.date))}</span>
        </div>
      </article>
    `;
  }

  function documentRecord(doc) {
    const status = documentStatus(doc);
    const owner = doc.scope === "driver" ? driverName(getDriver(doc.driverId)) : doc.scope === "vehicle" ? vehicleName(getVehicle(doc.vehicleId)) : state.company.name;
    return `
      <article class="record">
        <div class="record-main">
          <div class="record-title">
            <strong>${h(doc.name)}</strong>
            <small>${h(owner)}</small>
          </div>
          <button class="icon-button" type="button" title="Remover" data-delete="document" data-id="${h(doc.id)}">${icon("trash")}</button>
        </div>
        <div class="badge-row">
          <span class="badge ${status.severity}">${h(status.label)}</span>
          ${doc.number ? `<span class="badge">${h(doc.number)}</span>` : ""}
          ${doc.expiresAt ? `<span class="badge">${h(dateLabel(doc.expiresAt))}</span>` : ""}
          ${fileBadge(doc.file, "Abrir ficheiro")}
        </div>
      </article>
    `;
  }

  function eventLabel(value) {
    const map = {
      sinistro: "Acidente/sinistro",
      avaria: "Avaria",
      multa: "Multa",
      fora_horario: "Fora de horário",
      vistoria: "Vistoria",
      gps: "GPS/manipulação",
      furto: "Furto/roubo",
      outro: "Outro",
    };
    return map[value] || value;
  }

  function expenseCategoryLabel(value) {
    const map = {
      combustivel: "Combustível",
      lavagem: "Lavagem",
      manutencao: "Manutenção",
      pneu: "Pneu/alinhamento",
      seguro: "Seguro/documento",
      multa: "Multa/coima",
      operacional: "Operacional geral",
      documentacao: "Documentação",
      outro: "Outro",
    };
    return map[value] || value;
  }

  function inputField(name, label, type, value = "", attrs = "") {
    const id = `${name}-${Math.random().toString(16).slice(2)}`;
    const classMatch = attrs.match(/class='([^']+)'/);
    const className = classMatch ? classMatch[1] : "";
    const cleanedAttrs = attrs.replace(/class='[^']+'/g, "");
    return `
      <div class="field ${h(className)}">
        <label for="${id}">${h(label)}</label>
        <input id="${id}" name="${h(name)}" type="${h(type)}" value="${h(value)}" ${cleanedAttrs} />
      </div>
    `;
  }

  function selectField(name, label, options, selected = "", attrs = "") {
    const id = `${name}-${Math.random().toString(16).slice(2)}`;
    const classMatch = attrs.match(/class='([^']+)'/);
    const className = classMatch ? classMatch[1] : "";
    const cleanedAttrs = attrs.replace(/class='[^']+'/g, "");
    const selectedOption = options.find(([value]) => String(value) === String(selected)) || options[0] || ["", "Selecionar"];
    return `
      <div class="field ${h(className)}">
        <label for="${id}">${h(label)}</label>
        <div class="combo" data-combo>
          <input id="${id}" name="${h(name)}" type="hidden" value="${h(selectedOption[0])}" ${cleanedAttrs} />
          <button class="combo-trigger" type="button" data-combo-trigger aria-haspopup="listbox" aria-expanded="false">
            <span data-combo-label>${h(selectedOption[1])}</span>
          </button>
          <div class="combo-menu" data-combo-menu hidden>
            <input class="combo-search" type="search" placeholder="Pesquisar..." autocomplete="off" data-combo-search />
            <div class="combo-options" role="listbox">
              ${options.map(([value, text]) => `
                <button class="combo-option ${String(value) === String(selectedOption[0]) ? "selected" : ""}" type="button" role="option" data-combo-option data-value="${h(value)}" data-label="${h(text)}">${h(text)}</button>
              `).join("")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function fileField(name, label, attrs = "") {
    const id = `${name}-${Math.random().toString(16).slice(2)}`;
    const classMatch = attrs.match(/class='([^']+)'/);
    const className = classMatch ? classMatch[1] : "";
    const cleanedAttrs = attrs.replace(/class='[^']+'/g, "");
    return `
      <div class="field file-field ${h(className)}">
        <label for="${id}">${h(label)}</label>
        <input id="${id}" name="${h(name)}" type="file" ${cleanedAttrs} />
      </div>
    `;
  }

  function checkboxField(name, label, checked = true) {
    const id = `${name}-${Math.random().toString(16).slice(2)}`;
    return `
      <label class="check-item" for="${id}">
        <input id="${id}" name="${h(name)}" type="checkbox" value="1" ${checked ? "checked" : ""} />
        <span>${h(label)}</span>
      </label>
    `;
  }

  function phoneField(name, label, value = "") {
    const id = `${name}-${Math.random().toString(16).slice(2)}`;
    return `
      <div class="field">
        <label for="${id}">${h(label)}</label>
        <div class="phone-input">
          <span>+244</span>
          <input id="${id}" name="${h(name)}" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="11" placeholder="923 000 000" value="${h(value)}" />
        </div>
      </div>
    `;
  }

  function locationField(prefill = {}) {
    const id = `address-${Math.random().toString(16).slice(2)}`;
    const lat = prefill.latitude || "";
    const lng = prefill.longitude || "";
    const statusLabel = (lat && lng) ? "GPS marcado" : "GPS por marcar";
    return `
      <div class="field span-3">
        <label for="${id}">Residência</label>
        <div class="location-input">
          <input id="${id}" name="address" type="text" placeholder="Bairro, rua, casa..." value="${h(prefill.address || "")}" />
          <button class="icon-button" type="button" data-action="capture-location" title="Marcar GPS">${icon("location")}</button>
        </div>
        <input type="hidden" name="addressLatitude" data-location-lat value="${h(lat)}" />
        <input type="hidden" name="addressLongitude" data-location-lng value="${h(lng)}" />
        <small class="location-status" data-location-status>${h(statusLabel)}</small>
      </div>
    `;
  }

  function extractLocalPhone(value) {
    return String(value || "")
      .replace(/^\+?244/, "")
      .replace(/\D/g, "");
  }

  function contactRelationOptions() {
    return [
      ["esposa", "Esposa"],
      ["marido", "Marido"],
      ["irmao", "Irmão"],
      ["irma", "Irmã"],
      ["familiar", "Familiar"],
      ["amigo", "Amigo"],
      ["outro", "Outro"],
    ];
  }

  function fuelOptions() {
    return [
      ["vazio", "Vazio"],
      ["quarto", "1/4"],
      ["meio", "1/2"],
      ["tres_quartos", "3/4"],
      ["cheio", "Cheio"],
    ];
  }

  function fuelLabel(value) {
    return Object.fromEntries(fuelOptions())[value] || value || "Sem combustível";
  }

  function selectedFile(data, name) {
    const file = data[name];
    return file instanceof File && file.size > 0 ? file : null;
  }

  function normalizeAngolaPhone(value) {
    const rawDigits = String(value || "").replace(/\D/g, "");
    const digits = rawDigits.startsWith("244") ? rawDigits.slice(3) : rawDigits;
    if (!digits) return "";
    return `+244 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`.trim();
  }

  function contactRelationLabel(value) {
    return Object.fromEntries(contactRelationOptions())[value] || value || "Contacto";
  }

  function buildContact(name, relation, phone) {
    const normalizedPhone = normalizeAngolaPhone(phone);
    if (!name && !normalizedPhone) return null;
    return { name, relation, phone: normalizedPhone };
  }

  function contactBadge(contact) {
    const relation = contactRelationLabel(contact.relation);
    const name = contact.name ? `${contact.name} · ` : "";
    return `<span class="badge">${icon("users")}${h(name)}${h(relation)}${contact.phone ? ` · ${h(contact.phone)}` : ""}</span>`;
  }

  function assignmentDocuments(assignment) {
    const docs = assignment.documents || {};
    return [
      docs.booklet ? "Livrete" : "",
      docs.insurance ? "Seguro" : "",
      docs.inspection ? "Inspeção" : "",
      docs.license ? "Licença táxi" : "",
      assignment.keysDelivered ? "Chaves" : "",
      assignment.gpsConfirmed ? "GPS" : "",
    ].filter(Boolean);
  }

  function closeOpenAssignment(assignment, endedAt, reason) {
    if (!assignment || assignment.status !== "ativo") return assignment;
    return {
      ...assignment,
      status: reason === "substituida" ? "substituida" : "encerrada",
      endedAt,
      endReason: reason,
    };
  }

  function addressLocationFromData(data) {
    const latitude = Number(data.addressLatitude);
    const longitude = Number(data.addressLongitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      latitude,
      longitude,
      capturedAt: new Date().toISOString(),
    };
  }

  function residenceMapUrl(location) {
    const latitude = Number(location?.latitude);
    const longitude = Number(location?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
    return `https://www.google.com/maps?q=${latitude},${longitude}`;
  }

  function currentPosition(options) {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
  }

  async function captureResidenceLocation(form, button) {
    if (!navigator.geolocation) {
      toast("GPS indisponível neste aparelho.");
      return;
    }

    const latitudeInput = form?.querySelector("[data-location-lat]");
    const longitudeInput = form?.querySelector("[data-location-lng]");
    const status = form?.querySelector("[data-location-status]");
    if (!latitudeInput || !longitudeInput) return;

    try {
      button.disabled = true;
      if (status) status.textContent = "A marcar GPS...";
      const position = await currentPosition({
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60000,
      });
      const latitude = position.coords.latitude.toFixed(6);
      const longitude = position.coords.longitude.toFixed(6);
      latitudeInput.value = latitude;
      longitudeInput.value = longitude;
      if (status) status.textContent = `GPS marcado: ${latitude}, ${longitude}`;
      toast("Localização GPS marcada.");
    } catch (error) {
      console.warn(error);
      if (status) status.textContent = "GPS por marcar";
      toast("Não foi possível marcar o GPS.");
    } finally {
      button.disabled = false;
    }
  }

  async function uploadFile(file, category) {
    if (!file) return null;
    const payload = new FormData();
    payload.append("category", category);
    payload.append("file", file);

    const response = await fetch(apiUrl("/api/uploads"), {
      method: "POST",
      body: payload,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Não foi possível enviar o ficheiro.");
    }

    return response.json();
  }

  function uploadUrl(upload) {
    if (!upload?.url) return "";
    return upload.url.startsWith("http") ? upload.url : `${API_BASE_URL}${upload.url}`;
  }

  function fileBadge(upload, label) {
    const href = uploadUrl(upload);
    if (!href) return "";
    return `<a class="badge file-badge" href="${h(href)}" target="_blank" rel="noopener">${icon("file")}${h(label)}</a>`;
  }

  function vehiclesAvailableForAssignment() {
    return state.vehicles.filter((vehicle) => (
      !vehicle.driverId
      && !activeAssignmentForVehicle(vehicle.id)
      && !["imobilizado", "manutencao"].includes(vehicle.status)
    ));
  }

  function driversAvailableForAssignment() {
    return state.drivers.filter((driver) => !activeAssignmentForDriver(driver.id));
  }

  function vehicleOptions(includeBlank = false, filters = {}) {
    const source = filters.availableOnly ? vehiclesAvailableForAssignment() : state.vehicles;
    const options = source.map((vehicle) => [vehicle.id, vehicleName(vehicle)]);
    return includeBlank ? [["", "Sem viatura"], ...options] : options;
  }

  function driverOptions(includeBlank = false, filters = {}) {
    let source = filters.availableOnly ? driversAvailableForAssignment() : state.drivers;
    if (filters.assignedOnly) source = source.filter((driver) => activeAssignmentForDriver(driver.id));
    const options = source.map((driver) => [driver.id, driverName(driver)]);
    return includeBlank ? [["", "Sem motorista"], ...options] : options;
  }

  function empty(text) {
    return `<div class="empty-state">${h(text)}</div>`;
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  async function addPayment(data) {
    const assignment = activeAssignmentForDriver(data.driverId);
    const vehicleId = data.vehicleId || assignment?.vehicleId || "";
    if (!data.driverId || !vehicleId) {
      throw new Error("Escolha um motorista com viatura atribuída.");
    }
    const proofFile = await uploadFile(selectedFile(data, "proofFile"), "entrega-comprovativo");
    state.payments.push({
      id: uid(),
      vehicleId,
      driverId: data.driverId,
      amount: Number(data.amount || 0),
      penaltyPaid: Number(data.penaltyPaid || 0),
      dueAt: data.dueAt ? new Date(data.dueAt).toISOString() : dueDateTime().toISOString(),
      paidAt: data.paidAt ? new Date(data.paidAt).toISOString() : "",
      proof: data.proof,
      files: {
        proof: proofFile,
      },
      notes: data.notes,
      createdAt: new Date().toISOString(),
    });
    persist();
    toast("Entrega semanal guardada.");
  }

  function addExpense(data) {
    const vehicles = data.vehicleScope === "all"
      ? state.vehicles.filter((vehicle) => vehicle.status !== "imobilizado")
      : [getVehicle(data.vehicleId)].filter(Boolean);
    if (!vehicles.length) {
      throw new Error("Escolha uma viatura válida para a despesa.");
    }
    const batchId = data.vehicleScope === "all" ? uid() : "";
    vehicles.forEach((vehicle) => state.expenses.push({
      id: uid(),
      batchId,
      vehicleId: vehicle.id,
      date: data.date || toDateInput(),
      category: data.category,
      responsible: data.responsible,
      amount: Number(data.amount || 0),
      paidTo: data.paidTo,
      notes: data.notes,
      createdAt: new Date().toISOString(),
    }));
    persist();
    toast(vehicles.length > 1 ? `Despesa aplicada a ${vehicles.length} viaturas.` : "Despesa guardada.");
  }

  function addEvent(data) {
    const amount = data.type === "fora_horario" && !data.amount ? state.settings.fineOffHours : Number(data.amount || 0);
    const now = new Date().toISOString();
    state.events.push({
      id: uid(),
      vehicleId: data.vehicleId,
      driverId: data.driverId,
      date: data.date ? new Date(data.date).toISOString() : new Date().toISOString(),
      type: data.type,
      amount,
      status: data.status,
      immobilizeVehicle: Boolean(data.immobilizeVehicle),
      releaseAssignment: Boolean(data.releaseAssignment),
      notes: data.notes,
      createdAt: now,
    });
    if (data.vehicleId && data.immobilizeVehicle) {
      const activeAssignment = activeAssignmentForVehicle(data.vehicleId);
      state.vehicles = state.vehicles.map((vehicle) => (
        vehicle.id === data.vehicleId
          ? { ...vehicle, status: "imobilizado", driverId: data.releaseAssignment ? "" : vehicle.driverId }
          : vehicle
      ));
      if (data.releaseAssignment && activeAssignment) {
        state.assignments = state.assignments.map((assignment) => (
          assignment.id === activeAssignment.id ? closeOpenAssignment(assignment, now, "sinistro") : assignment
        ));
      }
    }
    persist();
    toast(data.immobilizeVehicle ? "Ocorrência guardada e viatura imobilizada." : "Ocorrência guardada.");
  }

  async function addDocument(data) {
    const file = await uploadFile(selectedFile(data, "documentFile"), `documento-${data.scope}`);
    state.documents.push({
      id: uid(),
      scope: data.scope,
      vehicleId: data.scope === "vehicle" ? data.vehicleId : "",
      driverId: data.scope === "driver" ? data.driverId : "",
      name: data.name,
      number: data.number,
      expiresAt: data.expiresAt,
      file,
      notes: data.notes,
      createdAt: new Date().toISOString(),
    });
    persist();
    toast("Documento guardado.");
  }

  function addAssignment(data) {
    const vehicle = getVehicle(data.vehicleId);
    const driver = getDriver(data.driverId);
    if (!vehicle || !driver) {
      throw new Error("Escolha uma viatura e um motorista válidos.");
    }
    if (activeAssignmentForVehicle(vehicle.id) || vehicle.driverId) {
      throw new Error("Esta viatura já está atribuída. Encerre a atribuição atual primeiro.");
    }
    if (activeAssignmentForDriver(driver.id)) {
      throw new Error("Este motorista já tem uma viatura atribuída.");
    }
    if (["imobilizado", "manutencao"].includes(vehicle.status)) {
      throw new Error("Esta viatura não está disponível para atribuição.");
    }

    const startAt = data.startAt ? new Date(data.startAt).toISOString() : new Date().toISOString();
    const now = new Date().toISOString();

    state.vehicles = state.vehicles.map((item) => {
      if (item.id === vehicle.id) {
        return {
          ...item,
          driverId: driver.id,
          status: "ativo",
          mileage: data.handoverMileage || item.mileage,
          assignedAt: startAt,
        };
      }
      if (item.driverId === driver.id) {
        return { ...item, driverId: "" };
      }
      return item;
    });

    state.assignments.push({
      id: uid(),
      vehicleId: vehicle.id,
      driverId: driver.id,
      startAt,
      weeklyFee: Number(data.weeklyFee || state.settings.weeklyFee),
      depositReceived: Number(data.depositReceived || 0),
      handoverMileage: data.handoverMileage,
      fuelLevel: data.fuelLevel,
      documents: {
        booklet: Boolean(data.docBooklet),
        insurance: Boolean(data.docInsurance),
        inspection: Boolean(data.docInspection),
        license: Boolean(data.docLicense),
      },
      keysDelivered: Boolean(data.keysDelivered),
      gpsConfirmed: Boolean(data.gpsConfirmed),
      status: "ativo",
      notes: data.notes,
      createdAt: now,
    });

    persist();
    toast("Viatura atribuída ao motorista.");
  }

  async function addVehicle(data) {
    const existing = data.id ? getVehicle(data.id) : null;
    const [photoFile, bookletFile, propertyTitleFile, insuranceFile, inspectionFile] = await Promise.all([
      uploadFile(selectedFile(data, "photoFile"), "viatura-foto"),
      uploadFile(selectedFile(data, "bookletFile"), "viatura-livrete"),
      uploadFile(selectedFile(data, "propertyTitleFile"), "viatura-titulo"),
      uploadFile(selectedFile(data, "insuranceFile"), "viatura-seguro"),
      uploadFile(selectedFile(data, "inspectionFile"), "viatura-inspecao"),
    ]);

    const baseFiles = existing?.files || {};
    const record = {
      id: existing?.id || uid(),
      brand: data.brand,
      model: data.model,
      plate: data.plate,
      color: data.color,
      year: data.year,
      chassis: data.chassis,
      mileage: data.mileage,
      driverId: data.driverId,
      status: data.status,
      booklet: data.booklet,
      propertyTitle: data.propertyTitle,
      insurancePolicy: data.insurancePolicy,
      files: {
        photo: photoFile || baseFiles.photo,
        booklet: bookletFile || baseFiles.booklet,
        propertyTitle: propertyTitleFile || baseFiles.propertyTitle,
        insurancePolicy: insuranceFile || baseFiles.insurancePolicy,
        inspection: inspectionFile || baseFiles.inspection,
      },
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (existing) {
      state.vehicles = state.vehicles.map((vehicle) => vehicle.id === existing.id ? record : vehicle);
      toast("Viatura atualizada.");
    } else {
      state.vehicles.push(record);
      toast("Viatura guardada.");
    }
    persist();
  }

  async function addDriver(data) {
    const existing = data.id ? getDriver(data.id) : null;
    const [photoFile, biFile, licenseFile] = await Promise.all([
      uploadFile(selectedFile(data, "photoFile"), "motorista-foto"),
      uploadFile(selectedFile(data, "biFile"), "motorista-bi"),
      uploadFile(selectedFile(data, "licenseFile"), "motorista-carta"),
    ]);

    const baseFiles = existing?.files || {};
    const record = {
      id: existing?.id || uid(),
      name: data.name,
      phone: normalizeAngolaPhone(data.phoneLocal),
      bi: data.bi,
      biValid: data.biValid,
      license: data.license,
      licenseValid: data.licenseValid,
      category: data.category,
      nif: data.nif,
      deposit: Number(data.deposit || 0),
      contractStart: data.contractStart,
      address: data.address,
      addressLocation: addressLocationFromData(data) || existing?.addressLocation,
      contacts: [
        buildContact(data.contact1Name, data.contact1Relation, data.contact1PhoneLocal),
        buildContact(data.contact2Name, data.contact2Relation, data.contact2PhoneLocal),
      ].filter(Boolean),
      files: {
        photo: photoFile || baseFiles.photo,
        bi: biFile || baseFiles.bi,
        license: licenseFile || baseFiles.license,
      },
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (existing) {
      state.drivers = state.drivers.map((driver) => driver.id === existing.id ? record : driver);
      toast("Motorista atualizado.");
    } else {
      state.drivers.push(record);
      toast("Motorista guardado.");
    }
    persist();
  }

  function closeAssignment(id) {
    const assignment = state.assignments.find((item) => item.id === id);
    if (!assignment) return;
    const endedAt = new Date().toISOString();

    state.assignments = state.assignments.map((item) => (
      item.id === id ? closeOpenAssignment(item, endedAt, "devolucao") : item
    ));
    state.vehicles = state.vehicles.map((vehicle) => (
      vehicle.id === assignment.vehicleId ? { ...vehicle, driverId: "", status: "parado", assignedAt: "" } : vehicle
    ));

    persist();
    toast("Atribuição encerrada e viatura libertada.");
    render();
  }

  function saveSettings(data) {
    state.settings = {
      ...state.settings,
      weeklyFee: Number(data.weeklyFee || 0),
      penaltyLate24: Number(data.penaltyLate24 || 0),
      penaltyLate72: Number(data.penaltyLate72 || 0),
      fineOffHours: Number(data.fineOffHours || 0),
      returnDelayDaily: Number(data.returnDelayDaily || 0),
      deductibleLimit: Number(data.deductibleLimit || 0),
      deliveryHour: data.deliveryHour || "12:00",
      contractMonths: Number(data.contractMonths || 12),
      trialDays: Number(data.trialDays || 30),
    };
    persist();
    toast("Valores do contrato atualizados.");
  }

  function removeItem(collection, id) {
    const labels = {
      vehicle: "vehicles",
      driver: "drivers",
      payment: "payments",
      expense: "expenses",
      event: "events",
      document: "documents",
      assignment: "assignments",
    };
    const key = labels[collection];
    if (!key) return;
    state[key] = state[key].filter((item) => item.id !== id);
    if (collection === "vehicle") {
      state.assignments = state.assignments.filter((assignment) => assignment.vehicleId !== id);
    }
    if (collection === "driver") {
      state.vehicles = state.vehicles.map((vehicle) => vehicle.driverId === id ? { ...vehicle, driverId: "" } : vehicle);
      state.assignments = state.assignments.filter((assignment) => assignment.driverId !== id);
    }
    persist();
    toast("Registo removido.");
    render();
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    downloadBlob(blob, `uhocha-controle-${toDateInput()}.json`);
    toast("Cópia de segurança exportada.");
  }

  function exportCsv() {
    const rows = [["data", "tipo", "viatura", "motorista", "valor", "notas"]];
    const payments = currentMonthItems(state.payments, "paidAt");
    const expenses = currentMonthItems(state.expenses, "date");
    const events = currentMonthItems(state.events, "date");
    const parsed = reportRowsData(payments, expenses, events);
    parsed.forEach((row) => rows.push([row.date, row.type, row.vehicle, row.driver, row.amount, row.notes]));
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `uhocha-relatorio-${activeReportMonth}.csv`);
    toast("Relatório CSV exportado.");
  }

  function reportRowsData(payments, expenses, events) {
    return [
      ...payments.map((payment) => ({
        date: dateLabel(payment.paidAt),
        type: "Entrega",
        vehicle: vehicleName(getVehicle(payment.vehicleId)),
        driver: driverName(getDriver(payment.driverId)),
        amount: Number(payment.amount || 0) + Number(payment.penaltyPaid || 0),
        notes: payment.notes || payment.proof || "",
      })),
      ...expenses.map((expense) => ({
        date: dateLabel(expense.date),
        type: `Despesa ${expense.responsible}`,
        vehicle: vehicleName(getVehicle(expense.vehicleId)),
        driver: "",
        amount: Number(expense.amount || 0),
        notes: expense.notes || expenseCategoryLabel(expense.category) || "",
      })),
      ...events.map((event) => ({
        date: dateLabel(event.date),
        type: `Ocorrência ${event.type}`,
        vehicle: vehicleName(getVehicle(event.vehicleId)),
        driver: driverName(getDriver(event.driverId)),
        amount: Number(event.amount || 0),
        notes: event.notes || "",
      })),
    ];
  }

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function toast(message) {
    document.querySelector(".toast")?.remove();
    const node = document.createElement("div");
    node.className = "toast";
    node.innerHTML = `${icon("check")}<span>${h(message)}</span>`;
    document.body.append(node);
    setTimeout(() => node.remove(), 2800);
  }

  let openModalNode = null;

  function openFormModal(title, bodyHtml) {
    closeOpenModal();
    const dialog = document.createElement("dialog");
    dialog.className = "modal modal-form";
    dialog.innerHTML = `
      <div class="modal-head">
        <h2>${h(title)}</h2>
        <button class="icon-button" type="button" data-modal-close title="Fechar">${icon("plus")}</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
    `;
    document.body.append(dialog);
    installIcons(dialog);
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (openModalNode === dialog) openModalNode = null;
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
      if (event.target.closest("[data-modal-close]")) dialog.close();
    });
    openModalNode = dialog;
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "");
    const firstInput = dialog.querySelector("input:not([type='hidden']), textarea, button");
    if (firstInput) firstInput.focus({ preventScroll: true });
    return dialog;
  }

  function closeOpenModal() {
    if (openModalNode) {
      try { openModalNode.close(); } catch (_) { /* ignore */ }
      openModalNode = null;
    }
  }

  function confirmAction(title, text) {
    return new Promise((resolve) => {
      const template = document.querySelector("#confirmTemplate");
      const dialog = template.content.firstElementChild.cloneNode(true);
      if (!dialog.showModal) {
        resolve(window.confirm(`${title}\n\n${text}`));
        return;
      }
      dialog.querySelector("h2").textContent = title;
      dialog.querySelector("p").textContent = text;
      document.body.append(dialog);
      dialog.addEventListener("close", () => {
        resolve(dialog.returnValue === "confirm");
        dialog.remove();
      });
      dialog.showModal();
    });
  }

  function bindEvents() {
    window.addEventListener("hashchange", () => setRoute(getRoute()));

    document.querySelector("#backupButton").addEventListener("click", exportBackup);
    document.querySelector("#themeButton").addEventListener("click", () => {
      state.theme = state.theme === "dark" ? "light" : "dark";
      persist();
      render();
    });

    document.addEventListener("submit", async (event) => {
      const form = event.target.closest("form[data-form]");
      if (!form) return;
      event.preventDefault();
      const data = formData(form);
      const submitButton = form.querySelector("[type='submit']");
      const handlers = {
        payment: addPayment,
        expense: addExpense,
        event: addEvent,
        document: addDocument,
        vehicle: addVehicle,
        driver: addDriver,
        assignment: addAssignment,
        settings: saveSettings,
      };
      try {
        if (submitButton) submitButton.disabled = true;
        await handlers[form.dataset.form]?.(data);
        render();
      } catch (error) {
        console.error(error);
        toast(error.message || "Não foi possível guardar.");
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });

    document.addEventListener("click", async (event) => {
      const comboTrigger = event.target.closest("[data-combo-trigger]");
      if (comboTrigger) {
        const combo = comboTrigger.closest("[data-combo]");
        const menu = combo?.querySelector("[data-combo-menu]");
        const expanded = comboTrigger.getAttribute("aria-expanded") === "true";
        closeCombos(combo);
        if (menu && !expanded) {
          menu.hidden = false;
          comboTrigger.setAttribute("aria-expanded", "true");
          const search = combo.querySelector("[data-combo-search]");
          if (search) {
            search.value = "";
            filterComboOptions(combo, "");
            search.focus();
          }
        }
        return;
      }

      const comboOption = event.target.closest("[data-combo-option]");
      if (comboOption) {
        const combo = comboOption.closest("[data-combo]");
        const hidden = combo?.querySelector("input[type='hidden']");
        const label = combo?.querySelector("[data-combo-label]");
        if (hidden && label) {
          hidden.value = comboOption.dataset.value || "";
          label.textContent = comboOption.dataset.label || comboOption.textContent.trim();
          combo.querySelectorAll("[data-combo-option]").forEach((option) => {
            option.classList.toggle("selected", option === comboOption);
          });
          hidden.dispatchEvent(new Event("change", { bubbles: true }));
        }
        closeCombos();
        return;
      }

      if (!event.target.closest("[data-combo]")) closeCombos();

      const registerTab = event.target.closest("[data-register-tab]");
      if (registerTab) {
        activeRegisterTab = registerTab.dataset.registerTab;
        render();
        return;
      }

      const fleetTab = event.target.closest("[data-fleet-tab]");
      if (fleetTab) {
        activeFleetTab = fleetTab.dataset.fleetTab;
        render();
        return;
      }

      const reportTab = event.target.closest("[data-report-tab]");
      if (reportTab) {
        activeReportTab = reportTab.dataset.reportTab;
        render();
        return;
      }

      const detailTab = event.target.closest("[data-detail-tab]");
      if (detailTab) {
        activeDetailTab = detailTab.dataset.detailTab;
        render();
        return;
      }

      const editButton = event.target.closest("[data-edit]");
      if (editButton) {
        const kind = editButton.dataset.edit;
        const id = editButton.dataset.id;
        if (kind === "driver") {
          const driver = getDriver(id);
          if (driver) openFormModal("Editar motorista", driverForm(driver));
        } else if (kind === "vehicle") {
          const vehicle = getVehicle(id);
          if (vehicle) openFormModal("Editar viatura", vehicleForm(vehicle));
        }
        return;
      }

      const openForm = event.target.closest("[data-open-form]");
      if (openForm) {
        const map = {
          vehicle: ["Nova viatura", vehicleForm],
          driver: ["Novo motorista", driverForm],
          assignment: ["Nova atribuição", assignmentForm],
          payment: ["Nova entrega", paymentForm],
          expense: ["Nova despesa", expenseForm],
          event: ["Nova ocorrência", eventForm],
          document: ["Novo documento", documentForm],
        };
        const entry = map[openForm.dataset.openForm];
        if (entry) openFormModal(entry[0], entry[1]());
        return;
      }

      const navTrigger = event.target.closest("[data-nav]");
      if (navTrigger && !event.target.closest("button, a, input, select, textarea, [data-combo], [data-no-nav]")) {
        event.preventDefault();
        navigate(navTrigger.dataset.nav, navTrigger.dataset.navId || "");
        return;
      }

      const backButton = event.target.closest("[data-back]");
      if (backButton) {
        navigate(backButton.dataset.back || "frota");
        return;
      }

      const deleteButton = event.target.closest("[data-delete]");
      if (deleteButton) {
        const ok = await confirmAction("Remover registo", "Esta ação remove este registo do sistema.");
        if (ok) removeItem(deleteButton.dataset.delete, deleteButton.dataset.id);
        return;
      }

      const action = event.target.closest("[data-action]");
      if (!action) return;
      if (action.dataset.action === "capture-location") {
        await captureResidenceLocation(action.closest("form"), action);
        return;
      }
      if (action.dataset.action === "close-assignment") {
        const ok = await confirmAction("Encerrar atribuição", "A viatura será libertada e ficará marcada como parada.");
        if (ok) closeAssignment(action.dataset.id);
        return;
      }
      if (action.dataset.action === "export-csv") exportCsv();
      if (action.dataset.action === "import-backup") document.querySelector("[data-backup-file]")?.click();
    });

    document.addEventListener("change", (event) => {
      if (event.target.matches("[data-report-month]")) {
        activeReportMonth = event.target.value || monthValue(new Date());
        render();
      }

      if (event.target.matches("[data-payment-driver]")) {
        const assignment = activeAssignmentForDriver(event.target.value);
        const vehicle = getVehicle(assignment?.vehicleId);
        const vehicleInput = event.target.form?.querySelector("[data-payment-vehicle]");
        const vehicleLabel = event.target.form?.querySelector("[data-payment-vehicle-label]");
        if (vehicleInput) vehicleInput.value = vehicle?.id || "";
        if (vehicleLabel) vehicleLabel.value = vehicleName(vehicle);
      }

      if (event.target.matches("[data-expense-scope]")) {
        const vehicleCombo = event.target.form?.querySelector("[data-expense-vehicle]")?.closest(".field");
        if (vehicleCombo) vehicleCombo.hidden = event.target.value === "all";
      }

      if (event.target.name === "vehicleId" && event.target.closest("form[data-form='event']")) {
        const vehicle = getVehicle(event.target.value);
        const driverInput = event.target.form?.querySelector("input[name='driverId']");
        const driverCombo = driverInput?.closest("[data-combo]");
        const driver = getDriver(vehicle?.driverId);
        if (driverInput && driverCombo && driver) {
          driverInput.value = driver.id;
          const label = driverCombo.querySelector("[data-combo-label]");
          if (label) label.textContent = driverName(driver);
          driverCombo.querySelectorAll("[data-combo-option]").forEach((option) => {
            option.classList.toggle("selected", option.dataset.value === driver.id);
          });
        }
      }

      if (event.target.matches("[data-backup-file]")) {
        const file = event.target.files?.[0];
        if (file) importBackup(file);
        event.target.value = "";
      }
    });

    document.addEventListener("input", (event) => {
      if (event.target.matches("[data-combo-search]")) {
        filterComboOptions(event.target.closest("[data-combo]"), event.target.value);
      }
    });
  }

  function closeCombos(except = null) {
    document.querySelectorAll("[data-combo]").forEach((combo) => {
      if (combo === except) return;
      const menu = combo.querySelector("[data-combo-menu]");
      const trigger = combo.querySelector("[data-combo-trigger]");
      if (menu) menu.hidden = true;
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
  }

  function filterComboOptions(combo, value) {
    const query = String(value || "").trim().toLowerCase();
    combo?.querySelectorAll("[data-combo-option]").forEach((option) => {
      const label = String(option.dataset.label || option.textContent || "").toLowerCase();
      option.hidden = query && !label.includes(query);
    });
  }

  async function importBackup(file) {
    try {
      const text = await file.text();
      const imported = normalizeState(JSON.parse(text));
      const ok = await confirmAction("Importar cópia", "Os dados atuais serão substituídos pela cópia selecionada.");
      if (!ok) return;
      state = imported;
      persist();
      toast("Cópia importada.");
      render();
    } catch (error) {
      console.error(error);
      toast("Não foi possível importar a cópia.");
    }
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("./sw.js").catch((error) => console.warn(error));
    }
  }

  installIcons();
  bindEvents();
  render();
  registerServiceWorker();
  loadRemoteState();
})();
