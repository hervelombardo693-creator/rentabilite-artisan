// Calculs de rentabilité, version téléphone. Mêmes formules, mêmes arrondis et mêmes messages que ../calculs.py
// (les formules y sont documentées) : tests/test_mobile.py compare les deux sur des milliers de cas.
//
// Pas de nombres flottants dans les calculs : chaque valeur saisie devient un entier (BigInt) à 12 décimales,
// chaque poste de coût est arrondi au centime, puis les totaux sont des sommes de centimes entiers.
(() => {
  const DECIMALES = 12;
  const S = 10n ** BigInt(DECIMALES);   // 1 dans l'échelle des valeurs saisies
  const MARGES_GRILLE = [10, 20, 30, 40, 50];
  const MARGE_MAX = 90;

  // champ : [libellé, valeur par défaut, maximum]
  const CHAMPS = {
    prix_ht: ['Prix de vente HT', 0, 10000000],
    heures: ["Nombre d'heures", 0, 10000],
    personnes: ['Nombre de personnes', 1, 500],
    cout_horaire: ["Coût d'une heure", 0, 10000],
    materiaux: ['Matériaux', 0, 10000000],
    fournitures: ['Fournitures', 0, 10000000],
    sous_traitance: ['Sous-traitance', 0, 10000000],
    km: ['Kilomètres', 0, 100000],
    cout_km: ['Coût au kilomètre', 0, 100],
    carburant: ['Carburant', 0, 1000000],
    peages: ['Péages', 0, 1000000],
    location: ['Location de matériel', 0, 10000000],
    autres: ['Autres coûts', 0, 10000000],
    tva_pct: ['TVA', 20, 100],
    marge_cible_pct: ['Marge visée', 20, MARGE_MAX],
    frais_fixes_heure: ['Frais fixes par heure', 0, 10000],
    taux_horaire: ['Taux horaire facturé', 0, 10000],
  };
  const REGLAGES = {
    taux_horaire: ['Taux horaire facturé', 55, 10000],
    salaire_horaire: ["Coût d'une heure hors charges", 15, 10000],
    charges_pct: ['Charges sociales', 45, 300],
    frais_fixes_mensuels: ['Frais fixes mensuels', 1500, 10000000],
    heures_facturables_mois: ['Heures facturables par mois', 120, 10000],
    cout_km: ['Coût au kilomètre', 0.6, 100],
    marge_cible_pct: ['Marge visée', 20, MARGE_MAX],
    tva_pct: ['TVA', 20, 100],
  };

  class Erreur extends Error {}

  // n / d arrondi à l'entier le plus proche, la moitié s'éloignant de zéro (ROUND_HALF_UP de Python)
  function diviser(n, d) {
    if (d < 0n) { n = -n; d = -d; }
    const negatif = n < 0n;
    if (negatif) n = -n;
    const q = (2n * n + d) / (2n * d);
    return negatif ? -q : q;
  }

  // « 1 234,50 », « 12.5 », 12, « 1e3 »… → entier à 12 décimales. Vide = valeur par défaut.
  function decimal(valeur, libelle, maxi, defaut = 0) {
    if (valeur === null || valeur === undefined || valeur === '') valeur = defaut;
    if (typeof valeur === 'boolean') throw new Erreur(`${libelle} : nombre illisible.`);
    const texte = String(valeur).replace(/[   ]/g, '').replace(/,/g, '.');
    const m = /^([+-]?)(\d*)\.?(\d*)(?:e([+-]?\d{1,4}))?$/i.exec(texte);
    if (!m || (!m[2] && !m[3]) || (texte.includes('.') && texte.split('.').length > 2)) throw new Erreur(`${libelle} : nombre illisible.`);
    let chiffres = BigInt((m[2] + m[3]) || '0');
    const puissance = DECIMALES - m[3].length + Number(m[4] || 0);  // chiffres × 10^puissance, à l'échelle S
    if (chiffres !== 0n && puissance > 40) throw new Erreur(`${libelle} : valeur trop grande (maximum ${maxi}).`);
    let d = chiffres === 0n ? 0n : puissance >= 0 ? chiffres * 10n ** BigInt(puissance) : diviser(chiffres, 10n ** BigInt(Math.min(-puissance, 5000)));
    if (m[1] === '-') d = -d;
    if (d < 0n) throw new Erreur(`${libelle} : la valeur ne peut pas être négative.`);
    if (d > BigInt(maxi) * S) throw new Erreur(`${libelle} : valeur trop grande (maximum ${maxi}).`);
    return d;
  }

  function valider(donnees, champs = CHAMPS) {
    if (donnees === null || typeof donnees !== 'object' || Array.isArray(donnees)) throw new Erreur('Données illisibles.');
    const p = {};
    for (const [nom, [libelle, defaut, maxi]] of Object.entries(champs)) p[nom] = decimal(donnees[nom], libelle, maxi, defaut);
    return p;
  }

  // entier à « decimales » décimales → nombre JavaScript (passage par le texte : arrondi correct, comme Python)
  function versNombre(entier, decimales) {
    const negatif = entier < 0n;
    const t = (negatif ? -entier : entier).toString().padStart(decimales + 1, '0');
    return parseFloat((negatif ? '-' : '') + t.slice(0, t.length - decimales) + '.' + (t.slice(t.length - decimales) || '0'));
  }
  const valeur = d => versNombre(d, DECIMALES);   // valeur saisie → nombre
  const euros = c => versNombre(c, 2);            // centimes → nombre

  // Données validées, prêtes à être enregistrées.
  function normaliser(donnees, champs = CHAMPS) {
    const p = valider(donnees, champs);
    for (const nom in p) p[nom] = valeur(p[nom]);
    return p;
  }

  const centimes = d => diviser(d * 100n, S);     // valeur saisie → centimes entiers

  // part / total × 100, arrondi au dixième ; null si le total est nul
  const pourcent = (part, total) => total === 0n ? null : versNombre(diviser(part * 1000n, total), 1);

  // 123450 centimes → « 1 234,50 € »
  function montant(c, devise = '€') {
    const negatif = c < 0n;
    const t = (negatif ? -c : c).toString().padStart(3, '0');
    return (negatif ? '-' : '') + t.slice(0, -2).replace(/\B(?=(\d{3})+$)/g, ' ') + ',' + t.slice(-2) + ' ' + devise;
  }

  // 23.10 → « 23,1 » ; 20 → « 20 »
  const nombre = x => Number(x).toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');

  // Taux déduits des réglages de l'entreprise.
  function tauxDerives(reglages) {
    const r = valider(reglages, REGLAGES);
    const charge = diviser(r.salaire_horaire * (100n * S + r.charges_pct), S * S);
    const heures = r.heures_facturables_mois;
    const fixes = heures ? diviser(r.frais_fixes_mensuels * 100n, heures) : 0n;
    const complet = charge + fixes;
    return {
      cout_horaire_charge: euros(charge),
      frais_fixes_heure: euros(fixes),
      cout_heure_complet: euros(complet),
      cout_horaire_trop_eleve: r.taux_horaire > 0n && complet * S > r.taux_horaire * 100n,
    };
  }

  // Données d'une nouvelle prestation, pré-remplies avec les réglages de l'entreprise.
  function modele(reglages) {
    const d = tauxDerives(reglages), r = normaliser(reglages, REGLAGES);
    const vide = {};
    for (const [nom, [, defaut]] of Object.entries(CHAMPS)) vide[nom] = defaut;
    return Object.assign(vide, {
      cout_horaire: d.cout_horaire_charge, frais_fixes_heure: d.frais_fixes_heure, cout_km: r.cout_km,
      tva_pct: r.tva_pct, marge_cible_pct: r.marge_cible_pct, taux_horaire: r.taux_horaire,
    });
  }

  // Tous les résultats d'une prestation. Montants HT, sauf tva et ca_ttc.
  function calculer(donnees, devise = '€') {
    const p = valider(donnees);
    const prix = centimes(p.prix_ht);
    const heures = p.heures * p.personnes;                       // échelle S²

    const mainOeuvre = diviser(heures * p.cout_horaire * 100n, S * S * S);
    const materiaux = centimes(p.materiaux) + centimes(p.fournitures);
    const deplacement = diviser(p.km * p.cout_km * 100n, S * S) + centimes(p.carburant) + centimes(p.peages);
    const sousTraitance = centimes(p.sous_traitance);
    const location = centimes(p.location);
    const autres = centimes(p.autres);
    const coutTotal = mainOeuvre + materiaux + deplacement + sousTraitance + location + autres;

    const marge = prix - coutTotal;
    const fraisFixes = diviser(heures * p.frais_fixes_heure * 100n, S * S * S);
    const coutComplet = coutTotal + fraisFixes;
    const resultat = prix - coutComplet;

    const tvaDe = c => diviser(c * p.tva_pct, 100n * S);
    const tva = tvaDe(prix);
    // prix pour que le résultat fasse m % du prix : coût complet ÷ (1 − m ÷ 100)
    const prixPourMarge = m => diviser(coutComplet * 100n * S, 100n * S - m);
    const prixConseille = prixPourMarge(p.marge_cible_pct);
    const parHeure = c => heures ? diviser(c * S * S, heures) : null;
    const heureVendue = heures && prix ? parHeure(prix - (coutTotal - mainOeuvre)) : null;

    let etat;
    if (prix === 0n) etat = coutComplet === 0n ? 'vide' : 'a_chiffrer';
    else if (resultat < 0n) etat = 'deficitaire';
    else if (prix < prixConseille) etat = 'faible';
    else etat = 'rentable';

    const alertes = [];
    if (etat === 'deficitaire') {
      alertes.push({ niveau: 'rouge', texte: `Prestation déficitaire : le prix est inférieur au seuil de ${montant(coutComplet, devise)}. Il manque ${montant(-resultat, devise)}.` });
    } else if (etat === 'faible') {
      alertes.push({ niveau: 'orange', texte: `Marge trop faible : ${nombre(pourcent(resultat, prix))} % au lieu des ${nombre(valeur(p.marge_cible_pct))} % visés. Prix conseillé : ${montant(prixConseille, devise)} HT.` });
    }
    if (heureVendue !== null && p.taux_horaire > 0n && heureVendue * S < p.taux_horaire * 100n) {
      alertes.push({ niveau: 'orange', texte: `Une fois les achats payés, votre heure est vendue ${montant(heureVendue, devise)} au lieu de ${montant(centimes(p.taux_horaire), devise)} (votre taux horaire).` });
    }
    if (prix && !heures) alertes.push({ niveau: 'info', texte: "Aucune heure saisie : le gain par heure n'est pas calculé." });

    const ligne = m => {
      const prixM = prixPourMarge(BigInt(m) * S);
      return { marge_pct: m, prix_ht: euros(prixM), prix_ttc: euros(prixM + tvaDe(prixM)), gain: euros(prixM - coutComplet) };
    };
    const ouNul = c => c === null ? null : euros(c);

    return {
      etat, alertes,
      heures_totales: versNombre(heures, 2 * DECIMALES),
      ca_ht: euros(prix),
      tva_pct: valeur(p.tva_pct),
      tva: euros(tva),
      ca_ttc: euros(prix + tva),
      cout_main_oeuvre: euros(mainOeuvre),
      cout_materiaux: euros(materiaux),
      cout_deplacement: euros(deplacement),
      cout_sous_traitance: euros(sousTraitance),
      cout_location: euros(location),
      cout_autres: euros(autres),
      cout_total: euros(coutTotal),
      marge_brute: euros(marge),
      taux_marque: pourcent(marge, prix),
      taux_marge: pourcent(marge, coutTotal),
      frais_fixes: euros(fraisFixes),
      cout_complet: euros(coutComplet),
      resultat: euros(resultat),
      resultat_pct: pourcent(resultat, prix),
      cout_horaire_reel: ouNul(parHeure(coutComplet)),
      benefice_horaire: prix ? ouNul(parHeure(resultat)) : null,
      heure_vendue: ouNul(heureVendue),
      prix_minimum: euros(coutComplet),
      prix_conseille: euros(prixConseille),
      ecart_prix: prix ? euros(prix - prixConseille) : null,
      marge_cible_pct: valeur(p.marge_cible_pct),
      grille: MARGES_GRILLE.map(ligne),
    };
  }

  // montant() reçoit des centimes entiers ; montantNombre() accepte un nombre déjà en euros (affichage, fiche)
  const montantNombre = (x, devise = '€') => montant(BigInt(Math.round(Number(x) * 100)), devise);

  globalThis.Calculs = { CHAMPS, REGLAGES, Erreur, valider, normaliser, tauxDerives, modele, calculer, nombre, montantNombre };
})();
