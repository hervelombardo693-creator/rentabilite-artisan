// Version téléphone : installation, fonctionnement hors connexion, sauvegarde des données.
(() => {
  const $ = s => document.querySelector(s);
  const dire = (texte, erreur = false) => {
    const a = $('#avis');
    a.textContent = texte; a.className = erreur ? 'erreur' : ''; a.hidden = false;
    setTimeout(() => a.hidden = true, 6000);
  };

  // hors connexion : le navigateur garde une copie de l'application (voir sw.js)
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  // demande au téléphone de ne pas effacer les données de lui-même quand la place manque
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // Android : le navigateur propose l'installation ; on l'offre par un bouton
  let invitation = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); invitation = e; $('#installer').hidden = false; });
  window.addEventListener('appinstalled', () => { $('#installer').hidden = true; });
  $('#installer').onclick = async () => { if (invitation) { invitation.prompt(); await invitation.userChoice; invitation = null; $('#installer').hidden = true; } };
  const installee = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $('#aide-installation').hidden = !!installee;

  $('#sauvegarder').onclick = () => {
    const s = Donnees.exporter();
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([s.contenu], { type: 'application/json' })), download: s.nom });
    document.body.append(a); a.click(); a.remove();
    dire('Sauvegarde téléchargée. Gardez ce fichier ailleurs que dans ce téléphone (e-mail, cloud…).');
  };
  $('#restaurer').onclick = () => $('#fichier-sauvegarde').click();
  $('#fichier-sauvegarde').onchange = async e => {
    const fichier = e.target.files[0];
    e.target.value = '';
    if (!fichier) return;
    try {
      const contenu = await fichier.text();
      const nombre = Donnees.compter(contenu);
      if (!confirm(`Cette sauvegarde contient ${nombre} prestation(s).\nElle va REMPLACER les ${Donnees.nombre()} prestation(s) et les réglages de ce téléphone. Continuer ?`)) return;
      Donnees.restaurer(contenu);
      location.reload();
    } catch (err) { dire(err.message, true); }
  };
})();
