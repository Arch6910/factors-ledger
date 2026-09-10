(function () {
  "use strict";

  var STORAGE_KEY = "ledger-days";
  var CATEGORY_SUGGESTIONS = ["Chai/Nashta", "Transport", "Loading", "Repair", "Stationery", "Other"];

  var state = {
    days: loadDays(),
    selectedDate: todayStr(),
    tab: "today",
  };

  // ---------- storage ----------
  function loadDays() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveDays() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.days));
    } catch (e) {
      // best effort
    }
  }

  // ---------- helpers ----------
  function todayStr() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function fmtMoney(n) {
    var v = Math.round(Number(n) || 0);
    var sign = v < 0 ? "-" : "";
    return sign + "Rs " + Math.abs(v).toLocaleString("en-IN");
  }

  function fmtDateLong(dateStr) {
    var d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  function makeId() {
    return Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function emptyDay(opening) {
    return { opening: Number(opening) || 0, expenses: [], amad: [], closed: false, actual: null };
  }

  function computeExpected(day) {
    var amadTotal = day.amad.reduce(function (s, a) { return s + Number(a.amount); }, 0);
    var expTotal = day.expenses.reduce(function (s, e) { return s + Number(e.amount); }, 0);
    return day.opening + amadTotal - expTotal;
  }

  // ---------- mutations ----------
  function startDay(dateStr, opening) {
    state.days[dateStr] = emptyDay(opening);
    saveDays();
    render();
  }

  function addExpense(dateStr, amount, category, note) {
    var day = state.days[dateStr];
    if (!day) return;
    day.expenses.push({ id: makeId(), amount: Number(amount), category: category || "Other", note: note || "", time: new Date().toISOString() });
    saveDays();
    render();
  }

  function addAmad(dateStr, amount, note) {
    var day = state.days[dateStr];
    if (!day) return;
    day.amad.push({ id: makeId(), amount: Number(amount), note: note || "", time: new Date().toISOString() });
    saveDays();
    render();
  }

  function deleteEntry(dateStr, kind, id) {
    var day = state.days[dateStr];
    if (!day) return;
    var key = kind === "expense" ? "expenses" : "amad";
    day[key] = day[key].filter(function (e) { return e.id !== id; });
    saveDays();
    render();
  }

  function balanceDay(dateStr, actual) {
    var day = state.days[dateStr];
    if (!day) return;
    day.closed = true;
    day.actual = Number(actual);
    saveDays();
    render();
  }

  function reopenDay(dateStr) {
    var day = state.days[dateStr];
    if (!day) return;
    day.closed = false;
    day.actual = null;
    saveDays();
    render();
  }

  // ---------- rendering ----------
  function render() {
    var root = document.getElementById("app-root");
    root.innerHTML =
      '<div class="ledger-container">' +
        renderHeader() +
        (state.tab === "today" ? renderTodayView() : renderHistoryView()) +
      "</div>";
    attachListeners();
  }

  function renderHeader() {
    return (
      '<div class="ledger-header">' +
        '<div>' +
          '<p class="ledger-kicker mono">Daraz Raqam</p>' +
          '<h1 class="ledger-h1">Factor\u2019s Ledger</h1>' +
        "</div>" +
        '<div class="ledger-tabs">' +
          '<button class="ledger-tab ' + (state.tab === "today" ? "active" : "") + '" data-action="tab" data-tab="today">Today</button>' +
          '<button class="ledger-tab ' + (state.tab === "history" ? "active" : "") + '" data-action="tab" data-tab="history">History</button>' +
        "</div>" +
      "</div>"
    );
  }

  function renderTodayView() {
    var dateStr = state.selectedDate;
    var day = state.days[dateStr];

    var html = '<div class="date-row">' +
      '<label for="ledger-date">Date</label>' +
      '<input id="ledger-date" type="date" class="date-input mono" value="' + dateStr + '" max="' + todayStr() + '" data-action="date-change" />' +
      '<span class="date-caption">' + fmtDateLong(dateStr) + "</span>" +
    "</div>";

    if (!day) {
      html +=
        '<div class="card start-day-card">' +
          '<p class="form-title">Start the day</p>' +
          '<form data-action="start-day">' +
            '<div class="form-field">' +
              '<label for="opening">Opening cash</label>' +
              '<input id="opening" name="opening" type="number" min="0" step="1" class="mono-input" placeholder="e.g. 5000" required />' +
            "</div>" +
            '<button type="submit" class="btn">Start day</button>' +
          "</form>" +
        "</div>";
      return html;
    }

    var amadTotal = day.amad.reduce(function (s, a) { return s + Number(a.amount); }, 0);
    var expTotal = day.expenses.reduce(function (s, e) { return s + Number(e.amount); }, 0);
    var expected = computeExpected(day);

    html +=
      '<div class="tiles">' +
        '<div class="tile"><p class="tile-label">Opening</p><p class="tile-value bottle mono">' + fmtMoney(day.opening) + "</p></div>" +
        '<div class="tile"><p class="tile-label">Amad (in)</p><p class="tile-value brass mono">' + fmtMoney(amadTotal) + "</p></div>" +
        '<div class="tile"><p class="tile-label">Expenses (out)</p><p class="tile-value brick mono">' + fmtMoney(expTotal) + "</p></div>" +
        '<div class="tile"><p class="tile-label">Expected in drawer</p><p class="tile-value bottle mono">' + fmtMoney(expected) + "</p></div>" +
      "</div>";

    if (!day.closed) {
      var datalistOptions = CATEGORY_SUGGESTIONS.map(function (c) { return '<option value="' + escapeHtml(c) + '"></option>'; }).join("");
      html +=
        '<div class="forms-row">' +
          '<div class="card">' +
            '<p class="form-title">Add expense</p>' +
            '<form data-action="add-expense">' +
              '<div class="form-field"><label for="exp-amount">Amount</label>' +
                '<input id="exp-amount" name="amount" type="number" min="0" step="1" class="mono-input" placeholder="e.g. 200" required /></div>' +
              '<div class="form-field"><label for="exp-category">Category</label>' +
                '<input id="exp-category" name="category" type="text" list="category-suggestions" placeholder="Chai/Nashta, Transport\u2026" required />' +
                '<datalist id="category-suggestions">' + datalistOptions + "</datalist></div>" +
              '<div class="form-field"><label for="exp-note">Note (optional)</label>' +
                '<input id="exp-note" name="note" type="text" placeholder="Any detail" /></div>' +
              '<button type="submit" class="btn btn-expense">Record expense</button>' +
            "</form>" +
          "</div>" +
          '<div class="card">' +
            '<p class="form-title">Add amad</p>' +
            '<form data-action="add-amad">' +
              '<div class="form-field"><label for="amad-amount">Amount</label>' +
                '<input id="amad-amount" name="amount" type="number" min="0" step="1" class="mono-input" placeholder="e.g. 1000" required /></div>' +
              '<div class="form-field"><label for="amad-note">Note (optional)</label>' +
                '<input id="amad-note" name="note" type="text" placeholder="Any detail" /></div>' +
              '<button type="submit" class="btn btn-amad">Record amad</button>' +
            "</form>" +
          "</div>" +
        "</div>";
    }

    var combined = day.expenses.map(function (e) { return Object.assign({}, e, { kind: "expense" }); })
      .concat(day.amad.map(function (a) { return Object.assign({}, a, { kind: "amad", category: "Amad" }); }))
      .sort(function (a, b) { return a.time < b.time ? -1 : 1; });

    html += '<div class="card entries-card"><p class="entries-title">Today\u2019s entries</p>';
    if (combined.length === 0) {
      html += '<p class="empty-note">Nothing recorded yet.</p>';
    } else {
      combined.forEach(function (entry) {
        html +=
          '<div class="entry-row">' +
            '<span class="entry-time mono">' + fmtTime(entry.time) + "</span>" +
            '<div class="entry-main">' +
              '<div class="entry-category">' + escapeHtml(entry.category) + "</div>" +
              (entry.note ? '<div class="entry-note">' + escapeHtml(entry.note) + "</div>" : "") +
            "</div>" +
            '<span class="entry-amount mono ' + (entry.kind === "amad" ? "in" : "out") + '">' +
              (entry.kind === "amad" ? "+" : "-") + fmtMoney(entry.amount) +
            "</span>" +
            (!day.closed ? '<button class="entry-delete" data-action="delete-entry" data-kind="' + entry.kind + '" data-id="' + entry.id + '" aria-label="Delete entry">\u00D7</button>' : "") +
          "</div>";
      });
    }
    html += "</div>";

    html += '<div class="card"><p class="eod-title">End of day</p>';
    if (!day.closed) {
      html +=
        '<form data-action="balance-day">' +
          '<div class="form-field"><label for="actual">Cash counted in drawer</label>' +
            '<input id="actual" name="actual" type="number" min="0" step="1" class="mono-input" placeholder="e.g. 3800" required /></div>' +
          '<button type="submit" class="btn">Balance the day</button>' +
        "</form>";
    } else {
      var diff = day.actual - expected;
      html +=
        '<div class="eod-row"><span class="label">Expected</span><span class="value mono">' + fmtMoney(expected) + "</span></div>" +
        '<hr class="eod-divider" />' +
        '<div class="eod-row"><span class="label">Actual counted</span><span class="value mono">' + fmtMoney(day.actual) + "</span></div>";
      if (diff === 0) {
        html += '<div class="banner balanced">Balanced \u2014 matches exactly.</div>';
      } else if (diff > 0) {
        html += '<div class="banner excess">' + fmtMoney(diff) + " extra in the drawer \u2014 likely an unrecorded amad.</div>";
      } else {
        html += '<div class="banner shortage">' + fmtMoney(Math.abs(diff)) + " short \u2014 likely a missing expense entry.</div>";
      }
      html += '<button class="reopen-link" data-action="reopen-day">Reopen this day to fix an entry</button>';
    }
    html += "</div>";

    return html;
  }

  function renderHistoryView() {
    var entries = Object.keys(state.days)
      .sort(function (a, b) { return a < b ? 1 : -1; })
      .map(function (date) { return Object.assign({ date: date }, state.days[date]); });

    if (entries.length === 0) {
      return '<div class="card"><p class="empty-note">No days recorded yet.</p></div>';
    }

    var html = '<div class="card">';
    entries.forEach(function (d) {
      var expected = computeExpected(d);
      var diff = d.closed ? d.actual - expected : null;
      var tagClass = "tag-grey";
      var tagText = "Not balanced";
      if (d.closed) {
        if (diff === 0) { tagClass = "tag-balanced"; tagText = "Balanced"; }
        else if (diff > 0) { tagClass = "tag-excess"; tagText = "+" + fmtMoney(diff); }
        else { tagClass = "tag-shortage"; tagText = "-" + fmtMoney(Math.abs(diff)); }
      }
      html +=
        '<div class="history-row" data-action="open-day" data-date="' + d.date + '">' +
          '<span class="history-date">' + fmtDateLong(d.date) + "</span>" +
          '<span class="history-meta">' + d.expenses.length + " expense" + (d.expenses.length === 1 ? "" : "s") + ", " + d.amad.length + " amad</span>" +
          '<span class="history-opening mono">' + fmtMoney(d.opening) + "</span>" +
          '<span class="tag ' + tagClass + '">' + tagText + "</span>" +
        "</div>";
    });
    html += "</div>";
    return html;
  }

  // ---------- event wiring ----------
  function attachListeners() {
    var root = document.getElementById("app-root");

    root.querySelectorAll('[data-action="tab"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.tab = btn.getAttribute("data-tab");
        render();
      });
    });

    var dateInput = root.querySelector("#ledger-date");
    if (dateInput) {
      dateInput.addEventListener("change", function () {
        state.selectedDate = dateInput.value || todayStr();
        render();
      });
    }

    var startForm = root.querySelector('[data-action="start-day"]');
    if (startForm) {
      startForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var v = parseFloat(startForm.opening.value);
        if (!isNaN(v) && v >= 0) startDay(state.selectedDate, v);
      });
    }

    var expForm = root.querySelector('[data-action="add-expense"]');
    if (expForm) {
      expForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var v = parseFloat(expForm.amount.value);
        if (!isNaN(v) && v > 0) addExpense(state.selectedDate, v, expForm.category.value.trim(), expForm.note.value.trim());
      });
    }

    var amadForm = root.querySelector('[data-action="add-amad"]');
    if (amadForm) {
      amadForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var v = parseFloat(amadForm.amount.value);
        if (!isNaN(v) && v > 0) addAmad(state.selectedDate, v, amadForm.note.value.trim());
      });
    }

    var balanceForm = root.querySelector('[data-action="balance-day"]');
    if (balanceForm) {
      balanceForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var v = parseFloat(balanceForm.actual.value);
        if (!isNaN(v) && v >= 0) balanceDay(state.selectedDate, v);
      });
    }

    var reopenBtn = root.querySelector('[data-action="reopen-day"]');
    if (reopenBtn) {
      reopenBtn.addEventListener("click", function () {
        reopenDay(state.selectedDate);
      });
    }

    root.querySelectorAll('[data-action="delete-entry"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        deleteEntry(state.selectedDate, btn.getAttribute("data-kind"), btn.getAttribute("data-id"));
      });
    });

    root.querySelectorAll('[data-action="open-day"]').forEach(function (row) {
      row.addEventListener("click", function () {
        state.selectedDate = row.getAttribute("data-date");
        state.tab = "today";
        render();
      });
    });
  }

  // ---------- boot ----------
  render();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {
        // offline support is best-effort; app still works without it
      });
    });
  }
})();
