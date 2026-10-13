# Modbus TCP

Lit, et sur demande écrit, les registres des appareils Modbus TCP : compteurs
d'énergie, onduleurs solaires, batteries, pompes à chaleur, VMC, automates. Des
profils prêts à l'emploi couvrent les appareils les plus courants ; pour les
autres, vous décrivez les registres sur une ligne chacun, sans éditer de
fichier.

> **Développée sans le matériel : vos retours sont les bienvenus.** Les profils
> suivent les tables de registres publiées par les fabricants et sont testés sur
> des appareils simulés, pas sur de vrais appareils. Si une valeur vous semble
> fausse, ouvrez un ticket sur
> [GitHub](https://github.com/guim31/gladys-modbus/issues) avec le résultat du
> bouton **Tester la lecture**.

## Ce que fait l'intégration

- Jusqu'à quatre appareils Modbus, chacun un appareil Gladys avec ses
  fonctionnalités (puissance, énergie, tension, température, état...),
  rafraîchies toutes les 5 secondes à 5 minutes.
- Des profils prêts à l'emploi : compteurs Eastron SDM630 et SDM120, onduleurs
  et compteurs SunSpec (SMA, SolarEdge, Fronius, Kostal et bien d'autres),
  onduleurs Huawei SUN2000 (avec leur compteur et leur batterie), systèmes
  Victron GX.
- Des registres personnalisés pour tout le reste : registres holding et input,
  coils, entrées discrètes, entiers de 16 à 64 bits et flottants dans tous les
  ordres de mots, échelle, décalage, unité, nature.
- Des index d'énergie en kWh : Gladys y ajoute son suivi d'énergie
  (consommation par 30 minutes et coût).
- L'écriture, désactivée par défaut, seulement pour les registres que vous
  déclarez comme interrupteur ou consigne bornée.
- Un bouton **Tester la lecture** pour trouver le type d'un registre inconnu,
  un widget et deux déclencheurs de scène (un appareil ne répond plus, répond
  de nouveau).

## Prérequis

- Gladys Assistant 5.1 ou plus récent.
- Un appareil qui parle **Modbus TCP** sur votre réseau, ou un appareil RS-485
  derrière une **passerelle Modbus TCP** (USR-TCP232, Waveshare RS485-to-ETH,
  Elfin EW11/EE11...). La passerelle fonctionne soit en passerelle Modbus TCP
  (mode « Modbus TCP to RTU »), soit en mode transparent (« RTU sur TCP » dans
  cette intégration).
- Modbus TCP activé sur l'appareil : sur un onduleur SMA (Sunny Portal ou
  l'interface locale, serveur « Modbus »), sur un Victron GX (Réglages >
  Services > Modbus TCP), sur un onduleur SolarEdge (SetApp, Modbus TCP), sur
  un onduleur Fronius (Communication > Modbus, type de modèle « SunSpec »), sur
  un onduleur Huawei (SDongle, Modbus TCP « Activer (sans restriction) »).
- Une **adresse IP fixe** pour l'appareil ou la passerelle (réservation DHCP
  dans votre box) : Gladys identifie l'appareil par son adresse, son port et
  son identifiant d'esclave.

## Configuration

### Réglages généraux

- **Langue des noms de fonctionnalités** : Gladys garde les noms donnés à
  l'ajout d'un appareil.
- **Lire toutes les** : de 5 secondes à 5 minutes. Gladys accepte 300 valeurs
  par minute et par intégration : avec beaucoup de registres et un intervalle
  court, l'intégration ralentit d'elle-même pour rester en dessous (un
  avertissement dans les journaux).
- **Délai de réponse** : 3 secondes par défaut ; à augmenter pour un bus RS-485
  lent.
- **Autoriser l'écriture** : voir [Écrire des registres](#écrire-des-registres).

### Appareils

Chacun des quatre blocs d'appareil comporte :

- **Adresse IP ou nom d'hôte** de l'appareil ou de sa passerelle. Vide : le
  bloc n'est pas utilisé.
- **Port TCP** : 502 presque toujours.
- **Identifiant d'esclave** : 1 le plus souvent. SMA : 126 pour SunSpec (3 pour
  les registres propres à SMA). Victron GX : 100 pour les valeurs du système.
  Fronius Smart Meter : 240. Compteurs Eastron : l'adresse Modbus réglée sur le
  compteur (001 par défaut).
- **Profil** : un profil prêt à l'emploi, ou aucun.
- **Trame** : Modbus TCP, ou RTU sur TCP pour une passerelle en mode
  transparent.
- **Registres personnalisés** : voir plus bas. Ils s'ajoutent aux
  fonctionnalités du profil.

Plusieurs appareils RS-485 derrière une même passerelle : un bloc par appareil,
avec la même adresse et le même port et chacun son identifiant d'esclave. Ils
partagent une seule connexion, et leurs requêtes partent une par une, comme le
bus l'exige.

### Profils

| Profil         | Appareil                                        | Esclave usuel |
| -------------- | ----------------------------------------------- | ------------- |
| Eastron SDM630 | compteur triphasé (via une passerelle)          | 1             |
| Eastron SDM120 | compteur monophasé (via une passerelle)         | 1             |
| SunSpec        | onduleurs et compteurs qui suivent SunSpec      | 1, 126 (SMA)  |
| Huawei SUN2000 | onduleur Huawei, son compteur et sa batterie    | 1             |
| Victron GX     | Cerbo GX, Venus GX, Ekrano : valeurs du système | 100           |

Le profil SunSpec lit la liste des modèles SunSpec que l'appareil annonce (au
registre 40000, ou 0, ou 50000) et publie les onduleurs et compteurs qu'il y
trouve. Le profil Huawei cherche une fois un compteur et une batterie. Ce que
possède un appareil est gardé dans `/data` : un appareil endormi au redémarrage
(un onduleur la nuit) est quand même publié.

### Registres personnalisés

Une entrée par registre, entrées séparées par des points-virgules (le champ de
configuration tient sur une ligne) :

```
Départ: holding 100 int16 scale=0.1 temperature; Pompe: coil 5 switch
```

Une entrée s'écrit `nom: table adresse`, puis, dans n'importe quel ordre, un
type de donnée, une nature et des options.

- **nom** : le nom de la fonctionnalité dans Gladys (40 caractères au plus).
- **table** : `holding` (registre de maintien, fonction 3), `input` (registre
  d'entrée, fonction 4), `coil` (fonction 1), `discrete` (entrée discrète,
  fonction 2).
- **adresse** : l'adresse du registre telle qu'envoyée sur le fil, de 0 à
  65535, en décimal ou en hexadécimal (`0x0034`). Certains documents comptent à
  partir de 1, ou ajoutent 30001 ou 40001 : retranchez-les.
- **type de donnée** (registres seulement) : `int16` (par défaut), `uint16`,
  `int32`, `uint32`, `float32`, `int64`, `uint64`, `float64`, ou `bit0` à
  `bit15` pour un bit d'un registre.
- **nature** : ce qu'est la valeur.

| Nature        | Fonctionnalité Gladys                 | Unités (la première par défaut) |
| ------------- | ------------------------------------- | ------------------------------- |
| `temperature` | température                           | °C, °F, K                       |
| `humidity`    | humidité                              | %                               |
| `pressure`    | pression                              | bar, mbar, hPa, kPa, Pa, psi    |
| `power`       | puissance (capteur d'énergie)         | W, kW                           |
| `energy`      | index d'énergie, suivi d'énergie      | kWh, Wh, MWh (publié en kWh)    |
| `production`  | index de production                   | kWh, Wh, MWh (publié en kWh)    |
| `solar_power` | puissance de production               | W, kW                           |
| `grid_power`  | puissance réseau (import +, export −) | W, kW                           |
| `voltage`     | tension                               | V, mV                           |
| `current`     | courant                               | A, mA                           |
| `battery`     | niveau de batterie                    | %                               |
| `volume`      | volume                                | L, mL, m3                       |
| `duration`    | durée                                 | s, ms, min, h, d                |
| `value`       | un nombre affiché tel quel (défaut)   | n'importe laquelle, ou aucune   |
| `binary`      | marche/arrêt, en lecture seule        |                                 |
| `switch`      | marche/arrêt, modifiable              |                                 |
| `setpoint`    | consigne de température bornée        | °C, °F                          |

- **options** :
  - `scale=0.1` multiplie la valeur brute, `offset=-40` s'y ajoute (après
    l'échelle). La virgule décimale marche aussi (`scale=0,1`).
  - `unit=kW` choisit une autre unité de la nature.
  - `swap=word` (registres dans l'ordre inverse, « CDAB »), `swap=byte`
    (« BADC »), `swap=word_byte` (« DCBA »). Sans elle : registre de poids fort
    en premier (« ABCD »). Les noms sont ceux de l'intégration `modbus` de Home
    Assistant.
  - `min=` et `max=` : les bornes d'affichage ; pour une consigne, les bornes
    hors desquelles rien n'est écrit (obligatoires).
  - `precision=2` : décimales gardées (d'après l'échelle par défaut, 2 pour
    les flottants).
  - `on=` et `off=` : les valeurs qu'écrit un interrupteur sur registre (1 et
    0 par défaut).

Chaque erreur est listée sous le statut de la configuration (pastille rouge
« Déconnecté ») et en rouge par le bouton **Vérifier la configuration**, avec
l'appareil, le numéro de l'entrée, son nom et le mot fautif, par exemple
`Appareil 1, entrée 2 « Pompe » : un coil est un bit : il ne prend pas de type de donnée.`
Les autres entrées continuent de fonctionner.

## Appareils et fonctionnalités

Chaque appareil est interrogé par l'intégration elle-même, à l'intervalle
choisi ; seules les valeurs qui changent sont envoyées à Gladys, plus chaque
valeur une fois toutes les 6 heures.

### Eastron SDM630 et SDM120

Puissance totale, énergie importée (index d'énergie, avec suivi d'énergie),
énergie exportée, et par phase (SDM630) ou pour la ligne (SDM120) tension,
courant et puissance. Les compteurs comptent la puissance positive à
l'import.

### SunSpec

Par modèle d'onduleur (101-103, 111-113) : puissance AC, production totale
(index en kWh), puissance DC, courant AC, tension AC (phase A), température
interne (armoire), état de fonctionnement (arrêté, en sommeil, démarrage, en
production, bridé, arrêt en cours, défaut, en attente). Par modèle de compteur
(201-204, 211-214) : puissance du compteur (avec le signe du fabricant),
courant, tension, énergie importée et exportée. L'appareil porte le nom de son
fabricant et de son modèle, son numéro de série est dans les paramètres de
l'appareil. Une valeur que l'appareil n'implémente pas n'est pas publiée.

### Huawei SUN2000

Puissance AC, production totale, puissance DC d'entrée, tension et courant AC
(phase A), température interne, état de fonctionnement. Avec un compteur :
puissance réseau (positive à l'import, comme Gladys la compte), index
d'énergie soutirée et injectée. Avec une batterie LUNA2000 : niveau de
batterie, puissance de charge et de décharge.

### Victron GX

Puissance réseau (somme des phases, positive à l'import), consommation de la
maison, puissance solaire (photovoltaïque côté AC et côté DC). Avec une
batterie : niveau de batterie, puissance de charge et de décharge, tension
batterie.

### Registres personnalisés

Une fonctionnalité par entrée, de la catégorie que donne sa nature.

## Écrire des registres

L'écriture est **désactivée par défaut**. Seules les entrées que vous déclarez
en `switch` ou `setpoint` sont des commandes dans Gladys, rien d'autre ; tant
que **Autoriser l'écriture** est désactivé, elles refusent toute modification
(le statut de la configuration le dit). Activez-le dans la configuration quand
vous êtes sûr des registres.

- `switch` : sur un coil, écrit 1 ou 0 ; sur un registre holding, écrit la
  valeur `on` ou `off` (`Chauffage: holding 111 switch on=1 off=0`). Il
  s'affiche en interrupteur marche/arrêt, hors des assistants vocaux.
- `setpoint` : une température écrite dans un registre holding
  (`Consigne ECS: holding 110 uint16 setpoint min=40 max=55`). `min` et `max`
  sont obligatoires : une valeur hors bornes est refusée et rien n'est écrit.
  L'échelle est appliquée à l'envers (avec `scale=0.1`, 42,5 °C écrit 425).

**Écrire un mauvais registre peut abîmer une installation** (une pompe à
chaleur, un onduleur, une chaudière) : vérifiez chaque adresse, type de donnée
et valeur dans la documentation du fabricant, commencez par une valeur que
vous pouvez défaire, et laissez l'écriture désactivée quand vous n'en avez pas
besoin. Chaque écriture est journalisée avec son registre et sa valeur. Un bit
d'un registre ne peut pas être écrit (il faudrait réécrire les 15 autres), ni
une valeur de 64 bits.

## Actions

- **Tester la lecture** : choisissez un appareil enregistré, saisissez un
  registre dans la syntaxe des registres personnalisés sans le nom
  (`holding 100 int16 scale=0.1`), et les mots bruts s'affichent en
  hexadécimal et en décimal, avec la valeur convertie et la lecture des mêmes
  registres dans chaque type de donnée et chaque ordre de mots. Ajoutez
  `count=10` pour lire dix registres à partir de cette adresse. Saisissez
  `sunspec` pour lister les modèles SunSpec de l'appareil. Fonctionne même
  quand l'appareil n'a encore aucun registre déclaré.
- **Vérifier la configuration** : les erreurs entrée par entrée (en rouge),
  puis chaque appareil avec son profil, son nombre de fonctionnalités, et s'il
  répond.

## Widget du tableau de bord

**Appareil Modbus** : choisissez un appareil ; le widget affiche ses valeurs
principales en tuiles en direct (puissance et production d'un onduleur,
puissance et index d'un compteur, réseau, maison, solaire et batterie d'un
système Victron) et l'état de sa liaison : répond ou non, heure de la dernière
lecture, état de fonctionnement d'un onduleur, dernière erreur.

## Déclencheurs de scène

- **Un appareil Modbus ne répond plus** : deux lectures de suite ont échoué.
  Variables : le nom de l'appareil et l'erreur. Filtre : un appareil, ou
  n'importe lequel.
- **Un appareil Modbus répond de nouveau** : un appareil qui ne répondait plus
  est de nouveau lu.

## Exemples de scènes

- Me prévenir quand la passerelle de la pompe à chaleur ne répond plus :
  déclencheur **Un appareil Modbus ne répond plus** sur la pompe à chaleur,
  action « Envoyer un message » avec `{{triggerEvent.data.error}}`.
- Lancer la prise du lave-vaisselle quand la puissance solaire dépasse
  2000 W : déclencheur « la valeur d'un appareil change » sur **Puissance
  solaire** (Victron) ou **Puissance AC** (onduleur), condition au-dessus de
  2000, action « allumer ».
- Baisser la consigne d'eau chaude la nuit : déclencheur programmé à 22 h,
  action « régler la valeur » de **Consigne ECS** à 45 (écriture autorisée,
  consigne déclarée avec ses bornes).

## Dépannage

- **« Cannot connect ... ECONNREFUSED »** : rien n'écoute à cette adresse et
  ce port, ou Modbus TCP n'est pas activé sur l'appareil. **« No answer ...
  within 3000 ms »** : mauvaise adresse, appareil endormi (onduleur la nuit),
  passerelle dont les réglages série (débit, parité) ne correspondent pas à
  l'appareil, ou mauvaise trame.
- **« Modbus exception 11 »** : la passerelle répond, mais pas l'appareil
  derrière : vérifiez l'identifiant d'esclave et le câblage RS-485 (A/B).
- **« refuse tous les registres » / exception 2** : le profil ou les adresses
  ne correspondent pas à l'appareil. Utilisez **Tester la lecture** avec
  `count=` autour de l'adresse, et vérifiez si le document compte à partir de 1
  ou ajoute 30001/40001.
- **Une valeur 10 ou 100 fois trop grande** : ajoutez `scale=0.1` ou
  `scale=0.01`. **Une valeur énorme ou absurde** : essayez un autre type de
  donnée ou `swap=word` avec **Tester la lecture**, qui montre toutes les
  lectures à la fois.
- **Un onduleur Huawei qui ne répond pas** : il n'accepte qu'un client Modbus
  TCP à la fois (fermez les autres), et demande Modbus TCP réglé sur « Activer
  (sans restriction) » sur le SDongle.
- **Journaux** : réglez `LOG_LEVEL=debug` sur l'intégration pour voir chaque
  lecture.

## Limites

- Quatre appareils au plus, 40 registres personnalisés par appareil.
- Modbus TCP et RTU sur TCP seulement : pas de port série (le conteneur n'en a
  pas), pas de Modbus UDP, pas d'ASCII.
- Pas de découverte automatique : Modbus n'en a pas, les adresses se
  saisissent.
- Le profil SunSpec lit seulement les modèles d'onduleur et de compteur (pas
  le modèle de batterie 802, pas le modèle MPPT 160).
- Écriture : interrupteurs et consignes de température seulement ; pas de bit
  d'un registre, pas de valeur de 64 bits, pas d'autre consigne numérique
  (Gladys n'a pas de commande numérique neutre).
- Les noms de fonctionnalités sont figés à l'ajout d'un appareil (règle de
  Gladys).
- Développée sans le matériel : les profils sont testés sur des appareils
  simulés construits d'après les tables des fabricants.

Eastron, SMA, SolarEdge, Fronius, Kostal, Huawei, Victron Energy et SunSpec
sont des marques de leurs propriétaires. Cette intégration n'est ni affiliée à
aucun d'eux, ni approuvée par eux.
