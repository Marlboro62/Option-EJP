<p>
  ☕ <strong>Si cette carte vous est utile, vous pouvez soutenir le projet :</strong>
</p>

<div style="white-space: nowrap; line-height: 0;">
  <a
    href="https://www.buymeacoffee.com/Marlboro62"
    target="_blank"
    rel="noopener noreferrer"
    style="display: inline-block; text-decoration: none; vertical-align: middle;"
  ><img
    src="https://img.buymeacoffee.com/button-api/?text=Offrir%20un%20caf%C3%A9&emoji=%E2%98%95&slug=Marlboro62&button_colour=FF5F5F&font_colour=ffffff&font_family=Cookie&outline_colour=000000&coffee_colour=FFDD00"
    alt="Offrir un café sur Buy Me a Coffee"
    height="45"
    style="display: block; border: 0;"
  ></a>&nbsp;&nbsp;<a
    href="https://ko-fi.com/M4M2QL45X"
    target="_blank"
    rel="noopener noreferrer"
    style="display: inline-block; text-decoration: none; vertical-align: middle;"
  ><img
    src="https://storage.ko-fi.com/cdn/kofi6.png?v=6"
    alt="Soutenir le projet sur Ko-fi"
    height="45"
    style="display: block; border: 0;"
  ></a>
</div>


# Carte Option EJP

Carte Lovelace pour Home Assistant qui suit l'**option EJP** du Tarif Bleu d'EDF : **jour EJP aujourd'hui et demain**, **Pointe Mobile** en cours, **jours EJP restants** sur les 22 de la saison et **calendrier** de la saison, avec les prix du kWh.

La carte lit **elle-même** le calendrier des jours EJP publié par EDF : pas de YAML, pas d'intégration ni de capteur à créer. On l'installe, on l'ajoute au tableau de bord, c'est tout.

Elle a le même style que la [Carte Enedis Linky New](https://github.com/Marlboro62/content-card-linky-new) et les [Cartes Linky Énergie](https://github.com/Marlboro62/linky-energie-cards), mais elle est **indépendante** (type `custom:option-ejp-card`).

🎮 **[Essayer la démo en ligne](https://marlboro62.github.io/Option-EJP/docs/demo.html)** : la vraie carte avec des données simulées, sans installer Home Assistant.

| Jour EJP en cours (sombre) | Veille d'un jour EJP (clair) |
| --- | --- |
| <img src="https://raw.githubusercontent.com/Marlboro62/Option-EJP/main/images/ejp-sombre.png" alt="Jour EJP, style sombre" width="300"> | <img src="https://raw.githubusercontent.com/Marlboro62/Option-EJP/main/images/ejp-clair.png" alt="Veille d'un jour EJP, style clair" width="300"> |

*Aperçus réalisés avec des données fictives.*

## L'option EJP en bref

- **22 jours EJP** (« Pointe Mobile ») par saison, fixés par EDF entre le **1er novembre et le 31 mars**.
- Un jour EJP, le prix est majoré de **7 h à 1 h le lendemain** ; le reste du temps, c'est le prix **Heures normales**.
- EDF annonce le jour EJP **la veille** (sauf préavis plus court).
- L'option EJP n'est plus proposée à la souscription, mais reste en vigueur pour les contrats existants.

Prix par défaut de la carte : grille EDF au **1er août 2026**, Heures normales **17,89 c€/kWh** et Pointe Mobile **43,24 c€/kWh** TTC. Modifiables dans l'éditeur.

## Ce que la carte affiche

- **Aujourd'hui et demain** : jour EJP (rouge) ou jour normal (vert). Demain reste « Pas encore publié » jusqu'à l'annonce d'EDF.
- **Pastille** en haut à droite : **Pointe Mobile** pendant la pointe, **Heures normales** sinon.
- **Jours EJP restants** sur 22, avec le nombre de jours déjà passés depuis le 1er novembre.
- **Prix du kWh** Heures normales et Pointe Mobile, le prix en cours encadré.
- **Calendrier de la saison** : un carré par jour de novembre à mars, les jours EJP en rouge et le total par mois.

Un clic sur une tuile ouvre le capteur correspondant.

## Installation

### Avec HACS (recommandé)

1. Dans HACS, menu **⋮** → **Dépôts personnalisés**.
2. Ajoutez `https://github.com/Marlboro62/Option-EJP` avec le type **Tableau de bord** (Dashboard).
3. Cherchez **Carte Option EJP**, installez-la, puis rechargez la page (Ctrl+F5).

### Manuellement

1. Téléchargez [`option-ejp-card.js`](https://raw.githubusercontent.com/Marlboro62/Option-EJP/main/option-ejp-card.js) (clic droit → Enregistrer sous) et copiez-le dans `/config/www/`.
2. **Paramètres → Tableaux de bord → ⋮ → Ressources → Ajouter une ressource** :
   - URL : `/local/option-ejp-card.js`
   - Type : **Module JavaScript**
3. Rechargez la page (Ctrl+F5).

## D'où viennent les jours EJP ?

La carte interroge, depuis votre navigateur, les deux services du site particulier.edf.fr :

- le **calendrier** des jours EJP sur un an (statut `EJP`, `NON_EJP` ou `HORS_PERIODE_EJP` pour chaque jour) ;
- la **saison** en cours ou à venir : nombre de jours EJP de la saison et jours déjà tirés.

Ils sont relus toutes les 30 minutes, et gardés dans le navigateur : si EDF ne répond pas, la carte affiche les dernières données lues. Ces services ne sont **pas documentés** par EDF et peuvent changer sans préavis ; si la carte affiche « Impossible de lire le calendrier EDF », ouvrez une issue.

EDF publie un seul calendrier EJP pour toute la France.

## Configuration

Aucune option n'est nécessaire :

```yaml
type: custom:option-ejp-card
```

| Option | Rôle | Défaut |
| --- | --- | --- |
| `source` | `auto` (vos capteurs EJP s'ils existent, sinon calendrier EDF), `edf` (calendrier EDF) ou `entities` (vos capteurs) | `auto` |
| `price_hn` | Prix du kWh Heures normales, c€ TTC | `17.89` |
| `price_pm` | Prix du kWh Pointe Mobile, c€ TTC | `43.24` |
| `show_prices` | Afficher les prix | `true` |
| `show_calendar` | Afficher le calendrier de la saison | `true` |
| `title` | Titre de la carte | `Option EJP` |
| `zone` | Texte (ou entité) affiché sous le titre, facultatif | — |
| `theme` | `v2` (bleu nuit MyElectricalData), `auto` (clair ou sombre selon HA), `ha` (thème Home Assistant) | `v2` |

### Avec vos propres capteurs EJP

Si vous avez déjà des capteurs EJP (intégration, capteurs REST…), la carte peut les afficher à la place du calendrier EDF (`source: entities`) :

| Option | Rôle | Défaut |
| --- | --- | --- |
| `today` | Jour EJP aujourd'hui | `sensor.ejp_aujourd_hui` |
| `tomorrow` | Jour EJP demain | `sensor.ejp_demain` |
| `remaining` | Jours EJP restants (attributs facultatifs `total`, `utilises`, `jours`) | `sensor.ejp_jours_restants` |
| `peak` | Pointe Mobile en cours (facultatif) | `binary_sensor.ejp_pointe_mobile` |
| `total_days` | Jours EJP par saison | `22` |

Un état `EJP`, `on`, `rouge` ou `pointe` compte comme jour EJP, un état `Normal`, `NON_EJP`, `off` ou `vert` comme jour normal.

## Support

Questions et problèmes : uniquement via les [issues GitHub](https://github.com/Marlboro62/Option-EJP/issues).

## Voir aussi

- [Cartes Linky Énergie](https://github.com/Marlboro62/linky-energie-cards) : puissance, facture, prix et énergie par poste Tempo.
- [Carte Enedis Linky New](https://github.com/Marlboro62/content-card-linky-new) : consommation et coût Linky via MyElectricalData.

## Licence

MIT
