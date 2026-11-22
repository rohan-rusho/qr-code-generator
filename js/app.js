"use strict";

/* QR Code Generator — live rendering with the built-in encoder (js/qrcode.js). */

var els = {};
["qr-text", "char-count", "qr-canvas", "qr-empty", "qr-preview",
 "meta-version", "meta-size", "meta-ec", "meta-modules",
 "download-btn", "copy-btn", "size-small", "size-medium", "size-large",
 "nav-toggle", "mobile-menu", "site-header", "toast", "year"
].forEach(function (id) { els[id] = document.getElementById(id); });

var currentQr = null;
var currentPngSize = 512;

function byteLength(text) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  return text.length;
}

function renderQr() {
  var text = els["qr-text"].value;
  var bytes = byteLength(text);

  if (!text) {
    els["qr-canvas"].classList.add("hidden");
    els["qr-empty"].classList.remove("hidden");
    els["meta-version"].textContent = "—";
    els["meta-size"].textContent = "—";
    els["meta-modules"].textContent = "—";
    els["download-btn"].disabled = true;
    currentQr = null;
    updateCharCount(bytes);
    return;
  }

  try {
    currentQr = QRCode.encode(text);
  } catch (e) {
    els["qr-canvas"].classList.add("hidden");
    els["qr-empty"].classList.remove("hidden");
    els["qr-empty"].textContent = e.message;
    els["download-btn"].disabled = true;
    currentQr = null;
    updateCharCount(bytes);
    return;
  }

  els["qr-empty"].classList.add("hidden");
  els["qr-canvas"].classList.remove("hidden");
  drawQr(currentQr, els["qr-canvas"]);
  els["meta-version"].textContent = "Version " + currentQr.version;
  els["meta-size"].textContent = currentQr.size + " × " + currentQr.size;
  els["meta-modules"].textContent = currentQr.size + " × " + currentQr.size + " modules";
  els["download-btn"].disabled = false;
  updateCharCount(bytes);
}

function updateCharCount(bytes) {
  var max = QRCode.MAX_BYTES;
  els["char-count"].textContent = bytes + " / " + max + " bytes (UTF-8)";
  els["char-count"].style.color = bytes > max ? "#ff6b6b" : "";
}

function drawQr(qr, canvas) {
  var quiet = 4; // quiet zone in modules
  var total = qr.size + quiet * 2;
  var px = currentPngSize;
  canvas.width = px;
  canvas.height = px;
  var ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff6e9";
  ctx.fillRect(0, 0, px, px);
  var module = px / total;
  ctx.fillStyle = "#14100c";
  for (var y = 0; y < qr.size; y++) {
    for (var x = 0; x < qr.size; x++) {
      if (qr.modules[y][x]) {
        ctx.fillRect(Math.floor((x + quiet) * module), Math.floor((y + quiet) * module), Math.ceil(module), Math.ceil(module));
      }
    }
  }
}

/* ---- download ---- */
function downloadPng() {
  if (!currentQr) return;
  drawQr(currentQr, els["qr-canvas"]);
  els["qr-canvas"].toBlob(function (blob) {
    if (!blob) { showToast("Could not create the PNG"); return; }
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "qr-code-" + currentPngSize + "px.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast("QR code downloaded ✓");
  }, "image/png");
}

/* ---- copy text ---- */
function copyText(text) {
  function done() { showToast("Copied to clipboard ✓"); }
  function fallback() {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); }
    catch (e) { showToast("Copy failed — select the text manually"); }
    document.body.removeChild(ta);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, fallback);
  } else {
    fallback();
  }
}

/* ---- toast ---- */
var toastTimer = null;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { els.toast.classList.remove("show"); }, 2400);
}

/* ---- wiring ---- */
els["qr-text"].addEventListener("input", renderQr);
els["download-btn"].addEventListener("click", downloadPng);
els["copy-btn"].addEventListener("click", function () {
  if (!els["qr-text"].value) { showToast("Type something first"); return; }
  copyText(els["qr-text"].value);
});

var sizeButtons = [
  { el: els["size-small"], px: 256 },
  { el: els["size-medium"], px: 512 },
  { el: els["size-large"], px: 1024 }
];
sizeButtons.forEach(function (entry) {
  entry.el.addEventListener("click", function () {
    currentPngSize = entry.px;
    sizeButtons.forEach(function (e) {
      e.el.classList.toggle("active", e === entry);
      e.el.setAttribute("aria-pressed", String(e === entry));
    });
    if (currentQr) drawQr(currentQr, els["qr-canvas"]);
    showToast("PNG size set to " + entry.px + " × " + entry.px);
  });
});

document.querySelectorAll("[data-example]").forEach(function (btn) {
  btn.addEventListener("click", function () {
    els["qr-text"].value = btn.getAttribute("data-example");
    renderQr();
    els["qr-text"].focus();
  });
});

/* Header + nav */
window.addEventListener("scroll", function () {
  els["site-header"].classList.toggle("scrolled", window.scrollY > 8);
}, { passive: true });
els["nav-toggle"].addEventListener("click", function () {
  var open = els["mobile-menu"].classList.toggle("open");
  els["nav-toggle"].setAttribute("aria-expanded", String(open));
});
els["mobile-menu"].querySelectorAll("a").forEach(function (a) {
  a.addEventListener("click", function () {
    els["mobile-menu"].classList.remove("open");
    els["nav-toggle"].setAttribute("aria-expanded", "false");
  });
});

/* Reveal on scroll */
var revealObserver = new IntersectionObserver(function (entries) {
  entries.forEach(function (entry) {
    if (entry.isIntersecting) { entry.target.classList.add("visible"); revealObserver.unobserve(entry.target); }
  });
}, { threshold: 0.12 });
document.querySelectorAll(".reveal").forEach(function (el) { revealObserver.observe(el); });

els.year.textContent = new Date().getFullYear();

/* Initial render */
renderQr();
