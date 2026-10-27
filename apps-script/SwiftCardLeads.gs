/**
 * SwiftCard Leads — the Sheet's edit hook.
 *
 * Installed once in the workbook (Extensions → Apps Script → paste this file),
 * with two Script Properties:
 *   HOOK_URL     https://swiftcard.me/api/crew/sheet-hook
 *   HOOK_SECRET  the value of CREW_SHEET_HOOK_SECRET in Vercel
 * and ONE installable trigger: function `onSheetEdit`, event source "From
 * spreadsheet", event type "On edit". (A simple onEdit cannot call external
 * services, so it must be the installable kind.) Details: SETUP.md.
 *
 * What it does: when someone changes a cell in a column the backend reads
 * (Status, Notes, a date, a message, or the Controls Value column), it posts
 * the tab name, the row's Key, the column header and the new value to the
 * backend, which applies it within seconds. The 15-minute sync remains the
 * fallback, so a missed post is never lost. It never reads other rows, never
 * sends the whole sheet, and never touches cells itself except to show a
 * short note when the backend refuses a value.
 */

var KEY_HEADERS = ["Key"];

function onSheetEdit(e) {
  try {
    if (!e || !e.range) return;
    var props = PropertiesService.getScriptProperties();
    var url = props.getProperty("HOOK_URL");
    var secret = props.getProperty("HOOK_SECRET");
    if (!url || !secret) return;
    var sheet = e.range.getSheet();
    var tab = sheet.getName();
    if (tab === "Dashboard") return;
    var row = e.range.getRow();
    if (row < 2 || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var header = String(headers[e.range.getColumn() - 1] || "");
    if (!header) return;
    var keyCol = -1;
    for (var i = headers.length - 1; i >= 0; i--) {
      if (KEY_HEADERS.indexOf(String(headers[i])) >= 0) {
        keyCol = i;
        break;
      }
    }
    var key = keyCol >= 0 ? String(sheet.getRange(row, keyCol + 1).getValue() || "") : "";
    if (tab !== "Controls" && !key) return; // a new row the sync hasn't keyed yet
    var value = e.value !== undefined ? String(e.value) : String(e.range.getValue());
    var editor = (e.user && e.user.getEmail && e.user.getEmail()) || Session.getActiveUser().getEmail() || "";
    var res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + secret },
      payload: JSON.stringify({ tab: tab, key: key, header: header, value: value, editor: editor }),
      muteHttpExceptions: true,
    });
    var body = {};
    try {
      body = JSON.parse(res.getContentText());
    } catch (err) {
      body = {};
    }
    if (res.getResponseCode() === 200 && body && body.ok === false && body.message) {
      // Put back what the backend said, and say why, in a note that fades on the next edit.
      if (body.value !== undefined) e.range.setValue(body.value);
      if (body.status !== undefined) e.range.setValue(body.status);
      e.range.setNote("SwiftCard: " + body.message);
    } else if (body && body.ok) {
      e.range.setNote("");
    }
  } catch (err) {
    // Never throw from a trigger: the owner would see a red error every edit.
    console.log("hook failed: " + err);
  }
}
