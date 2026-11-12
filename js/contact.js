// Writes the Impressum contact address into the page. The address is stored as shifted
// character codes so that it doesn't appear in the HTML for simple scrapers.
(function () {
  const codes = [117, 103, 104, 106, 104, 113, 105, 104, 111, 111, 113, 104, 117, 46, 120, 118, 48, 102, 114, 113, 106, 117, 104, 118, 118, 67, 106, 112, 100, 108, 111, 49, 102, 114, 112];
  const address = String.fromCharCode(...codes.map((c) => c - 3));
  const target = document.getElementById('contact-email');
  if (!target) return;
  const link = document.createElement('a');
  link.href = `mailto:${address}`;
  link.textContent = address;
  target.replaceChildren(link);
})();
