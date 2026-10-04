// Version téléphone : remplace le serveur du PC (../server.py). L'écran (app.js) appelle les mêmes adresses
// /api/... ; ici elles sont traitées dans le téléphone et les données sont rangées dans sa mémoire (localStorage).
// Rien ne part sur Internet.
(() => {
  const C = Calculs;
  const CLE = 'rentabilite.v1';
  const ETATS = { rentable: 'Rentable', faible: 'Marge faible', deficitaire: 'Déficitaire', a_chiffrer: 'Prix à fixer', vide: '' };

  class Erreur extends Error {}

  // ---------- mémoire du téléphone ----------
  function lire() {
    let base = null;
    try { base = JSON.parse(localStorage.getItem(CLE)); } catch (e) { /* illisible : on repart d'une base vide */ }
    if (!base || typeof base !== 'object') base = {};
    return { reglages: base.reglages || {}, prestations: Array.isArray(base.prestations) ? base.prestations : [], suite: base.suite || 1 };
  }
  function ecrire(base) {
    try { localStorage.setItem(CLE, JSON.stringify(base)); }
    catch (e) { throw new Erreur("Enregistrement impossible : la mémoire réservée au navigateur est pleine ou bloquée (navigation privée ?)."); }
  }

  function reglages(base) {
    const r = { entreprise: '', devise: '€', statut: 'classique', activite: C.ACTIVITE_DEFAUT, profil: C.PROFIL_DEFAUT, frais_detail: {}, verifies: false };
    for (const [nom, [, defaut]] of Object.entries(C.REGLAGES)) r[nom] = defaut;
    // des réglages enregistrés par une version antérieure sont convertis à la lecture (voir Calculs.migrer)
    for (const [cle, v] of Object.entries(C.migrer(base.reglages))) if (cle in r) r[cle] = v;
    return r;
  }

  // Frais fixes saisis poste par poste → {poste: montant} (postes vides écartés).
  function fraisDetailles(detail) {
    if (detail === null || detail === undefined || detail === '') return {};
    if (typeof detail !== 'object' || Array.isArray(detail)) throw new Erreur('Données illisibles.');
    const montants = {};
    for (const [cle, libelle] of C.POSTES_FRAIS) {
      const v = C.normaliser({ v: detail[cle] }, { v: [libelle, 0, 10000000] }).v;
      if (v) montants[cle] = v;
    }
    return montants;
  }

  // ---------- validation (mêmes règles et messages que server.py) ----------
  function texte(v, champ, maxi, obligatoire = false) {
    v = v === null || v === undefined ? '' : String(v).trim();
    if (obligatoire && !v) throw new Erreur(`${champ} : à renseigner.`);
    if ([...v].length > maxi) throw new Erreur(`${champ} : ${maxi} caractères maximum.`);
    return v;
  }
  // Réglages saisis → réglages enregistrés (mêmes contrôles que enregistrer_reglages de server.py).
  function reglagesValides(d, verifies) {
    d = C.migrer(d);
    const detail = fraisDetailles(d.frais_detail);
    // le détail, s'il existe, fait foi : le total est la somme des postes (en centimes entiers)
    if (Object.keys(detail).length) d.frais_fixes_mensuels = Object.values(detail).reduce((s, v) => s + Math.round(v * 100), 0) / 100;
    const r = { frais_detail: detail, entreprise: texte(d.entreprise, "Nom de l'entreprise", 80), devise: texte(d.devise, 'Devise', 4) || '€', verifies,
                statut: d.statut || 'classique', activite: d.activite || C.ACTIVITE_DEFAUT, profil: d.profil || C.PROFIL_DEFAUT };
    if (!C.STATUTS.includes(r.statut) || !Object.hasOwn(C.ACTIVITES_MICRO, r.activite) || !Object.hasOwn(C.PROFILS_SARL, r.profil)) throw new Erreur('Statut ou activité inconnu.');
    Object.assign(r, C.normaliser(d, C.REGLAGES));
    C.calculer(C.modele(r));  // refuse des réglages inutilisables (marge visée + cotisations ≥ 100 %)
    return r;
  }
  function dateIso(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
    const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!m || +m[1] < 1 || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new Erreur('Date illisible.');
    return m[0];
  }
  function moisIso(v) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v || '')) throw new Erreur('Mois illisible.');
    return v;
  }
  const aujourdhui = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  const sortie = (p, devise) => ({ id: p.id, nom: p.nom, client: p.client, date: p.date, realisee: !!p.realisee, donnees: p.donnees, resultats: C.calculer(p.donnees, devise) });
  const classees = liste => [...liste].sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id);  // plus récentes d'abord

  function etat(base = lire()) {
    const r = reglages(base);
    return { reglages: r, derives: C.tauxDerives(r), modele: C.modele(r), activites: C.ACTIVITES_MICRO, profils: C.PROFILS_SARL, postes_frais: C.POSTES_FRAIS, charges_ei_pct: C.CHARGES_EI_PCT,
             prestations: classees(base.prestations).map(p => sortie(p, r.devise)),
             aujourdhui: aujourdhui(), essai: false, local: false, telephone: { actif: false, adresse: null, code: null } };
  }

  function trouver(base, id) {
    const p = base.prestations.find(p => String(p.id) === String(id));
    if (!p) throw new Erreur("Cette prestation n'existe plus.");
    return p;
  }

  function enregistrerPrestation(base, d) {
    const p = { nom: texte(d.nom, 'Nom de la prestation', 120, true), client: texte(d.client, 'Client', 120),
                date: dateIso(d.date), realisee: !!d.realisee, donnees: C.normaliser(d.donnees) };
    C.calculer(p.donnees);  // une prestation incalculable n'est pas enregistrée
    if (d.id !== null && d.id !== undefined) Object.assign(trouver(base, d.id), p);
    else base.prestations.push(Object.assign(p, { id: base.suite++ }));
    ecrire(base);
    return d.id ?? p.id;
  }

  // ---------- tableau de bord ----------
  function moisPrecedents(mois, combien) {
    let annee = +mois.slice(0, 4), m = +mois.slice(5);
    const liste = [];
    for (let i = 0; i < combien; i++) {
      liste.unshift(`${String(annee).padStart(4, '0')}-${String(m).padStart(2, '0')}`);
      if (m === 1) { annee--; m = 12; } else m--;
    }
    return liste;
  }
  function totalMois(base, mois, devise) {
    const lignes = classees(base.prestations).filter(p => p.realisee && p.date.slice(0, 7) === mois).map(p => sortie(p, devise));
    // sommes en centimes entiers : pas d'erreur d'arrondi en additionnant
    const somme = cle => lignes.reduce((s, p) => s + Math.round(p.resultats[cle] * 100), 0) / 100;
    return [lignes, somme('ca_ht'), somme('cout_total'), somme('marge_brute'), somme('charges_ca')];
  }
  // bénéfice estimé = somme des marges brutes − cotisations sur le chiffre d'affaires − frais fixes mensuels
  function tableau(mois) {
    const base = lire(), r = reglages(base);
    const [lignes, ca, couts, marge, charges] = totalMois(base, mois, r.devise);
    const resume = p => ({ id: p.id, nom: p.nom, client: p.client, ca_ht: p.resultats.ca_ht, resultat: p.resultats.resultat,
                           resultat_pct: p.resultats.resultat_pct, etat: p.resultats.etat });
    const rang = lignes.map((p, i) => [p, i]).sort((a, b) => b[0].resultats.resultat - a[0].resultats.resultat || a[1] - b[1]).map(x => x[0]);
    const historique = moisPrecedents(mois, 6).map(m => {
      const [, caM, , margeM] = totalMois(base, m, r.devise);
      return { mois: m, ca_ht: caM, marge_brute: margeM };
    });
    const benefice = Number((marge - charges - r.frais_fixes_mensuels).toFixed(2));
    // SARL : impôt sur les sociétés estimé sur le bénéfice du mois (null pour les autres statuts)
    const impot = r.statut === 'sarl' ? C.impotSocietesMensuel(benefice) : null;
    return { mois, nombre: lignes.length, ca_ht: ca, couts, marge_brute: marge,
             marge_pct: ca ? Number((marge / ca * 100).toFixed(1)) : null,
             charges_ca: charges, frais_fixes: r.frais_fixes_mensuels, benefice,
             impot_societes: impot, benefice_apres_is: impot === null ? null : Number((benefice - impot).toFixed(2)),
             rentables: rang.filter(p => p.resultats.resultat > 0).slice(0, 5).map(resume),
             deficitaires: [...rang].reverse().filter(p => p.resultats.etat === 'deficitaire').map(resume),
             prestations: rang.map(resume), historique };
  }

  // ---------- exports ----------
  const horodatage = () => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `${aujourdhui()} ${z(d.getHours())}h${z(d.getMinutes())}`; };
  const nomFichier = (base, extension) => `${(base.replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').trim().replace(/^[ .]+|[ .]+$/g, '').slice(0, 60)) || 'export'} - ${horodatage()}.${extension}`;

  // Valeur pour le CSV : virgule décimale ; un texte ne doit pas être pris pour une formule par le tableur.
  function cellule(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return v.toFixed(2).replace('.', ',');
    return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
  }
  const COLONNES_CSV = [['Prix HT', 'ca_ht'], ['TVA', 'tva'], ['Prix TTC', 'ca_ttc'], ['Heures', 'heures_totales'],
    ["Main-d'œuvre", 'cout_main_oeuvre'], ['Matériaux', 'cout_materiaux'], ['Déplacement', 'cout_deplacement'],
    ['Sous-traitance', 'cout_sous_traitance'], ['Location', 'cout_location'], ['Autres coûts', 'cout_autres'],
    ['Coût total', 'cout_total'], ['Marge brute', 'marge_brute'], ['Taux de marque %', 'taux_marque'],
    ['Taux de marge %', 'taux_marge'], ['Frais fixes', 'frais_fixes'], ['Cotisations sur CA', 'charges_ca'], ['Résultat', 'resultat'], ['Résultat %', 'resultat_pct'],
    ['Coût horaire réel', 'cout_horaire_reel'], ['Bénéfice par heure', 'benefice_horaire'], ['Prix minimum', 'prix_minimum'],
    ['Prix conseillé', 'prix_conseille']];
  function texteCsv() {
    const e = etat();
    const champ = v => /[;"\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    const lignes = [['Date', 'Prestation', 'Client', 'Type', ...COLONNES_CSV.map(c => c[0]), 'État']];
    for (const p of e.prestations) {
      lignes.push([p.date, cellule(p.nom), cellule(p.client), p.realisee ? 'Réalisée' : 'Simulation',
                   ...COLONNES_CSV.map(c => cellule(p.resultats[c[1]])), ETATS[p.resultats.etat]]);
    }
    return lignes.map(l => l.map(champ).join(';') + '\r\n').join('');
  }

  // Fiche d'une prestation, mise en page pour l'impression (« Enregistrer en PDF » du téléphone).
  function fiche(id) {
    const base = lire(), reg = reglages(base), devise = reg.devise;
    const p = sortie(trouver(base, id), devise), r = p.resultats, d = p.donnees;
    const e = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[c]));
    const m = v => v === null ? '—' : e(C.montantNombre(v, devise));
    const pc = v => v === null ? '—' : C.nombre(v) + ' %';
    const n = C.nombre;
    const ligne = (libelle, valeur, classe = '') => `<tr class="${classe}"><td>${e(libelle)}</td><td>${valeur}</td></tr>`;
    const couts = [
      ligne(`Main-d'œuvre (${n(r.heures_totales)} h × ${C.montantNombre(d.cout_horaire, devise)})`, m(r.cout_main_oeuvre)),
      ligne('Matériaux et fournitures', m(r.cout_materiaux)),
      ligne(`Déplacement (${n(d.km)} km, carburant, péages)`, m(r.cout_deplacement)),
      ligne('Sous-traitance', m(r.cout_sous_traitance)),
      ligne('Location de matériel', m(r.cout_location)),
      ligne('Autres coûts', m(r.cout_autres)),
      ligne('Coût total', m(r.cout_total), 'total'),
      ligne('Part des frais fixes', m(r.frais_fixes))];
    if (r.charges_ca_pct) couts.push(ligne(`Cotisations et impôt sur le chiffre d'affaires (${n(r.charges_ca_pct)} %)`, m(r.charges_ca)));
    couts.push(ligne('Coût complet', m(r.cout_complet), 'total'));
    const resultats = [
      ligne('Prix de vente HT', m(r.ca_ht), 'total'),
      ligne(`TVA (${n(d.tva_pct)} %)`, m(r.tva)),
      ligne('Prix de vente TTC', m(r.ca_ttc)),
      ligne('Marge brute (prix HT − coût total)', m(r.marge_brute)),
      ligne('Taux de marque (marge ÷ prix)', pc(r.taux_marque)),
      ligne('Taux de marge (marge ÷ coûts)', pc(r.taux_marge)),
      ligne('Résultat estimé (prix HT − coût complet)', `${m(r.resultat)} · ${pc(r.resultat_pct)}`, 'total'),
      ligne('Coût horaire réel', m(r.cout_horaire_reel)),
      ligne('Bénéfice par heure', m(r.benefice_horaire)),
      ligne('Prix minimum (seuil de rentabilité)', m(r.prix_minimum) + ' HT'),
      ligne(`Prix conseillé (marge visée ${n(r.marge_cible_pct)} %)`, m(r.prix_conseille) + ' HT')];
    const grille = r.grille.map(g => `<tr><td>${g.marge_pct} %</td><td>${m(g.prix_ht)}</td><td>${m(g.prix_ttc)}</td><td>${m(g.gain)}</td></tr>`).join('');
    const alertes = r.alertes.map(a => `<li>${e(a.texte)}</li>`).join('');
    return `<h1>${e(p.nom)}</h1>
<p class="sous">${reg.entreprise ? e(reg.entreprise) + ' · ' : ''}${p.client ? 'Client : ' + e(p.client) + ' · ' : ''}${p.date.split('-').reverse().join('/')} · ${p.realisee ? 'Prestation réalisée' : 'Simulation'}</p>
<div class="etat ${r.etat}">${e(ETATS[r.etat] || '—')}</div>
${alertes ? `<ul>${alertes}</ul>` : ''}
<h2>Coûts (hors taxes)</h2><table>${couts.join('')}</table>
<h2>Résultat</h2><table>${resultats.join('')}</table>
<h2>Prix selon la marge souhaitée</h2>
<table class="grille"><tr><th>Marge</th><th>Prix HT</th><th>Prix TTC</th><th>Gain</th></tr>${grille}</table>
<p class="pied">Tous les montants sont hors taxes, sauf mention TTC. Document de travail interne — Rentabilité Artisan.</p>`;
  }

  // ---------- sauvegarde ----------
  // Vérifie une sauvegarde avant de l'accepter : chaque prestation repasse par les mêmes contrôles qu'une saisie.
  function importer(contenu) {
    let s;
    try { s = JSON.parse(contenu); } catch (e) { throw new Erreur("Ce fichier n'est pas une sauvegarde de Rentabilité Artisan."); }
    if (!s || s.application !== 'RentabiliteArtisan' || !Array.isArray(s.prestations)) throw new Erreur("Ce fichier n'est pas une sauvegarde de Rentabilité Artisan.");
    const base = { reglages: {}, prestations: [], suite: 1 };
    const r = s.reglages || {};
    base.reglages = reglagesValides(r, !!r.verifies);
    for (const p of s.prestations) {
      // l'identifiant d'origine est gardé s'il est utilisable, sinon un nouveau est attribué
      const libre = Number.isSafeInteger(p.id) && p.id > 0 && !base.prestations.some(x => x.id === p.id);
      const id = libre ? p.id : base.suite;
      base.suite = Math.max(base.suite, id + 1);
      base.prestations.push({ id, nom: texte(p.nom, 'Nom de la prestation', 120, true), client: texte(p.client, 'Client', 120),
                              date: dateIso(p.date), realisee: !!p.realisee, donnees: C.normaliser(p.donnees) });
    }
    return base;
  }
  const Donnees = {
    exporter() {
      const base = lire();
      return { nom: `Rentabilite sauvegarde ${aujourdhui()}.json`,
               contenu: JSON.stringify({ application: 'RentabiliteArtisan', date: aujourdhui(), reglages: reglages(base), prestations: base.prestations }, null, 1) };
    },
    compter: contenu => importer(contenu).prestations.length,
    restaurer(contenu) { ecrire(importer(contenu)); },
    nombre: () => lire().prestations.length,
  };

  // ---------- aiguillage : mêmes adresses que le serveur du PC ----------
  function traiter(methode, url, corps) {
    const [chemin, question] = url.split('?');
    const parties = chemin.replace(/^\/api\//, '').split('/');
    const est = (m, ...attendu) => methode === m && parties.length === attendu.length && attendu.every((a, i) => a === null || a === parties[i]);
    const base = lire();
    if (est('GET', 'etat')) return etat(base);
    if (est('GET', 'tableau')) return tableau(moisIso(new URLSearchParams(question).get('mois')));
    if (est('POST', 'calculer')) return C.calculer(corps.donnees, reglages(base).devise);
    if (est('POST', 'reglages', 'apercu')) {  // synthèse des réglages en cours de saisie, sans rien enregistrer
      const r = reglagesValides(corps, true);
      return { derives: C.tauxDerives(r), reglages: r };
    }
    if (est('POST', 'reglages')) {
      base.reglages = reglagesValides(corps, true);
      ecrire(base);
      return etat(base);
    }
    if (est('POST', 'prestations')) { const id = enregistrerPrestation(base, corps); return Object.assign(etat(base), { id }); }
    if (est('POST', 'prestations', null, 'dupliquer')) {
      const p = trouver(base, parties[1]);
      const id = enregistrerPrestation(base, { nom: [...(p.nom + ' (copie)')].slice(0, 120).join(''), client: p.client, date: aujourdhui(), realisee: false, donnees: p.donnees });
      return Object.assign(etat(base), { id });
    }
    if (est('DELETE', 'prestations', null)) {
      const p = trouver(base, parties[1]);
      base.prestations = base.prestations.filter(x => x !== p);
      ecrire(base);
      return etat(base);
    }
    if (est('POST', 'export', 'csv')) {
      const blob = new Blob(['﻿' + texteCsv()], { type: 'text/csv;charset=utf-8' });  // ﻿ : accents lisibles dans Excel
      return { lien: URL.createObjectURL(blob), nom: nomFichier('Prestations', 'csv') };
    }
    if (est('POST', 'export', 'pdf', null)) return { fiche: fiche(parties[2]) };
    throw new Erreur('Adresse inconnue.');
  }

  globalThis.apiLocale = async (methode, url, corps) => {
    try { return traiter(methode, url, corps || {}); }
    catch (e) { if (e instanceof Erreur || e instanceof C.Erreur) throw new Error(e.message); throw new Error('Erreur interne : ' + e.message); }
  };
  globalThis.Donnees = Donnees;
  globalThis.texteCsvLocal = texteCsv;  // pour les tests
})();
