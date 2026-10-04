// Écran du calculateur. Aucun calcul de rentabilité ici : tout vient du serveur (calculs.py),
// l'écran ne fait qu'envoyer la saisie et afficher la réponse.
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let E = null;            // état envoyé par le serveur : réglages, prestations…
let courant = null;      // prestation à l'écran : {id, nom, client, date, realisee, donnees}
let resultats = null;    // derniers résultats reçus pour la prestation à l'écran
let modifie = false;
let numeroCalcul = 0;    // pour ignorer une réponse arrivée après une saisie plus récente
let tri = { cle: 'date', sens: -1 };

const CHAMPS_SANS_VIDE = ['personnes', 'tva_pct', 'marge_cible_pct'];  // 0 y a un sens différent de « vide »
const ETATS = { rentable: '🟢 Rentable', faible: '🟠 Marge faible', deficitaire: '🔴 Déficitaire', a_chiffrer: 'Prix à fixer', vide: '' };

// ---------- outils ----------
const nf = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = v => v == null ? '—' : nf.format(v) + ' ' + E.reglages.devise;
const pct = v => v == null ? '—' : v.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %';
const nb = v => Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const jour = iso => iso.split('-').reverse().join('/');
const h = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signe = v => v < 0 ? ' class="negatif"' : '';

async function api(methode, url, corps) {
  // version téléphone (dossier mobile/) : pas de serveur, les mêmes demandes sont traitées dans le téléphone
  if (window.apiLocale) return window.apiLocale(methode, url, corps);
  const r = await fetch(url, { method: methode, headers: corps ? { 'Content-Type': 'application/json' } : {},
                               body: corps ? JSON.stringify(corps) : undefined });
  if (r.status === 401) location.reload();  // téléphone : le code d'accès est redemandé
  const d = await r.json().catch(() => ({ erreur: 'Réponse illisible du logiciel.' }));
  if (!r.ok || d.erreur) throw new Error(d.erreur || 'Erreur ' + r.status);
  return d;
}

let minuterieAvis;
function avis(texte, erreur = false) {
  const a = $('#avis');
  a.textContent = texte; a.className = erreur ? 'erreur' : ''; a.hidden = false;
  clearTimeout(minuterieAvis);
  minuterieAvis = setTimeout(() => a.hidden = true, erreur ? 7000 : 4000);
}
const echec = e => avis(e.message, true);

// ---------- onglets ----------
function ouvrirOnglet(nom) {
  $$('main > section').forEach(s => s.hidden = s.id !== nom);
  $$('nav button').forEach(b => b.classList.toggle('actif', b.dataset.onglet === nom));
  if (nom === 'liste') rendreListe();
  if (nom === 'tableau') chargerTableau();
  if (nom === 'reglages') rendreReglages();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-onglet]');
  if (b) ouvrirOnglet(b.dataset.onglet);
});

function recevoirEtat(etat) {
  E = etat;
  $('#essai').hidden = !E.essai;
  $('#a-verifier').hidden = E.reglages.verifies;
  $('#compteur').textContent = E.prestations.length || '';
}

// ---------- calcul ----------
function nouvelle() {
  courant = { id: null, nom: '', client: '', date: E.aujourdhui, realisee: false, donnees: { ...E.modele } };
  afficherFiche();
}

function ouvrir(id) {
  const p = E.prestations.find(p => p.id === id);
  if (!p) return;
  courant = { id: p.id, nom: p.nom, client: p.client, date: p.date, realisee: p.realisee, donnees: { ...p.donnees } };
  afficherFiche();
  ouvrirOnglet('calcul');
}

function afficherFiche() {
  $('#nom').value = courant.nom; $('#client').value = courant.client;
  $('#date').value = courant.date; $('#realisee').checked = courant.realisee;
  $$('[data-champ]').forEach(i => {
    const v = courant.donnees[i.dataset.champ];
    i.value = v || CHAMPS_SANS_VIDE.includes(i.dataset.champ) ? String(v).replace('.', ',') : '';
    i.placeholder = '0';
  });
  // cotisations sur le chiffre d'affaires : champ montré aux auto-entrepreneurs, ou si la prestation en porte déjà
  $('#champ-charges-ca').hidden = !(E.reglages.statut === 'micro' || courant.donnees.charges_ca_pct > 0);
  $('#titre-fiche').textContent = courant.id ? courant.nom : 'Nouvelle prestation';
  marquer(false);
  recalculer();
}

function marquer(etat) { modifie = etat; $('#modifie').hidden = !etat; }

function lireFiche() {
  courant.nom = $('#nom').value; courant.client = $('#client').value;
  courant.date = $('#date').value; courant.realisee = $('#realisee').checked;
  $$('[data-champ]').forEach(i => courant.donnees[i.dataset.champ] = i.value.trim());
}

async function recalculer() {
  const n = ++numeroCalcul;
  try {
    const r = await api('POST', '/api/calculer', { donnees: courant.donnees });
    if (n !== numeroCalcul) return;
    resultats = r;
    $('#erreur-calcul').hidden = true;
    rendreResultat();
  } catch (e) {
    if (n !== numeroCalcul) return;
    $('#erreur-calcul').textContent = e.message; $('#erreur-calcul').hidden = false;
  }
}

function rendreResultat() {
  const r = resultats, d = courant.donnees;
  $('#carte').className = 'carte ' + r.etat;
  let etat = ETATS[r.etat], gain = '', detail = '';
  if (r.etat === 'vide') { etat = 'En attente'; detail = 'Renseignez vos coûts, puis votre prix.'; }
  else if (r.etat === 'a_chiffrer') { gain = 'Prix conseillé : ' + eur(r.prix_conseille) + ' HT'; detail = 'Ne descendez pas sous ' + eur(r.prix_minimum) + ' HT.'; }
  else {
    gain = (r.resultat < 0 ? 'Vous perdez ' : 'Vous gagnez ') + eur(Math.abs(r.resultat));
    detail = [r.benefice_horaire != null ? 'soit ' + eur(r.benefice_horaire) + ' par heure' : '', pct(r.resultat_pct) + ' du prix HT'].filter(Boolean).join(' · ');
  }
  $('#carte-etat').textContent = etat; $('#carte-gain').textContent = gain; $('#carte-detail').textContent = detail;
  // sur téléphone, le résultat est sous la saisie : un bandeau fixe en bas d'écran le résume
  $('#barre-mobile').className = 'carte ' + r.etat;
  $('#barre-mobile').innerHTML = `<b>${h(gain || etat)}</b><span>${h(gain ? etat : detail)} · voir le détail ▾</span>`;
  $('#alertes').innerHTML = r.alertes.map(a => `<div class="alerte ${a.niveau}">${h(a.texte)}</div>`).join('');

  $('#s-mo').textContent = eur(r.cout_main_oeuvre);
  $('#s-achats').textContent = eur(r.cout_materiaux);
  $('#s-deplacement').textContent = eur(r.cout_deplacement);
  $('#t-fixes').textContent = eur(d.frais_fixes_heure); $('#t-taux').textContent = eur(d.taux_horaire);

  const l = (libelle, valeur, classe = '') => `<tr class="${classe}"><td>${libelle}</td><td${signe(typeof valeur === 'number' ? valeur : 0)}>${typeof valeur === 'number' ? eur(valeur) : valeur}</td></tr>`;
  const titre = t => `<tr class="titre"><td colspan="2">${t}</td></tr>`;
  $('#chiffres').innerHTML = [
    titre('Coûts hors taxes'),
    l(`Main-d'œuvre <small>${nb(r.heures_totales)} h</small>`, r.cout_main_oeuvre),
    l('Matériaux et fournitures', r.cout_materiaux),
    l('Déplacement', r.cout_deplacement),
    l('Sous-traitance', r.cout_sous_traitance),
    l('Location de matériel', r.cout_location),
    l('Autres coûts', r.cout_autres),
    l('Coût total', r.cout_total, 'total'),
    l('Part des frais fixes', r.frais_fixes),
    r.charges_ca_pct ? l(`Cotisations et impôt sur le chiffre d'affaires <small>${nb(r.charges_ca_pct)} % du prix</small>`, r.charges_ca) : '',
    l('Coût complet', r.cout_complet, 'total'),
    titre('Vente'),
    l('Prix de vente HT', r.ca_ht, 'total'),
    l(`TVA <small>${nb(r.tva_pct)} %</small>`, r.tva),
    l('Prix de vente TTC', r.ca_ttc),
    titre('Rentabilité'),
    l('Marge brute <small>prix HT − coût total</small>', r.marge_brute),
    l('Taux de marque <small>marge ÷ prix</small>', pct(r.taux_marque)),
    l('Taux de marge <small>marge ÷ coûts</small>', pct(r.taux_marge)),
    l('Résultat estimé <small>prix HT − coût complet</small>', r.resultat, 'total'),
    l('Coût horaire réel', r.cout_horaire_reel == null ? '—' : r.cout_horaire_reel),
    l('Bénéfice par heure', r.benefice_horaire == null ? '—' : r.benefice_horaire),
  ].join('');

  let ecart = '';
  if (r.ecart_prix != null) {
    ecart = r.ecart_prix >= 0 ? `Votre prix est <b style="display:inline;font-size:inherit">${eur(r.ecart_prix)}</b> au-dessus du prix conseillé.`
                              : `Votre prix est <b style="display:inline;font-size:inherit" class="negatif">${eur(-r.ecart_prix)}</b> en dessous du prix conseillé.`;
  }
  $('#conseil').innerHTML =
    `<div><span>Prix minimum (seuil de rentabilité)</span><b>${eur(r.prix_minimum)}</b><span>HT</span></div>
     <div><span>Prix conseillé (marge ${nb(r.marge_cible_pct)} %)</span><b>${eur(r.prix_conseille)}</b><span>HT</span></div>
     <div class="ecart">${ecart}</div>`;
  $('#grille').innerHTML = '<tr><th>Marge</th><th>Prix HT</th><th>Prix TTC</th><th>Gain</th></tr>' +
    r.grille.map(g => `<tr ${g.prix_ht == null ? '' : `data-prix="${g.prix_ht}"`} class="${g.marge_pct === r.marge_cible_pct ? 'cible' : ''}">
      <td>${g.marge_pct} %</td><td>${eur(g.prix_ht)}</td><td>${eur(g.prix_ttc)}</td><td>${eur(g.gain)}</td></tr>`).join('');
}

$('#barre-mobile').onclick = () => $('#resultat').scrollIntoView({ behavior: 'smooth' });
$('#saisie').addEventListener('input', () => { lireFiche(); marquer(true); recalculer(); });
$('#grille').addEventListener('click', e => {
  const ligne = e.target.closest('[data-prix]');
  if (!ligne) return;
  $('[data-champ=prix_ht]').value = ligne.dataset.prix.replace('.', ',');
  lireFiche(); marquer(true); recalculer();
});
$('#appliquer-reglages').onclick = () => {
  lireFiche();
  for (const cle of ['cout_horaire', 'cout_km', 'frais_fixes_heure', 'taux_horaire', 'tva_pct', 'marge_cible_pct', 'charges_ca_pct']) courant.donnees[cle] = E.modele[cle];
  afficherFiche(); marquer(true);
  avis('Taux de vos réglages actuels appliqués à cette prestation.');
};

async function enregistrer(silencieux = false) {
  lireFiche();
  const etat = await api('POST', '/api/prestations', courant);
  recevoirEtat(etat);
  const p = E.prestations.find(p => p.id === etat.id);
  courant = { id: p.id, nom: p.nom, client: p.client, date: p.date, realisee: p.realisee, donnees: { ...p.donnees } };
  afficherFiche();
  if (!silencieux) avis('Prestation enregistrée.');
  return p.id;
}
const idEnregistre = async () => (courant.id && !modifie) ? courant.id : enregistrer(true);

$('#enregistrer').onclick = () => enregistrer().catch(echec);
$('#nouveau').onclick = () => { if (!modifie || confirm('Abandonner les modifications non enregistrées ?')) nouvelle(); };
$('#dupliquer').onclick = async () => {
  try { await dupliquer(await idEnregistre()); } catch (e) { echec(e); }
};
$('#pdf').onclick = async () => {
  try { await exporterPdf(await idEnregistre()); } catch (e) { echec(e); }
};

async function dupliquer(id) {
  const etat = await api('POST', `/api/prestations/${id}/dupliquer`);
  recevoirEtat(etat);
  ouvrir(etat.id);
  avis('Copie créée : modifiez-la pour comparer.');
}

async function exporterPdf(id) {
  avis('Création du PDF…');
  const r = await api('POST', '/api/export/pdf/' + id);
  if (r.fichier) return avis('PDF enregistré : ' + r.fichier);
  if (r.lien) return telecharger(r.lien, 'PDF');
  if (r.fiche) {  // version téléphone : la fiche est imprimée par le téléphone, qui propose « Enregistrer en PDF »
    $('#fiche-impression').innerHTML = r.fiche;
    $('#avis').hidden = true;
    return setTimeout(() => window.print(), 50);
  }
  const f = window.open(r.imprimer);  // sans Edge : impression classique
  if (f) f.onload = () => f.print();
}

// Sur téléphone, le fichier est fabriqué sur le PC puis téléchargé par le téléphone.
function telecharger(lien, nom, nomFichier = '') {
  const a = Object.assign(document.createElement('a'), { href: lien, download: nomFichier });
  document.body.append(a); a.click(); a.remove();
  avis(nom + ' téléchargé sur ce téléphone.');
}

// ---------- liste ----------
const COLONNES = [
  ['etat', 'État', p => p.resultats.etat, p => `<span class="feu ${p.resultats.etat}">${h(ETATS[p.resultats.etat].replace(/^\S+ (?=[A-Z])/, '') || '—')}</span>`, 'texte'],
  ['date', 'Date', p => p.date, p => jour(p.date)],
  ['nom', 'Prestation', p => p.nom.toLowerCase(), p => `<b>${h(p.nom)}</b><br><span class="type">${p.realisee ? 'Réalisée' : 'Simulation'}</span>`, 'texte'],
  ['client', 'Client', p => p.client.toLowerCase(), p => h(p.client), 'texte'],
  ['prix', 'Prix HT', p => p.resultats.ca_ht, p => eur(p.resultats.ca_ht)],
  ['cout', 'Coût complet', p => p.resultats.cout_complet, p => eur(p.resultats.cout_complet)],
  ['resultat', 'Résultat', p => p.resultats.resultat, p => `<b${signe(p.resultats.resultat)}>${eur(p.resultats.resultat)}</b>`],
  ['pct', 'Résultat %', p => p.resultats.resultat_pct ?? -Infinity, p => pct(p.resultats.resultat_pct)],
  ['heure', 'Gain / heure', p => p.resultats.benefice_horaire ?? -Infinity, p => eur(p.resultats.benefice_horaire)],
  ['conseil', 'Prix conseillé', p => p.resultats.prix_conseille, p => eur(p.resultats.prix_conseille)],
];

function rendreListe() {
  const mot = $('#filtre').value.trim().toLowerCase(), type = $('#filtre-type').value;
  const col = COLONNES.find(c => c[0] === tri.cle);
  const lignes = E.prestations
    .filter(p => (!mot || (p.nom + ' ' + p.client).toLowerCase().includes(mot)) && (type === '' || p.realisee === (type === '1')))
    .sort((a, b) => { const x = col[2](a), y = col[2](b); return (x < y ? -1 : x > y ? 1 : b.id - a.id) * tri.sens; });
  $('#liste-vide').hidden = lignes.length > 0;
  $('#liste-vide').textContent = E.prestations.length ? 'Aucune prestation ne correspond au filtre.' : 'Aucune prestation enregistrée pour l\'instant.';
  $('#table-liste').innerHTML = '<tr>' + COLONNES.map(c => `<th data-tri="${c[0]}" class="${c[4] || ''}">${c[1]}${tri.cle === c[0] ? (tri.sens > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('') + '<th></th></tr>' +
    lignes.map(p => `<tr data-id="${p.id}">` + COLONNES.map(c => `<td class="${c[4] || ''}" data-l="${c[1]}">${c[3](p)}</td>`).join('') +
      `<td class="boutons"><button class="petit" data-action="ouvrir">Ouvrir</button> <button class="petit" data-action="dupliquer">Dupliquer</button> <button class="petit" data-action="pdf">PDF</button> <button class="petit" data-action="supprimer">Supprimer</button></td></tr>`).join('');
}
$('#filtre').oninput = rendreListe; $('#filtre-type').onchange = rendreListe;
$('#table-liste').addEventListener('click', async e => {
  const th = e.target.closest('th[data-tri]');
  if (th) { tri = { cle: th.dataset.tri, sens: tri.cle === th.dataset.tri ? -tri.sens : -1 }; return rendreListe(); }
  const b = e.target.closest('button[data-action]');
  if (!b) return;
  const id = Number(b.closest('tr').dataset.id), p = E.prestations.find(p => p.id === id);
  try {
    if (b.dataset.action !== 'pdf' && b.dataset.action !== 'supprimer' && modifie && !confirm('Abandonner les modifications non enregistrées de la prestation en cours ?')) return;
    if (b.dataset.action === 'ouvrir') ouvrir(id);
    if (b.dataset.action === 'dupliquer') await dupliquer(id);
    if (b.dataset.action === 'pdf') await exporterPdf(id);
    if (b.dataset.action === 'supprimer' && confirm(`Supprimer définitivement « ${p.nom} » ?`)) {
      recevoirEtat(await api('DELETE', '/api/prestations/' + id));
      if (courant.id === id) nouvelle();
      rendreListe();
      avis('Prestation supprimée.');
    }
  } catch (err) { echec(err); }
});
$('#export-csv').onclick = async () => {
  try {
    const r = await api('POST', '/api/export/csv');
    if (r.lien) telecharger(r.lien, 'Fichier CSV', r.nom); else avis('Fichier CSV enregistré : ' + r.fichier);
  } catch (e) { echec(e); }
};

// ---------- tableau de bord ----------
async function chargerTableau() {
  if (!$('#mois').value) $('#mois').value = E.aujourdhui.slice(0, 7);
  let t;
  try { t = await api('GET', '/api/tableau?mois=' + $('#mois').value); } catch (e) { return echec(e); }
  $('#tb-nombre').textContent = t.nombre ? `${t.nombre} prestation${t.nombre > 1 ? 's' : ''} réalisée${t.nombre > 1 ? 's' : ''} ce mois-ci`
    : 'Aucune prestation réalisée ce mois-ci. Cochez « Prestation réalisée » sur une prestation pour la compter ici.';
  const tuile = (titre, valeur, sous = '', classe = '') => `<div class="tuile ${classe}"><span>${titre}</span><b>${valeur}</b><small>${sous}</small></div>`;
  $('#tuiles').innerHTML =
    tuile('Chiffre d\'affaires HT', eur(t.ca_ht)) + tuile('Coûts des prestations', eur(t.couts)) +
    tuile('Marge brute', eur(t.marge_brute), pct(t.marge_pct) + ' du chiffre d\'affaires') +
    (t.charges_ca ? tuile('Cotisations sur le chiffre d\'affaires', eur(t.charges_ca), 'auto-entrepreneur : à verser à l\'Urssaf') : '') +
    tuile('Frais fixes du mois', eur(t.frais_fixes), 'd\'après vos réglages') +
    tuile(t.impot_societes == null ? 'Bénéfice estimé' : 'Bénéfice avant impôt', eur(t.benefice), t.charges_ca ? 'marge brute − cotisations − frais fixes' : 'marge brute − frais fixes', t.benefice < 0 ? 'deficitaire' : 'rentable') +
    // SARL : impôt sur les sociétés estimé sur le bénéfice du mois
    (t.impot_societes == null ? '' : tuile('Impôt sur les sociétés estimé', eur(t.impot_societes), '15 % puis 25 % au-delà de 42 500 € par an') +
      tuile('Bénéfice après impôt', eur(t.benefice_apres_is), 'reste dans la société', t.benefice_apres_is < 0 ? 'deficitaire' : 'rentable'));
  const alertes = [];
  if (t.deficitaires.length) alertes.push(['rouge', `${t.deficitaires.length} prestation${t.deficitaires.length > 1 ? 's' : ''} déficitaire${t.deficitaires.length > 1 ? 's' : ''} ce mois-ci.`]);
  if (t.nombre && t.benefice < 0) alertes.push(['orange', `La marge du mois ne couvre pas encore les frais fixes : il manque ${eur(-t.benefice)}.`]);
  $('#tb-alertes').innerHTML = alertes.map(a => `<div class="alerte ${a[0]}">${h(a[1])}</div>`).join('');

  const maxi = Math.max(1, ...t.prestations.map(p => Math.abs(p.resultat)));
  $('#g-prestations').innerHTML = t.prestations.map(p => `<div class="rang rangee-graphe" title="${h(p.nom)}"><span class="nom">${h(p.nom)}</span>
    <span class="piste"><i class="${p.resultat < 0 ? 'negatif' : ''}" style="width:${Math.abs(p.resultat) / maxi * 100}%"></i></span>
    <span class="val${p.resultat < 0 ? ' negatif' : ''}">${eur(p.resultat)}</span></div>`).join('') || '<p class="vide-texte">Rien à afficher.</p>';

  const maxMois = Math.max(1, ...t.historique.map(m => Math.max(m.ca_ht, m.marge_brute)));
  $('#g-mois').innerHTML = t.historique.map(m => {
    const nom = new Date(m.mois + '-01T12:00').toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
    return `<div class="mois" title="${nom} : CA ${eur(m.ca_ht)}, marge ${eur(m.marge_brute)}"><div class="paire">
      <i class="c-ca" style="height:${m.ca_ht / maxMois * 100}%"></i><i class="c-marge" style="height:${Math.max(0, m.marge_brute) / maxMois * 100}%"></i></div>
      <span>${nom}</span><span>${m.ca_ht ? nf.format(m.ca_ht) : '—'}</span></div>`;
  }).join('');

  const rangee = p => `<div class="rangee" data-id="${p.id}"><span>${h(p.nom)}${p.client ? ' <small>' + h(p.client) + '</small>' : ''}</span>
    <b${signe(p.resultat)}>${eur(p.resultat)} <small>${pct(p.resultat_pct)}</small></b></div>`;
  $('#tb-rentables').innerHTML = t.rentables.map(rangee).join('') || '<p class="vide-texte">Aucune.</p>';
  $('#tb-deficitaires').innerHTML = t.deficitaires.map(rangee).join('') || '<p class="vide-texte">Aucune : tant mieux.</p>';
}
$('#mois').onchange = chargerTableau;
$('#tableau').addEventListener('click', e => {
  const r = e.target.closest('.rangee[data-id]');
  if (r && (!modifie || confirm('Abandonner les modifications non enregistrées de la prestation en cours ?'))) ouvrir(Number(r.dataset.id));
});

// ---------- réglages ----------
const champReglage = cle => $(`[data-reglage=${cle}]`);
const ecrireReglage = (cle, v) => champReglage(cle).value = String(v).replace('.', ',');
const lireNombre = champ => Number(champ.value.replace(/\s/g, '').replace(',', '.')) || 0;

// Ce qui dépend du statut choisi (avant même l'enregistrement).
function afficherStatut() {
  const statut = $('#statut').value, micro = statut === 'micro', sarl = statut === 'sarl';
  $('#bloc-micro').hidden = !micro;
  $('#bloc-sarl').hidden = !sarl;
  $('#bloc-ei').hidden = statut !== 'ei';
  $('#champ-charges').hidden = micro;
  const brut = sarl && E.profils[$('#profil').value][1] === 'brut';  // salarié : on raisonne en salaire brut
  $('#libelle-salaire').innerHTML = micro ? 'Ce que je veux garder par mois <small>une fois cotisations et frais payés</small>'
    : brut ? 'Salaire brut par mois <small>hors charges patronales</small>'
    : statut === 'classique' ? 'Rémunération par mois <small>hors charges</small>'
    : 'Rémunération souhaitée par mois <small>nette, avant cotisations</small>';
  $('#libelle-charges').innerHTML = brut ? 'Charges patronales % <small>en plus du salaire brut</small>'
    : statut === 'classique' ? 'Charges sociales % <small>en plus de la rémunération</small>'
    : 'Cotisations sociales % <small>en plus de la rémunération nette</small>';
  $('#aide-remuneration').textContent = micro
    ? 'Un auto-entrepreneur n\'a pas de salaire brut : indiquez ce que vous voulez garder chaque mois. Les cotisations sont comptées sur le prix de vente, avec les taux ci-dessus.'
    : brut ? 'Le coût pour la société est le salaire brut plus les charges patronales.'
    : statut === 'classique' ? 'Le coût est la rémunération plus les charges. Le taux dépend de votre régime : vérifiez votre taux réel.'
    : 'Un indépendant n\'a pas de salaire brut : indiquez ce que vous voulez vous verser chaque mois, le logiciel y ajoute les cotisations. Le taux dépend de votre régime et de votre revenu : vérifiez votre taux réel.';
  $('#versement-liberatoire').checked = lireNombre(champReglage('impot_ca_pct')) > 0;
  $('#champ-tva').hidden = !$('#assujetti-tva').checked;
}
// Choix d'une activité (ou du versement libératoire) : propose les taux officiels, qui restent modifiables.
function proposerTaux() {
  const [, cotisations, impot, cfp, tfc] = E.activites[$('#activite').value];
  ecrireReglage('cotisations_ca_pct', cotisations); ecrireReglage('cfp_pct', cfp); ecrireReglage('tfc_pct', tfc);
  ecrireReglage('impot_ca_pct', $('#versement-liberatoire').checked ? impot : 0);
}
// Entreprise individuelle, SARL : propose le taux de charges correspondant, qui reste modifiable.
function proposerCharges() {
  if ($('#statut').value === 'sarl') ecrireReglage('charges_pct', E.profils[$('#profil').value][2]);
  if ($('#statut').value === 'ei') ecrireReglage('charges_pct', E.charges_ei_pct);
  afficherStatut();
}
$('#statut').onchange = proposerCharges;
$('#profil').onchange = proposerCharges;
$('#activite').onchange = proposerTaux;
$('#versement-liberatoire').onchange = proposerTaux;
$('#assujetti-tva').onchange = e => {
  if (!e.target.checked) ecrireReglage('tva_pct', 0);
  else if (!lireNombre(champReglage('tva_pct'))) ecrireReglage('tva_pct', 20);
  afficherStatut();
};

// Tout ce qui est saisi dans les réglages, tel quel : c'est le serveur qui contrôle et calcule.
function saisieReglages() {
  const corps = { frais_detail: {} };
  $$('[data-reglage]').forEach(i => corps[i.dataset.reglage] = i.value.trim());
  $$('[data-poste]').forEach(i => corps.frais_detail[i.dataset.poste] = i.value.trim());
  return corps;
}

// Synthèse « Votre rentabilité », d'après des réglages enregistrés ou en cours de saisie.
function rendreSynthese(d, r) {
  const micro = r.statut === 'micro';
  const l = (libelle, valeur, classe = '') => `<tr class="${classe}"><td>${libelle}</td><td>${valeur}</td></tr>`;
  const heures = v => v == null ? '—' : nb(v) + ' h';
  const alertes = [];
  if (!d.heures_facturables) alertes.push(['rouge', 'Aucune heure facturable : indiquez vos heures travaillées et la part que vous pouvez facturer.']);
  else if (d.cout_horaire_trop_eleve) alertes.push(['rouge', `Votre tarif actuel (${eur(r.taux_horaire)}) est en dessous du taux horaire minimum (${eur(d.taux_minimum)}) : à ce prix, vos heures ne couvrent pas vos coûts.`]);
  else if (d.taux_conseille != null && r.taux_horaire < d.taux_conseille) alertes.push(['orange', `Votre tarif actuel (${eur(r.taux_horaire)}) couvre vos coûts mais ne dégage pas la marge visée : il faudrait ${eur(d.taux_conseille)}.`]);
  if (d.taux_conseille == null) alertes.push(['rouge', 'Marge visée impossible : avec les cotisations sur le chiffre d\'affaires, le total atteint 100 % du prix.']);
  if (d.heures_a_vendre != null && d.heures_facturables && d.heures_a_vendre > d.heures_facturables) alertes.push(['rouge', `À votre tarif actuel il faudrait vendre ${heures(d.heures_a_vendre)} par mois pour couvrir vos coûts, alors que vous n'en avez que ${heures(d.heures_facturables)} de facturables.`]);
  $('#r-derives').innerHTML = `<h3 style="margin-top:0">Votre rentabilité</h3><table class="chiffres">` + [
    l('Heures travaillées par mois', heures(r.heures_travaillees_mois)),
    l('Heures facturables par mois', heures(d.heures_facturables)),
    l(micro ? 'Ce que vous voulez garder' : 'Rémunération', eur(r.remuneration_mensuelle)),
    micro ? l('Cotisations et impôt', `${nb(d.charges_ca_pct)} % du prix de vente`) : l('Cotisations estimées', eur(d.cotisations_mensuelles)),
    l('Frais fixes', eur(r.frais_fixes_mensuels)),
    l(micro ? 'Coût total mensuel <small>avant cotisations sur le chiffre d\'affaires</small>' : 'Coût total mensuel', eur(d.cout_total_mensuel), 'total'),
    l('Coût réel par heure facturable <small>' + eur(d.cout_horaire_charge) + ' de rémunération + ' + eur(d.frais_fixes_heure) + ' de frais fixes</small>', eur(d.cout_heure_complet), 'total'),
    l('Taux horaire minimum <small>en dessous, vous perdez de l\'argent</small>', eur(d.taux_minimum) + ' HT'),
    l(`Taux horaire conseillé <small>pour ${nb(r.marge_cible_pct)} % de marge${d.coefficient ? ', soit coût × ' + nb(d.coefficient) : ''}</small>`, d.taux_conseille == null ? '—' : eur(d.taux_conseille) + ' HT', 'total'),
    l('Chiffre d\'affaires à faire par mois <small>main-d\'œuvre seule, hors achats refacturés</small>', `${eur(d.ca_minimum)} au minimum${d.ca_conseille == null ? '' : ', ' + eur(d.ca_conseille) + ' conseillé'}`),
    l(`Heures à vendre à votre tarif actuel <small>${eur(r.taux_horaire)} HT, pour couvrir vos coûts</small>`, heures(d.heures_a_vendre)),
    micro ? l(`Ce qu'il vous reste d'une heure facturée ${eur(r.taux_horaire)}`, eur(d.heure_facturee_nette)) : '',
  ].join('') + '</table>' + alertes.map(a => `<div class="alerte ${a[0]}">${h(a[1])}</div>`).join('');
  // frais fixes détaillés : le total affiché est la somme calculée
  const detaille = Object.keys(r.frais_detail).length > 0;
  champReglage('frais_fixes_mensuels').readOnly = detaille;
  if (detaille) ecrireReglage('frais_fixes_mensuels', r.frais_fixes_mensuels);
  $('#aide-frais').textContent = detaille ? 'somme des postes détaillés ci-dessous' : 'loyer, assurances, abonnements…';
}

// Pendant la saisie : la synthèse est recalculée sans rien enregistrer.
let numeroApercu = 0, minuterieApercu;
function apercuReglages() {
  clearTimeout(minuterieApercu);
  minuterieApercu = setTimeout(async () => {
    const n = ++numeroApercu;
    try {
      const a = await api('POST', '/api/reglages/apercu', saisieReglages());
      if (n === numeroApercu) rendreSynthese(a.derives, a.reglages);
    } catch (e) {
      if (n === numeroApercu) $('#r-derives').innerHTML = `<div class="alerte rouge">${h(e.message)}</div>`;
    }
  }, 200);
}
$('#form-reglages').addEventListener('input', () => { afficherStatut(); apercuReglages(); });
$('#form-reglages').addEventListener('change', apercuReglages);

function rendreReglages() {
  $('#activite').innerHTML = Object.entries(E.activites).map(([cle, a]) => `<option value="${cle}">${h(a[0])}</option>`).join('');
  $('#profil').innerHTML = Object.entries(E.profils).map(([cle, p]) => `<option value="${cle}">${h(p[0])} — environ ${nb(p[2])} % en plus du ${p[1]}</option>`).join('');
  $('#postes-frais').innerHTML = E.postes_frais.map(([cle, libelle]) => `<label>${h(libelle)}<input data-poste="${cle}" inputmode="decimal" placeholder="0"></label>`).join('');
  $$('[data-poste]').forEach(i => { const v = E.reglages.frais_detail[i.dataset.poste]; i.value = v ? String(v).replace('.', ',') : ''; });
  $('#detail-frais').open = Object.keys(E.reglages.frais_detail).length > 0;
  $$('[data-reglage]').forEach(i => i.value = i.tagName === 'SELECT' ? E.reglages[i.dataset.reglage] : String(E.reglages[i.dataset.reglage]).replace('.', ','));
  $('#assujetti-tva').checked = E.reglages.tva_pct > 0;
  afficherStatut();
  rendreSynthese(E.derives, E.reglages);
  // accès téléphone : ne se règle que sur le PC
  const t = E.telephone;
  $('#bloc-telephone').hidden = !E.local;
  $('#telephone-actif').checked = t.actif;
  $('#telephone-infos').hidden = !t.adresse;
  $('#telephone-adresse').textContent = t.adresse || '';
  $('#telephone-code').textContent = t.code || '';
}
async function reglerTelephone(corps) {
  try { recevoirEtat(await api('POST', '/api/telephone', corps)); } catch (e) { echec(e); }
  rendreReglages();
}
$('#telephone-actif').onchange = e => reglerTelephone({ actif: e.target.checked });
$('#telephone-nouveau-code').onclick = () => {
  if (confirm('Changer le code ? Les téléphones déjà reliés devront saisir le nouveau.')) reglerTelephone({ actif: true, nouveau_code: true });
};
$('#enregistrer-reglages').onclick = async () => {
  clearTimeout(minuterieApercu); numeroApercu++;
  try {
    recevoirEtat(await api('POST', '/api/reglages', saisieReglages()));
    rendreReglages();
    if (!courant.id && !modifie) nouvelle();
    avis('Réglages enregistrés.');
  } catch (e) { echec(e); }
};

window.addEventListener('beforeunload', e => { if (modifie) e.preventDefault(); });

api('GET', '/api/etat').then(etat => { recevoirEtat(etat); nouvelle(); }).catch(echec);
