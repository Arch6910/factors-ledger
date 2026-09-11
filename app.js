(function () {
  "use strict";

  var STORAGE_KEY = "ledger-days";
  var BACKUP_KEY = "ledger-last-backup";
  var CATEGORY_SUGGESTIONS = ["Chai/Nashta", "Transport", "Loading", "Repair", "Stationery", "Other"];
  var GOOGLE_CLIENT_ID = "400836356499-9gu7u3jgkvckiojeo1d8oeh73mj2700s.apps.googleusercontent.com";
  var DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
  var DRIVE_FOLDER_NAME = "Factor's Ledger";

  var state = {
    days: loadDays(),
    selectedDate: todayStr(),
    tab: "today",
    editing: null,
    undo: null,
    driveToken: null,
    tokenClient: null,
    pendingDriveAction: false
  };

  function loadDays() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function saveDays() {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.days)); } catch (e) {}
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
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

  function computeTotals(day) {
    return {
      amad: day.amad.reduce(function (s, a) { return s + Number(a.amount || 0); }, 0),
      expenses: day.expenses.reduce(function (s, e) { return s + Number(e.amount || 0); }, 0)
    };
  }

  function computeExpected(day) {
    var t = computeTotals(day);
    return Number(day.opening || 0) + t.amad - t.expenses;
  }

  function lastBackup() {
    try { return window.localStorage.getItem(BACKUP_KEY); } catch (e) { return null; }
  }

  function markBackup() {
    try { window.localStorage.setItem(BACKUP_KEY, new Date().toISOString()); } catch (e) {}
  }

  function backupText() {
    var raw = lastBackup();
    if (!raw) return "Backup: never";
    var days = Math.floor((Date.now() - new Date(raw).getTime()) / 86400000);
    if (days <= 0) return "Last backup: today";
    return "Last backup: " + days + " day" + (days === 1 ? "" : "s") + " ago";
  }

  function startDay(dateStr, opening) {
    state.days[dateStr] = emptyDay(opening);
    saveDays(); render();
  }

  function addExpense(dateStr, amount, category, note) {
    var day = state.days[dateStr];
    if (!day || day.closed) return;
    day.expenses.push({ id: makeId(), amount: Number(amount), category: category || "Other", note: note || "", time: new Date().toISOString() });
    saveDays(); render();
  }

  function addAmad(dateStr, amount, note) {
    var day = state.days[dateStr];
    if (!day || day.closed) return;
    day.amad.push({ id: makeId(), amount: Number(amount), note: note || "", time: new Date().toISOString() });
    saveDays(); render();
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function setUndo(message, restoreFn) {
    if (state.undo && state.undo.timer) clearTimeout(state.undo.timer);
    state.undo = { message: message, restore: restoreFn, timer: setTimeout(function () {
      state.undo = null; render();
    }, 6000) };
  }

  function deleteEntry(dateStr, kind, id) {
    var day = state.days[dateStr];
    if (!day) return;
    if (day.closed) { alert("Reopen this day first before changing its entries."); return; }
    var key = kind === "expense" ? "expenses" : "amad";
    var old = day[key].find(function (e) { return e.id === id; });
    if (!old) return;
    if (!confirm("Delete this entry?")) return;
    var index = day[key].findIndex(function (e) { return e.id === id; });
    day[key].splice(index, 1);
    saveDays();
    setUndo("Entry deleted", function () {
      day[key].splice(index, 0, old);
      saveDays();
    });
    render();
  }

  function deleteHistoryDay(dateStr) {
    var day = state.days[dateStr];
    if (!day) return;
    if (day.closed) {
      alert("This day is closed. Reopen it first, then delete it from History.");
      return;
    }
    if (!confirm("Delete the complete day " + fmtDateLong(dateStr) + "?")) return;
    var old = clone(day);
    delete state.days[dateStr];
    if (state.selectedDate === dateStr) state.selectedDate = todayStr();
    saveDays();
    setUndo("Day deleted", function () {
      state.days[dateStr] = old;
      saveDays();
    });
    render();
  }

  function resetToday() {
    var dateStr = state.selectedDate;
    var day = state.days[dateStr];
    if (!day) return;
    if (day.closed) {
      alert("Reopen this day first before resetting it.");
      return;
    }
    if (!confirm("Reset " + fmtDateLong(dateStr) + " and remove all entries?")) return;
    var old = clone(day);
    delete state.days[dateStr];
    saveDays();
    setUndo("Day reset", function () {
      state.days[dateStr] = old;
      saveDays();
    });
    render();
  }

  function balanceDay(dateStr, actual) {
    var day = state.days[dateStr];
    if (!day) return;
    day.closed = true;
    day.actual = Number(actual);
    saveDays(); render();
  }

  function reopenDay(dateStr) {
    var day = state.days[dateStr];
    if (!day) return;
    if (!confirm("Reopen this day so entries can be changed?")) return;
    day.closed = false;
    day.actual = null;
    saveDays(); render();
  }

  function editEntry(dateStr, kind, id, form) {
    var day = state.days[dateStr];
    if (!day || day.closed) return;
    var key = kind === "expense" ? "expenses" : "amad";
    var entry = day[key].find(function (e) { return e.id === id; });
    if (!entry) return;
    var amount = parseFloat(form.amount.value);
    if (isNaN(amount) || amount <= 0) { alert("Enter a valid amount."); return; }
    entry.amount = amount;
    if (kind === "expense") {
      entry.category = form.category.value.trim() || "Other";
    }
    entry.note = form.note.value.trim();
    saveDays();
    state.editing = null;
    render();
  }

  function exportJSON() {
    var payload = {
      app: "Factor's Ledger",
      version: 2,
      exportedAt: new Date().toISOString(),
      days: state.days
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ledger-days.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    markBackup();
    render();
  }

  function importJSON(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var days = parsed && parsed.days ? parsed.days : parsed;
        if (!days || typeof days !== "object" || Array.isArray(days)) throw new Error("Invalid backup");
        if (!confirm("Import this backup? It will replace the ledger currently stored on this device.")) return;
        state.days = days;
        saveDays();
        markBackup();
        alert("Backup restored successfully.");
        render();
      } catch (e) {
        alert("This is not a valid Factor's Ledger JSON backup.");
      }
    };
    reader.readAsText(file);
  }

  // ---------- PDF ----------
  function loadJsPDF() {
    return new Promise(function (resolve, reject) {
      if (window.jspdf && window.jspdf.jsPDF) { resolve(window.jspdf.jsPDF); return; }
      var script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js";
      script.onload = function () {
        if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
        else reject(new Error("PDF library failed to load."));
      };
      script.onerror = function () { reject(new Error("Could not load PDF library. Check internet connection.")); };
      document.head.appendChild(script);
    });
  }

  function makePDF(dateStr, day) {
    return loadJsPDF().then(function (jsPDF) {
      var doc = new jsPDF({ unit: "mm", format: "a4" });
      var totals = computeTotals(day);
      var expected = computeExpected(day);
      var diff = day.closed && day.actual != null ? Number(day.actual) - expected : null;
      var y = 18;

      function line() {
        doc.setDrawColor(210, 200, 180);
        doc.line(14, y, 196, y);
        y += 5;
      }
      function text(txt, x, size, bold) {
        doc.setFont("times", bold ? "bold" : "normal");
        doc.setFontSize(size || 10);
        doc.text(String(txt), x, y);
      }
      function money(n) {
        return "Rs " + Math.round(Number(n) || 0).toLocaleString("en-IN");
      }
      function addWrapped(txt, x, width, size) {
        doc.setFont("times", "normal");
        doc.setFontSize(size || 9);
        var lines = doc.splitTextToSize(String(txt || ""), width);
        doc.text(lines, x, y);
        y += lines.length * 4.2;
      }
      function pageIfNeeded(height) {
        if (y + height > 282) { doc.addPage(); y = 18; }
      }
      function tableHeader(cols) {
        pageIfNeeded(10);
        doc.setFont("courier", "bold"); doc.setFontSize(8.5);
        cols.forEach(function (c) { doc.text(c.label, c.x, y); });
        y += 3;
        doc.setDrawColor(210, 200, 180); doc.line(14, y, 196, y); y += 5;
      }

      doc.setTextColor(35, 50, 42);
      doc.setFont("times", "bold"); doc.setFontSize(22);
      doc.text("Factor's Ledger", 14, y); y += 7;
      doc.setFont("courier", "normal"); doc.setFontSize(9);
      doc.text(dateStr + "  |  " + fmtDateLong(dateStr), 14, y); y += 8;
      line();

      doc.setFont("times", "bold"); doc.setFontSize(13); doc.text("Day Summary", 14, y); y += 7;
      var summary = [
        ["Opening", money(day.opening)],
        ["Total Amad", money(totals.amad)],
        ["Total Expenses", money(totals.expenses)],
        ["Expected in drawer", money(expected)]
      ];
      if (day.closed) summary.push(["Actual counted", money(day.actual)]);
      if (diff !== null) summary.push(["Difference", (diff >= 0 ? "+" : "-") + money(Math.abs(diff))]);
      summary.forEach(function (r) {
        doc.setFont("times", "normal"); doc.setFontSize(10); doc.text(r[0], 18, y);
        doc.setFont("courier", "normal"); doc.text(r[1], 125, y); y += 5.5;
      });
      if (diff !== null) {
        var status = diff === 0 ? "BALANCED" : (diff > 0 ? "EXCESS" : "SHORT");
        doc.setFont("times", "bold"); doc.setFontSize(11);
        doc.text(status + (diff === 0 ? " - matches exactly." : diff > 0 ? " - extra cash in drawer." : " - cash missing from drawer."), 18, y);
        y += 8;
      } else { y += 3; }

      line();
      doc.setFont("times", "bold"); doc.setFontSize(13); doc.text("Amad Entries", 14, y); y += 7;
      if (!day.amad.length) {
        doc.setFont("times", "italic"); doc.setFontSize(9); doc.text("No amad recorded.", 18, y); y += 7;
      } else {
        tableHeader([{label:"TIME",x:18},{label:"NOTE",x:55},{label:"AMOUNT",x:160}]);
        day.amad.slice().sort(function(a,b){return a.time < b.time ? -1 : 1;}).forEach(function(a) {
          pageIfNeeded(9);
          doc.setFont("courier","normal"); doc.setFontSize(8.5); doc.text(fmtTime(a.time),18,y);
          addWrapped(a.note || "-",55,98,8.5);
          doc.setFont("courier","normal"); doc.text(money(a.amount),160,y - 4.2);
          y += 1;
        });
      }

      line();
      doc.setFont("times", "bold"); doc.setFontSize(13); doc.text("Expense Entries", 14, y); y += 7;
      if (!day.expenses.length) {
        doc.setFont("times", "italic"); doc.setFontSize(9); doc.text("No expenses recorded.", 18, y); y += 7;
      } else {
        tableHeader([{label:"TIME",x:18},{label:"CATEGORY / NOTE",x:55},{label:"AMOUNT",x:160}]);
        day.expenses.slice().sort(function(a,b){return a.time < b.time ? -1 : 1;}).forEach(function(e) {
          pageIfNeeded(12);
          doc.setFont("courier","normal"); doc.setFontSize(8.5); doc.text(fmtTime(e.time),18,y);
          doc.setFont("times","bold"); doc.setFontSize(8.5); doc.text(String(e.category || "Other"),55,y);
          y += 4.2;
          addWrapped(e.note || "-",55,98,8.5);
          doc.setFont("courier","normal"); doc.text(money(e.amount),160,y - 4.2);
          y += 1;
        });
      }

      pageIfNeeded(18);
      line();
      doc.setFont("times", "italic"); doc.setFontSize(8);
      doc.text("Generated " + new Date().toLocaleString("en-GB"), 14, y);
      return doc.output("blob");
    });
  }

  function ensureDriveAuth(done) {
    if (state.driveToken) { done(state.driveToken); return; }
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      alert("Google sign-in is still loading. Please wait a moment and try again.");
      return;
    }
    if (!state.tokenClient) {
      state.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: function (response) {
          if (response.error) {
            state.pendingDriveAction = false;
            if (state.driveAuthReject) state.driveAuthReject(new Error(response.error));
            state.driveAuthResolve = null;
            state.driveAuthReject = null;
            return;
          }
          state.driveToken = response.access_token;
          state.pendingDriveAction = false;
          if (state.driveAuthResolve) state.driveAuthResolve(state.driveToken);
          state.driveAuthResolve = null;
          state.driveAuthReject = null;
        }
      });
    }
    state.pendingDriveAction = true;
    state.tokenClient.requestAccessToken({ prompt: "" });
    return;
  }

  function getDriveToken() {
    return new Promise(function(resolve, reject) {
      if (state.driveToken) { resolve(state.driveToken); return; }
      if (!window.google || !google.accounts || !google.accounts.oauth2) {
        reject(new Error("Google sign-in library is not ready."));
        return;
      }
      state.driveAuthResolve = resolve;
      state.driveAuthReject = reject;
      ensureDriveAuth(function(token){ resolve(token); });
    });
  }

  function driveFetch(url, options) {
    options = options || {};
    options.headers = Object.assign({ Authorization: "Bearer " + state.driveToken }, options.headers || {});
    return fetch(url, options).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || ("Drive error " + r.status)); });
      return r;
    });
  }

  function getOrCreateDriveFolder() {
    var q = "name = '" + DRIVE_FOLDER_NAME.replace(/'/g, "\\'") + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    return driveFetch("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent(q) + "&spaces=drive&fields=files(id,name)").then(function (r) {
      return r.json();
    }).then(function (data) {
      if (data.files && data.files.length) return data.files[0].id;
      var metadata = { name: DRIVE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" };
      return driveFetch("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata)
      }).then(function (r) { return r.json(); }).then(function (f) { return f.id; });
    });
  }

  function uploadPDFToDrive(dateStr, blob) {
    return getOrCreateDriveFolder().then(function (folderId) {
      var q = "name = 'Factor\'s Ledger - " + dateStr + ".pdf' and '" + folderId + "' in parents and trashed = false";
      return driveFetch("https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent(q) + "&spaces=drive&fields=files(id,name)").then(function(r){return r.json();})
        .then(function(data) {
          var existing = data.files && data.files.length ? data.files[0] : null;
          return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function() {
              var arrayBuffer = reader.result;
              var url, method, headers;
              if (existing) {
                url = "https://www.googleapis.com/upload/drive/v3/files/" + encodeURIComponent(existing.id) + "?uploadType=media";
                method = "PATCH";
                headers = {"Content-Type":"application/pdf"};
              } else {
                var boundary = "-------314159265358979323846";
                var metadata = {name:"Factor's Ledger - " + dateStr + ".pdf",mimeType:"application/pdf",parents:[folderId]};
                var meta = JSON.stringify(metadata), enc = new TextEncoder();
                var pre = enc.encode("--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"+meta+"\r\n--"+boundary+"\r\nContent-Type: application/pdf\r\n\r\n");
                var body = new Uint8Array(arrayBuffer), endBytes = enc.encode("\r\n--"+boundary+"--");
                var combined = new Uint8Array(pre.length+body.length+endBytes.length);
                combined.set(pre,0); combined.set(body,pre.length); combined.set(endBytes,pre.length+body.length);
                url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink";
                method = "POST";
                headers = {"Content-Type":"multipart/related; boundary="+boundary};
                arrayBuffer = combined.buffer;
              }
              driveFetch(url,{method:method,headers:headers,body:arrayBuffer})
                .then(function(r){return r.json();}).then(resolve).catch(reject);
            };
            reader.onerror=reject;
            reader.readAsArrayBuffer(blob);
          });
        });
    });
  }

  function closeAndSavePDF() {
    var dateStr = state.selectedDate, day = state.days[dateStr];
    if (!day || day.closed) return;
    var actualInput = document.getElementById("actual");
    var actual = actualInput ? parseFloat(actualInput.value) : NaN;
    if (isNaN(actual) || actual < 0) {
      alert("Enter the cash counted in the drawer first.");
      return;
    }
    if (!confirm("Close this day and save the complete PDF to Google Drive?")) return;

    var pdfDay = clone(day);
    pdfDay.actual = actual;
    pdfDay.closed = true;
    var btn = document.querySelector('[data-action="close-save-pdf"]');
    if (btn) { btn.disabled = true; btn.textContent = "Saving PDF…"; }

    makePDF(dateStr, pdfDay)
      .then(function(blob) { return getDriveToken().then(function(){ return uploadPDFToDrive(dateStr, blob); }); })
      .then(function() {
        day.actual = actual;
        day.closed = true;
        saveDays();
        markBackup();
        alert("Day closed and PDF saved to Google Drive in \"Factor's Ledger\".");
        render();
      })
      .catch(function(err) {
        console.error(err);
        render();
        alert("The PDF could not be saved to Google Drive. The day is still open. Please check Google sign-in, Drive access, and your internet connection.");
      });
  }

  function render() {
    var root = document.getElementById("app-root");
    root.innerHTML = '<div class="ledger-container">' + renderHeader() +
      (state.tab === "today" ? renderTodayView() : renderHistoryView()) + "</div>";
    attachListeners();
  }

  function renderHeader() {
    return '<div class="ledger-header"><div>' +
      '<p class="ledger-kicker mono">Daraz Raqam</p><h1 class="ledger-h1">Factor’s Ledger</h1>' +
      '<div class="backup-nudge mono">' + escapeHtml(backupText()) + '</div>' +
      '</div><div class="header-actions">' +
      '<button class="btn btn-small" data-action="export-json">Export JSON</button>' +
      '<label class="btn btn-small btn-light">Import JSON<input id="import-json" type="file" accept=".json,application/json" hidden /></label>' +
      '<button class="btn btn-small" data-action="drive-signin">Google Drive</button>' +
      '<div class="ledger-tabs"><button class="ledger-tab ' + (state.tab === "today" ? "active" : "") + '" data-action="tab" data-tab="today">Today</button>' +
      '<button class="ledger-tab ' + (state.tab === "history" ? "active" : "") + '" data-action="tab" data-tab="history">History</button></div>' +
      '</div></div>';
  }

  function renderTodayView() {
    var dateStr = state.selectedDate, day = state.days[dateStr];
    var html = '<div class="date-row"><label for="ledger-date">Date</label>' +
      '<input id="ledger-date" type="date" class="date-input mono" value="' + dateStr + '" max="' + todayStr() + '" data-action="date-change" />' +
      '<span class="date-caption">' + fmtDateLong(dateStr) + "</span>" +
      (day ? '<button class="btn btn-small btn-light" data-action="reset-day">Reset this day</button>' : '') + '</div>';

    if (!day) {
      html += '<div class="card start-day-card"><p class="form-title">Start the day</p><form data-action="start-day">' +
        '<div class="form-field"><label for="opening">Opening cash</label><input id="opening" name="opening" type="number" min="0" step="1" class="mono-input" placeholder="e.g. 5000" required /></div>' +
        '<button type="submit" class="btn">Start day</button></form></div>';
      return html;
    }

    var totals = computeTotals(day), expected = computeExpected(day);
    html += '<div class="tiles"><div class="tile"><p class="tile-label">Opening</p><p class="tile-value bottle mono">' + fmtMoney(day.opening) + '</p></div>' +
      '<div class="tile"><p class="tile-label">Amad (in)</p><p class="tile-value brass mono">' + fmtMoney(totals.amad) + '</p></div>' +
      '<div class="tile"><p class="tile-label">Expenses (out)</p><p class="tile-value brick mono">' + fmtMoney(totals.expenses) + '</p></div>' +
      '<div class="tile"><p class="tile-label">Expected in drawer</p><p class="tile-value bottle mono">' + fmtMoney(expected) + '</p></div></div>';

    if (!day.closed) {
      var options = CATEGORY_SUGGESTIONS.map(function(c){return '<option value="' + escapeHtml(c) + '"></option>';}).join("");
      html += '<div class="forms-row"><div class="card"><p class="form-title">Add expense</p><form data-action="add-expense">' +
        '<div class="form-field"><label>Amount</label><input name="amount" type="number" min="0" step="1" class="mono-input" required /></div>' +
        '<div class="form-field"><label>Category</label><input name="category" type="text" list="category-suggestions" required /><datalist id="category-suggestions">' + options + '</datalist></div>' +
        '<div class="form-field"><label>Note (optional)</label><input name="note" type="text" /></div><button type="submit" class="btn btn-expense">Record expense</button></form></div>' +
        '<div class="card"><p class="form-title">Add amad</p><form data-action="add-amad">' +
        '<div class="form-field"><label>Amount</label><input name="amount" type="number" min="0" step="1" class="mono-input" required /></div>' +
        '<div class="form-field"><label>Note (optional)</label><input name="note" type="text" /></div><button type="submit" class="btn btn-amad">Record amad</button></form></div></div>';
    }

    var combined = day.expenses.map(function(e){return Object.assign({},e,{kind:"expense",category:e.category});})
      .concat(day.amad.map(function(a){return Object.assign({},a,{kind:"amad",category:"Amad"});})).sort(function(a,b){return a.time < b.time ? -1 : 1;});
    html += '<div class="card entries-card"><p class="entries-title">Today’s entries</p>';
    if (!combined.length) html += '<p class="empty-note">Nothing recorded yet.</p>';
    combined.forEach(function(entry){
      var isEditing = state.editing && state.editing.kind === entry.kind && state.editing.id === entry.id;
      if (isEditing && !day.closed) {
        html += '<form class="entry-edit" data-action="edit-entry" data-kind="' + entry.kind + '" data-id="' + entry.id + '">' +
          '<div class="entry-time mono">' + fmtTime(entry.time) + '</div><div class="entry-edit-fields">' +
          '<input name="amount" type="number" min="1" step="1" class="mono-input" value="' + Number(entry.amount) + '" required />' +
          (entry.kind === "expense" ? '<input name="category" value="' + escapeHtml(entry.category || "Other") + '" required />' : '') +
          '<input name="note" value="' + escapeHtml(entry.note || "") + '" placeholder="Note" />' +
          '</div><button class="btn btn-small" type="submit">Save</button><button class="btn btn-small btn-light" type="button" data-action="cancel-edit">Cancel</button></form>';
      } else {
        html += '<div class="entry-row"><span class="entry-time mono">' + fmtTime(entry.time) + '</span><div class="entry-main"><div class="entry-category">' + escapeHtml(entry.category) + '</div>' +
          (entry.note ? '<div class="entry-note">' + escapeHtml(entry.note) + '</div>' : '') + '</div>' +
          '<span class="entry-amount mono ' + (entry.kind === "amad" ? "in" : "out") + '">' + (entry.kind === "amad" ? "+" : "-") + fmtMoney(entry.amount) + '</span>' +
          (!day.closed ? '<button class="entry-edit-btn" data-action="start-edit" data-kind="' + entry.kind + '" data-id="' + entry.id + '">Edit</button>' +
          '<button class="entry-delete" data-action="delete-entry" data-kind="' + entry.kind + '" data-id="' + entry.id + '" aria-label="Delete entry">×</button>' : '') +
          '</div>';
      }
    });
    html += '</div>';

    html += '<div class="card"><p class="eod-title">End of day</p>';
    if (!day.closed) {
      html += '<form data-action="balance-day"><div class="form-field"><label for="actual">Cash counted in drawer</label><input id="actual" name="actual" type="number" min="0" step="1" class="mono-input" placeholder="e.g. 3800" required /></div>' +
        '<div class="eod-buttons"><button type="submit" class="btn">Balance only</button><button type="button" class="btn btn-amad" data-action="close-save-pdf">Close & Save PDF to Drive</button></div></form>';
    } else {
      var diff = day.actual - expected;
      html += '<div class="eod-row"><span class="label">Expected</span><span class="value mono">' + fmtMoney(expected) + '</span></div><hr class="eod-divider" />' +
        '<div class="eod-row"><span class="label">Actual counted</span><span class="value mono">' + fmtMoney(day.actual) + '</span></div>';
      if (diff === 0) html += '<div class="banner balanced">Balanced — matches exactly.</div>';
      else if (diff > 0) html += '<div class="banner excess">' + fmtMoney(diff) + ' extra in the drawer — likely an unrecorded amad.</div>';
      else html += '<div class="banner shortage">' + fmtMoney(Math.abs(diff)) + ' short — likely a missing expense entry.</div>';
      html += '<button class="reopen-link" data-action="reopen-day">Reopen this day to fix an entry</button>';
    }
    html += '</div>';
    return html;
  }

  function renderHistoryView() {
    var entries = Object.keys(state.days).sort(function(a,b){return a < b ? 1 : -1;}).map(function(date){return Object.assign({date:date},state.days[date]);});
    if (!entries.length) return '<div class="card"><p class="empty-note">No days recorded yet.</p></div>';
    var html = '<div class="card"><p class="entries-title">History</p>';
    entries.forEach(function(d){
      var expected = computeExpected(d), diff = d.closed ? d.actual - expected : null;
      var tagClass="tag-grey", tagText="Not balanced";
      if (d.closed) { if (diff===0){tagClass="tag-balanced";tagText="Balanced";} else if(diff>0){tagClass="tag-excess";tagText="+"+fmtMoney(diff);} else {tagClass="tag-shortage";tagText="-"+fmtMoney(Math.abs(diff));} }
      html += '<div class="history-row">' +
        '<button class="history-open" data-action="open-day" data-date="' + d.date + '">' +
        '<span class="history-date">' + fmtDateLong(d.date) + '</span><span class="history-meta">' + d.expenses.length + ' expense' + (d.expenses.length===1?"":"s") + ', ' + d.amad.length + ' amad</span>' +
        '<span class="history-opening mono">' + fmtMoney(d.opening) + '</span><span class="tag ' + tagClass + '">' + tagText + '</span></button>' +
        '<button class="history-delete" data-action="delete-history" data-date="' + d.date + '" aria-label="Delete day">×</button></div>';
    });
    html += '</div>';
    return html;
  }

  function attachListeners() {
    var root = document.getElementById("app-root");
    root.querySelectorAll('[data-action="tab"]').forEach(function(btn){btn.addEventListener("click",function(){state.tab=btn.dataset.tab;state.editing=null;render();});});
    var dateInput=root.querySelector("#ledger-date"); if(dateInput) dateInput.addEventListener("change",function(){state.selectedDate=dateInput.value||todayStr();state.editing=null;render();});
    var startForm=root.querySelector('[data-action="start-day"]'); if(startForm) startForm.addEventListener("submit",function(e){e.preventDefault();var v=parseFloat(startForm.opening.value);if(!isNaN(v)&&v>=0)startDay(state.selectedDate,v);});
    var expForm=root.querySelector('[data-action="add-expense"]'); if(expForm) expForm.addEventListener("submit",function(e){e.preventDefault();var v=parseFloat(expForm.amount.value);if(!isNaN(v)&&v>0)addExpense(state.selectedDate,v,expForm.category.value.trim(),expForm.note.value.trim());});
    var amadForm=root.querySelector('[data-action="add-amad"]'); if(amadForm) amadForm.addEventListener("submit",function(e){e.preventDefault();var v=parseFloat(amadForm.amount.value);if(!isNaN(v)&&v>0)addAmad(state.selectedDate,v,amadForm.note.value.trim());});
    var balanceForm=root.querySelector('[data-action="balance-day"]'); if(balanceForm) balanceForm.addEventListener("submit",function(e){e.preventDefault();var v=parseFloat(balanceForm.actual.value);if(!isNaN(v)&&v>=0)balanceDay(state.selectedDate,v);});
    var closeBtn=root.querySelector('[data-action="close-save-pdf"]'); if(closeBtn) closeBtn.addEventListener("click",closeAndSavePDF);
    var resetBtn=root.querySelector('[data-action="reset-day"]'); if(resetBtn) resetBtn.addEventListener("click",resetToday);
    var reopen=root.querySelector('[data-action="reopen-day"]'); if(reopen) reopen.addEventListener("click",function(){reopenDay(state.selectedDate);});
    root.querySelectorAll('[data-action="delete-entry"]').forEach(function(btn){btn.addEventListener("click",function(){deleteEntry(state.selectedDate,btn.dataset.kind,btn.dataset.id);});});
    root.querySelectorAll('[data-action="start-edit"]').forEach(function(btn){btn.addEventListener("click",function(){state.editing={kind:btn.dataset.kind,id:btn.dataset.id};render();});});
    root.querySelectorAll('[data-action="cancel-edit"]').forEach(function(btn){btn.addEventListener("click",function(){state.editing=null;render();});});
    root.querySelectorAll('[data-action="edit-entry"]').forEach(function(form){form.addEventListener("submit",function(e){e.preventDefault();editEntry(state.selectedDate,form.dataset.kind,form.dataset.id,form);});});
    root.querySelectorAll('[data-action="open-day"]').forEach(function(btn){btn.addEventListener("click",function(){state.selectedDate=btn.dataset.date;state.tab="today";state.editing=null;render();});});
    root.querySelectorAll('[data-action="delete-history"]').forEach(function(btn){btn.addEventListener("click",function(){deleteHistoryDay(btn.dataset.date);});});
    var exp=root.querySelector('[data-action="export-json"]'); if(exp) exp.addEventListener("click",exportJSON);
    var imp=root.querySelector("#import-json"); if(imp) imp.addEventListener("change",function(){importJSON(imp.files[0]);imp.value="";});
    var drive=root.querySelector('[data-action="drive-signin"]'); if(drive) drive.addEventListener("click",function(){ensureDriveAuth(function(){alert("Google Drive connected. You can now use “Close & Save PDF to Drive”.");});});
    if(state.undo){
      var undoBar=document.createElement("div"); undoBar.className="undo-toast";
      undoBar.innerHTML='<span>' + escapeHtml(state.undo.message) + '</span><button data-action="undo">Undo</button>';
      root.appendChild(undoBar);
      undoBar.querySelector('[data-action="undo"]').addEventListener("click",function(){
        if(state.undo){clearTimeout(state.undo.timer);var fn=state.undo.restore;state.undo=null;fn();render();}
      });
    }
  }

  render();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load",function(){navigator.serviceWorker.register("sw.js").catch(function(){});});
  }
})();
