// Fallback pages for the Android shell. `window.SOMM_APP_URL` comes from app-url.js,
// written at build time by scripts/prepare-mobile.mjs.
(function () {
  var url = window.SOMM_APP_URL || '';
  var retry = document.getElementById('retry');
  var status = document.getElementById('status');
  var message = document.getElementById('message');

  if (!url) {
    if (message) message.textContent = 'This build has no server address. Rebuild the app with the SOMM_APP_URL repository variable set.';
    return;
  }

  function attempt() {
    if (retry) retry.disabled = true;
    if (status) status.textContent = 'Waking the server… this can take up to a minute.';
    // A no-cors request resolves once the server answers at all, then load the app.
    fetch(url + '/api/health', { mode: 'no-cors', cache: 'no-store' })
      .then(function () {
        window.location.replace(url + '/');
      })
      .catch(function () {
        if (status) status.textContent = 'Still unreachable. Check your connection and try again.';
        if (retry) retry.disabled = false;
      });
  }

  if (retry) {
    retry.hidden = false;
    retry.addEventListener('click', attempt);
  }
  // index.html is only shown if the remote page did not load; try straight away.
  if (message) attempt();
})();
